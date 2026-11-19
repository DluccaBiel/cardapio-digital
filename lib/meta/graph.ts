/**
 * Meta Graph API — SOMENTE servidor (server actions / route handlers).
 *
 *   META_ACCESS_TOKEN  (secret) token de Usuário do Sistema do portfólio, com
 *                      ads_read + business_management. Nunca em NEXT_PUBLIC_*,
 *                      nunca em log, nunca no audit_log.
 *   META_BUSINESS_ID   id do portfólio empresarial (não é segredo).
 *   META_GRAPH_VERSION opcional (padrão v23.0).
 *
 * Lê as contas próprias (owned_ad_accounts) e as de clientes compartilhadas com o
 * portfólio (client_ad_accounts). O gasto do mês vem do enriquecimento por conta (api.ts).
 */
// (servidor apenas: importado só por server actions — nunca por componente 'use client')

import { createHmac } from 'node:crypto'

export function graphVersion(): string {
  return /^v\d+\.\d+$/.test(process.env.META_GRAPH_VERSION ?? '') ? process.env.META_GRAPH_VERSION! : 'v23.0'
}

/**
 * Simulador local (testes E2E): só fora de produção e só http://localhost/127.0.0.1.
 * Em qualquer build da Vercel (NODE_ENV=production) é ignorado.
 */
function localOverride(name: string): string | null {
  if (process.env.NODE_ENV === 'production') return null
  const v = process.env[name]?.trim()
  return v && /^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}$/.test(v) ? v : null
}

export function graphBase(): string {
  return localOverride('META_GRAPH_BASE_URL') ?? 'https://graph.facebook.com'
}

export function dialogBase(): string {
  return localOverride('META_DIALOG_BASE_URL') ?? 'https://www.facebook.com'
}

/** Só seguimos paging.next da própria Graph API (o link já traz o token). */
export function isGraphUrl(url: string | undefined): url is string {
  return !!url && url.startsWith(`${graphBase()}/`)
}

/** access_token + appsecret_proof (quando META_APP_SECRET existe) — protege contra uso de token vazado. */
export function authParams(token: string, extra: Record<string, string> = {}): URLSearchParams {
  const qs = new URLSearchParams({ ...extra, access_token: token })
  const secret = process.env.META_APP_SECRET?.trim()
  if (secret) qs.set('appsecret_proof', createHmac('sha256', secret).update(token).digest('hex'))
  return qs
}

export type MetaAdAccount = {
  external_account_id: string // act_123
  name: string
  currency: string
  status: 'active' | 'disabled' | 'error' | 'unknown'
  account_type: 'prepaid' | 'postpaid' | 'unknown'
  balance: number
  spend_month: number
  spend_total: number
  timezone: string | null
  owner_business_id: string | null
  owner_business_name: string | null
  access_kind: 'owned' | 'client'
  /** pix = pré-paga (saldo disponível) · card = pós-paga no cartão · other/unknown. */
  funding_kind: 'pix' | 'card' | 'other' | 'unknown'
  account_status_code: number | null
  /** Pós-paga: gasto ainda não cobrado no cartão (não é dívida). */
  unbilled_amount: number
  /** Limite de gastos da conta (0 = sem limite). */
  spend_cap: number
}

export type MetaConfig = { token: string; businessId: string; version: string }

export function metaConfig(): MetaConfig | null {
  const token = process.env.META_ACCESS_TOKEN?.trim()
  const businessId = process.env.META_BUSINESS_ID?.trim()
  if (!token || !businessId || !/^\d{5,25}$/.test(businessId)) return null
  const version = /^v\d+\.\d+$/.test(process.env.META_GRAPH_VERSION ?? '') ? process.env.META_GRAPH_VERSION! : 'v23.0'
  return { token, businessId, version }
}

const FIELDS = [
  'id',
  'name',
  'currency',
  'account_status',
  'is_prepay_account',
  'balance',
  'amount_spent',
  'timezone_name',
  'business{id,name}',
  'funding_source_details',
  'spend_cap',
].join(',')
// O gasto do mês NÃO vem mais embutido aqui (field expansion de insights deixava a
// listagem lenta a ponto de estourar o tempo em portfólios com muitas contas de clientes);
// ele é calculado no enriquecimento por conta (lib/meta/api.ts → enrichAccount).

