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
 * portfólio (client_ad_accounts), com o gasto do mês via field expansion de insights.
 */
// (servidor apenas: importado só por server actions — nunca por componente 'use client')

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
  'insights.date_preset(this_month){spend}',
].join(',')

/** Erro "seguro": mensagem da Meta sem o token e sem a URL. */
export class MetaError extends Error {
  constructor(message: string, readonly code?: number) {
    super(message)
  }
}

type RawAccount = {
  id: string
  name?: string
  currency?: string
  account_status?: number
  is_prepay_account?: boolean
  balance?: string
  amount_spent?: string
  timezone_name?: string
  business?: { id?: string; name?: string }
  funding_source_details?: { display_string?: string }
  insights?: { data?: { spend?: string }[] }
}

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

function mapAccount(a: RawAccount, access: MetaAdAccount['access_kind']): MetaAdAccount {
  const prepaid = a.is_prepay_account === true
  const owed = minor(a.balance)
  const funds = prepaid ? prepaidFunds(a.funding_source_details?.display_string) : null
  return {
    external_account_id: a.id.startsWith('act_') ? a.id : `act_${a.id}`,
    name: (a.name || a.id).slice(0, 160),
    currency: /^[A-Z]{3}$/.test(a.currency ?? '') ? a.currency! : 'BRL',
    status: mapStatus(a.account_status),
    account_type: a.is_prepay_account === undefined ? 'unknown' : prepaid ? 'prepaid' : 'postpaid',
    balance: funds ?? (owed > 0 ? -owed : 0),
    spend_month: Number(a.insights?.data?.[0]?.spend ?? 0) || 0,
    spend_total: minor(a.amount_spent),
    timezone: a.timezone_name ?? null,
    owner_business_id: a.business?.id ?? null,
    owner_business_name: a.business?.name?.slice(0, 160) ?? null,
    access_kind: access,
  }
}

async function graphGet(url: string): Promise<{ data?: RawAccount[]; paging?: { next?: string } }> {
  let res: Response
  try {
    res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(25_000) })
  } catch {
    throw new MetaError('Sem conexão com a Meta (graph.facebook.com).')
  }
  const json = (await res.json().catch(() => null)) as any
  if (!res.ok || json?.error) {
    const e = json?.error ?? {}
    const code = Number(e.code) || res.status
    const hint =
      code === 190 ? 'Token da Meta inválido ou expirado — gere um novo (Usuário do Sistema) e atualize META_ACCESS_TOKEN.'
      : code === 200 || code === 10 ? 'O token não tem permissão para este portfólio (precisa de ads_read e business_management, e o Usuário do Sistema com acesso às contas).'
      : code === 100 ? 'ID do portfólio inválido ou sem acesso (META_BUSINESS_ID).'
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
    const qs = new URLSearchParams({ fields: FIELDS, limit: '100', access_token: cfg.token })
    let url: string | undefined = `https://graph.facebook.com/${cfg.version}/${cfg.businessId}/${edge}?${qs}`
    let pages = 0
    while (url && pages < 20) {
      const page = await graphGet(url)
      for (const raw of page.data ?? []) {
        const acc = mapAccount(raw, access)
        if (!out.has(acc.external_account_id)) out.set(acc.external_account_id, acc)
      }
      // paging.next é URL da própria Meta (já com o token) — só seguimos se for graph.facebook.com
      const next = page.paging?.next
      url = next && next.startsWith('https://graph.facebook.com/') ? next : undefined
      pages += 1
    }
  }
  return Array.from(out.values())
}