/** Erro "seguro": mensagem da Meta sem o token e sem a URL. */
export class MetaError extends Error {
  constructor(message: string, readonly code?: number) {
    super(message)
  }
}

export type RawAccount = {
  id: string
  name?: string
  currency?: string
  account_status?: number
  is_prepay_account?: boolean
  balance?: string
  amount_spent?: string
  timezone_name?: string
  business?: { id?: string; name?: string }
  funding_source_details?: { display_string?: string; type?: number }
  spend_cap?: string
  insights?: { data?: { spend?: string }[] }
}

/** account_status 3 (pagamento pendente) e 9 (carência): a conta DEVE à Meta. */
export const DEBTOR_STATUS = new Set([3, 9])

// account_status da Meta: 1 ativa · 2 desativada · 3 pendente de pagamento · 7/8/9 revisão/acerto/carência · 100/101 encerrando/encerrada
function mapStatus(s: number | undefined): MetaAdAccount['status'] {
  if (s === 1) return 'active'
  if (s === 2 || s === 100 || s === 101) return 'disabled'
  if (s === 3 || s === 7 || s === 8 || s === 9) return 'error'
  return 'unknown'
}

/** Valores monetários da Meta vêm em centavos (string). BRL/USD/EUR: offset 100. */
const minor = (v: string | undefined) => (v && /^-?\d+$/.test(v) ? Number(v) / 100 : 0)

/** Pré-paga: "Saldo disponível (R$ 1.234,56 BRL)" → 1234.56. */
function prepaidFunds(display: string | undefined): number | null {
  const m = /([\d.]+,\d{2}|\d+(?:\.\d{2})?)/.exec(display ?? '')
  if (!m) return null
  const raw = m[1]!
  const n = raw.includes(',') ? Number(raw.replace(/\./g, '').replace(',', '.')) : Number(raw)
  return Number.isFinite(n) ? n : null
}

/**
 * Forma de abastecimento (funding_source_details.type da Meta):
 *   1 = cartão de crédito/débito · 20 = saldo armazenado (pré-pago: Pix/boleto no Brasil)
 * Conta pré-paga (is_prepay_account) é sempre "pix", mesmo sem o tipo.
 */
export function fundingKind(a: Pick<RawAccount, 'is_prepay_account' | 'funding_source_details'>): MetaAdAccount['funding_kind'] {
  if (a.is_prepay_account === true || a.funding_source_details?.type === 20) return 'pix'
  if (a.funding_source_details?.type === 1) return 'card'
  if (a.is_prepay_account === false) return a.funding_source_details?.type ? 'other' : 'card'
  return 'unknown'
}

export function mapAccount(a: RawAccount, access: MetaAdAccount['access_kind']): MetaAdAccount {
  const prepaid = a.is_prepay_account === true
  const owed = minor(a.balance)
  const funds = prepaid ? prepaidFunds(a.funding_source_details?.display_string) : null
  const debtor = DEBTOR_STATUS.has(a.account_status ?? -1)
  // Saldo exibido = SALDO DISPONÍVEL (pré-paga) ou DÍVIDA (negativo, só quando a Meta marca
  // a conta como pendente de pagamento). Cartão em dia não tem saldo: o gasto não cobrado
  // vai para unbilled_amount (antes aparecia, errado, como "Devedor").
  const balance = debtor && owed > 0 ? -owed : prepaid ? (funds ?? 0) : 0
  return {
    external_account_id: a.id.startsWith('act_') ? a.id : `act_${a.id}`,
    name: (a.name || a.id).slice(0, 160),
    currency: /^[A-Z]{3}$/.test(a.currency ?? '') ? a.currency! : 'BRL',
    status: mapStatus(a.account_status),
    account_type: a.is_prepay_account === undefined ? 'unknown' : prepaid ? 'prepaid' : 'postpaid',
    balance,
    spend_month: Number(a.insights?.data?.[0]?.spend ?? 0) || 0,
    spend_total: minor(a.amount_spent),
    timezone: a.timezone_name ?? null,
    owner_business_id: a.business?.id ?? null,
    owner_business_name: a.business?.name?.slice(0, 160) ?? null,
    access_kind: access,
    funding_kind: fundingKind(a),
    account_status_code: typeof a.account_status === 'number' ? a.account_status : null,
    unbilled_amount: prepaid ? 0 : Math.max(owed, 0),
    spend_cap: minor(a.spend_cap),
  }
}

/** Caminho da chamada SEM query string (a query carrega o token) — seguro para log. */
function safePath(url: string): string {
  try {
    const u = new URL(url)
    return `${u.host}${u.pathname}`
  } catch {
    return 'url-invalida'
  }
}

const GRAPH_TIMEOUT_MS = 60_000

export async function graphGet<T = any>(url: string): Promise<T> {
  let res: Response | undefined
  let lastErr: unknown
  // Até 2 tentativas: a Graph API às vezes demora/derruba a conexão em consultas grandes.
  for (let attempt = 1; attempt <= 2 && !res; attempt += 1) {
    try {
      res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS) })
    } catch (e) {
      lastErr = e
      const err = e as { name?: string; cause?: { code?: string } }
      console.error('[meta] falha de rede', { path: safePath(url), attempt, name: err?.name, code: err?.cause?.code })
    }
  }
  if (!res) {
    const timedOut = (lastErr as { name?: string })?.name === 'TimeoutError'
    throw new MetaError(
      timedOut
        ? 'A Meta demorou demais para responder (tempo esgotado). Tente sincronizar de novo em instantes.'
        : 'Sem conexão com a Meta (graph.facebook.com).',
    )
  }
  const json = (await res.json().catch(() => null)) as any
  if (!res.ok || json?.error) {
    const e = json?.error ?? {}
    const code = Number(e.code) || res.status
    console.error('[meta] erro da Graph API', { path: safePath(url), status: res.status, code, subcode: e.error_subcode, type: e.type })
    const hint =
      code === 190 ? 'Acesso ao Facebook expirado ou revogado — reconecte em Configurações → Integrações.'
      : code === 200 || code === 10 ? 'Sem permissão neste portfólio/conta (precisa de ads_read e business_management e acesso às contas no Gerenciador de Negócios).'
      : code === 100 ? 'Portfólio ou conta inválida ou sem acesso.'
      : code === 4 || code === 17 || code === 613 ? 'Limite de chamadas da Meta atingido. Tente de novo em alguns minutos.'
      : `Meta respondeu erro ${code}.`
    throw new MetaError(hint, code)
  }
  return json
}

/** Todas as contas do portfólio (próprias + de clientes), sem duplicar. Máx. 2000. */
export async function fetchBusinessAdAccounts(cfg: MetaConfig): Promise<MetaAdAccount[]> {
  const out = new Map<string, MetaAdAccount>()
  for (const [edge, access] of [
    ['owned_ad_accounts', 'owned'],
    ['client_ad_accounts', 'client'],
  ] as const) {
    const qs = authParams(cfg.token, { fields: FIELDS, limit: '50' })
    let url: string | undefined = `${graphBase()}/${cfg.version}/${cfg.businessId}/${edge}?${qs}`
    let pages = 0
    while (url && pages < 40) {
      const page: { data?: RawAccount[]; paging?: { next?: string } } = await graphGet(url)
      for (const raw of page.data ?? []) {
        const acc = mapAccount(raw, access)
        if (!out.has(acc.external_account_id)) out.set(acc.external_account_id, acc)
      }
      // paging.next é URL da própria Meta (já com o token) — só seguimos se for graph.facebook.com
      const next = page.paging?.next
      url = isGraphUrl(next) ? next : undefined
      pages += 1
    }
  }
  return Array.from(out.values())
}

/** Uma conta (para a atualização rápida das contas acompanhadas a cada 5 min). */
export async function fetchAdAccount(token: string, version: string, actId: string, access: MetaAdAccount['access_kind'] = 'client'): Promise<MetaAdAccount> {
  const raw = await graphGet<RawAccount>(`${graphBase()}/${version}/${actId}?${authParams(token, { fields: FIELDS })}`)
  return mapAccount(raw, access)
}
