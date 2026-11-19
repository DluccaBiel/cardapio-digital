import type { SupabaseClient } from '@supabase/supabase-js'
import type { MockClient, MockTag, Situation } from '../mock'
import { clientHealth } from '../health'

/**
 * Dados REAIS da Visão geral: clientes + tags + contas de anúncio (sincronizadas da Meta).
 * Mantém o formato `MockClient` da fase visual; campos operacionais que ainda não têm
 * tabela (Pix, rotina, criativo, entrega) começam vazios.
 *
 * Só entram clientes (e contas sem cliente) com conta ACOMPANHADA (is_watched) em
 * Contas de anúncio; a soma usa apenas as contas acompanhadas.
 *
 * Saldo: Pix (pré-paga) = saldo disponível e dias que ele dura no ritmo de gasto;
 * cartão (pós-paga) = sem saldo, a Meta cobra o cartão (mostramos o valor a cobrar);
 * devedor = só quando a Meta marca a conta como pagamento pendente.
 * ROAS / custo por resultado: só campanhas de vendas com compras do pixel.
 */

type AccountRow = {
  id: string
  client_id: string | null
  name: string
  status: string
  account_type: string
  balance: number | string
  spend_month: number | string
  spend_yesterday?: number | string | null
  spend_7d?: number | string | null
  revenue_month?: number | string | null
  ends_at?: string | null
  runs_continuously?: boolean | null
  last_change_at?: string | null
  active_adsets?: number | null
  is_watched: boolean
  last_synced_at: string | null
  owner_business_name: string | null
  funding_kind?: string | null
  unbilled_amount?: number | string | null
  sales_spend_month?: number | string | null
  sales_revenue_month?: number | string | null
  sales_purchases_month?: number | null
}

const SITUATION: Record<string, Situation> = { ativo: 'ativo', pausado: 'stand_by', encerrado: 'churn' }
const n = (v: unknown) => Number(v ?? 0) || 0

/** yyyy-mm-dd no fuso de São Paulo (coluna "Término"). */
function spDay(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
}

type Base = Omit<MockClient, 'spendMonth' | 'spendYesterday' | 'balance' | 'daysLeft' | 'termination' | 'lastChange' | 'alert' | 'campaignState' | 'roas' | 'accountsCount'>

const isPix = (a: AccountRow) => a.funding_kind === 'pix' || ((!a.funding_kind || a.funding_kind === 'unknown') && a.account_type === 'prepaid')
const isCard = (a: AccountRow) => a.funding_kind === 'card' || ((!a.funding_kind || a.funding_kind === 'unknown') && a.account_type === 'postpaid')

function aggregate(base: Base, all: AccountRow[], fallbackChange: string): MockClient {
  const watched = all.filter((a) => a.is_watched)
  const accounts = watched.length > 0 ? watched : all

  if (accounts.length === 0) {
    return {
      ...base,
      spendMonth: 0,
      spendYesterday: 0,
      balance: null,
      daysLeft: null,
      termination: null,
      lastChange: fallbackChange,
      alert: false,
      campaignState: 'nao_definido',
      roas: null,
      accountsCount: 0,
    }
  }

  const sum = (f: (a: AccountRow) => unknown, list = accounts) => list.reduce((t, a) => t + n(f(a)), 0)
  const spendMonth = sum((a) => a.spend_month)
  const spendYesterday = sum((a) => a.spend_yesterday)
  const dailySpend = sum((a) => a.spend_7d) / 7

  const pix = accounts.filter(isPix)
  const card = accounts.filter(isCard)
  const debt = accounts.reduce((t, a) => t + Math.max(0, -n(a.balance)), 0)
  const pixFunds = pix.reduce((t, a) => t + Math.max(0, n(a.balance)), 0)
  const pixDaily = sum((a) => a.spend_7d, pix) / 7
  const unbilled = sum((a) => a.unbilled_amount, card)
  const funding: MockClient['funding'] = pix.length && card.length ? 'mixed' : pix.length ? 'pix' : card.length ? 'card' : 'unknown'

  // Saldo: dívida (negativo) > saldo Pix disponível > cartão (0, sem saldo para acabar).
  const balance = debt > 0 ? -debt : pixFunds
  const daysLeft = debt > 0 ? -1 : pix.length && pixDaily > 0 ? pixFunds / pixDaily : null

  const salesSpend = sum((a) => a.sales_spend_month)
  const salesRevenue = sum((a) => a.sales_revenue_month)
  const purchases = sum((a) => a.sales_purchases_month)

  // Término: a data MAIS PRÓXIMA entre as contas com fim definido.
  const ends = accounts.map((a) => a.ends_at).filter((v): v is string => !!v).sort()
  const changes = accounts.map((a) => a.last_change_at ?? a.last_synced_at).filter((v): v is string => !!v).sort()
  const activeAdsets = sum((a) => a.active_adsets)
  const anyActive = accounts.some((a) => a.status === 'active')

  return {
    ...base,
    spendMonth,
    spendYesterday,
    balance,
    daysLeft,
    termination: ends.length ? spDay(ends[0]!) : null,
    lastChange: changes.length ? changes[changes.length - 1]! : fallbackChange,
    alert: debt > 0 || (daysLeft !== null && daysLeft >= 0 && daysLeft < 2) || accounts.some((a) => a.status === 'error'),
    campaignState: activeAdsets > 0 ? 'ativo' : anyActive ? 'pausado' : 'encerrado',
    roas: salesSpend > 0 ? Math.round((salesRevenue / salesSpend) * 100) / 100 : null,
    accountsCount: accounts.length,
    funding,
    unbilled: Math.round(unbilled * 100) / 100,
    dailySpend: Math.round(dailySpend * 100) / 100,
    salesSpend,
    salesRevenue,
    purchases,
    costPerResult: purchases > 0 ? Math.round((salesSpend / purchases) * 100) / 100 : null,
    activeAdsets,
    runsContinuously: accounts.some((a) => !!a.runs_continuously),
  }
}

const EMPTY_OPS = {
  pixPaidAt: null,
  pixAmount: null,
  routine: [] as string[],
  creativeStatus: 'nao_definido' as const,
  deliveryState: 'pendente' as const,
  editor: '',
  notePending: false,
}

export async function loadOverview(db: SupabaseClient, workspaceId: string): Promise<{ clients: MockClient[]; tags: MockTag[]; lastSyncedAt: string | null }> {
  const accountsMeta =
    'id, client_id, name, status, account_type, balance, spend_month, spend_yesterday, spend_7d, revenue_month, ends_at, runs_continuously, last_change_at, active_adsets, is_watched, last_synced_at, owner_business_name'
  const accountsFull = `${accountsMeta}, funding_kind, unbilled_amount, sales_spend_month, sales_revenue_month, sales_purchases_month`
  const accountsBasic = 'id, client_id, name, status, account_type, balance, spend_month, is_watched, last_synced_at, owner_business_name'

  const [{ data: clientRows }, { data: tagRows }, { data: linkRows }, accFull] = await Promise.all([
    db.from('clients').select('id, name, status, niche, updated_at').eq('workspace_id', workspaceId).is('archived_at', null).order('name'),
    db.from('tags').select('id, name, color').eq('workspace_id', workspaceId).order('name'),
    db.from('client_tags').select('client_id, tag_id').eq('workspace_id', workspaceId),
    db.from('ad_accounts').select(accountsFull).eq('workspace_id', workspaceId).eq('platform', 'meta'),
  ])
  // Banco sem as migrations mais novas: cai para menos colunas.
  let accounts = (accFull.data ?? []) as AccountRow[]
  if (accFull.error) {
    const meta = await db.from('ad_accounts').select(accountsMeta).eq('workspace_id', workspaceId).eq('platform', 'meta')
    accounts = (meta.error
      ? (await db.from('ad_accounts').select(accountsBasic).eq('workspace_id', workspaceId).eq('platform', 'meta')).data ?? []
      : meta.data ?? []) as AccountRow[]
  }

  const tags: MockTag[] = (tagRows ?? []).map((t) => ({ id: t.id, name: t.name, color: t.color }))
  const tagById = new Map(tags.map((t) => [t.id, t]))
  const tagsByClient = new Map<string, MockTag[]>()
  for (const l of linkRows ?? []) {
    const tag = tagById.get(l.tag_id)
    if (tag) tagsByClient.set(l.client_id, [...(tagsByClient.get(l.client_id) ?? []), tag])
  }
  const byClient = new Map<string, AccountRow[]>()
  for (const a of accounts) if (a.client_id) byClient.set(a.client_id, [...(byClient.get(a.client_id) ?? []), a])

  // Só aparecem na Visão Geral clientes que tenham ao menos uma conta
  // marcada como "acompanhada" (is_watched=true) em Contas de Anúncio.
  const clients: MockClient[] = (clientRows ?? [])
    .filter((c: any) => {
      const clientAccounts = byClient.get(c.id) ?? []
      return clientAccounts.some((a) => a.is_watched)
    })
    .map((c: any) =>
      aggregate(
        {
          id: c.id,
          name: c.name,
          segment: c.niche === 'health' ? 'Saúde' : c.niche === 'food' ? 'Food' : '—',
          situation: SITUATION[c.status] ?? 'ativo',
          tags: tagsByClient.get(c.id) ?? [],
          ...EMPTY_OPS,
        },
        byClient.get(c.id) ?? [],
        c.updated_at,
      ),
    )

  // Contas sem cliente vinculado e marcadas como acompanhadas: linha própria.
  for (const a of accounts.filter((x) => !x.client_id && x.is_watched)) {
    clients.push(
      aggregate(
        {
          id: `conta:${a.id}`,
          name: a.name,
          segment: a.owner_business_name ? `Sem cliente · ${a.owner_business_name}` : 'Conta sem cliente vinculado',
          situation: 'onboarding',
          tags: [],
          ...EMPTY_OPS,
        },
        [{ ...a, is_watched: true }],
        a.last_synced_at ?? new Date().toISOString(),
      ),
    )
  }

  for (const c of clients) {
    const h = clientHealth({
      unlinked: c.id.startsWith('conta:'),
      accountsCount: c.accountsCount ?? 0,
      balance: c.balance,
      daysLeft: c.daysLeft,
      termination: c.termination,
    })
    c.health = h.health
    c.healthReason = h.reason
  }

  const synced = accounts.map((a) => a.last_synced_at).filter((v): v is string => !!v).sort()
  return { clients, tags, lastSyncedAt: synced.length ? synced[synced.length - 1]! : null }
}

/** Lista leve para a busca (Ctrl K): só clientes, sem métricas. */
export async function loadClientIndex(db: SupabaseClient, workspaceId: string): Promise<MockClient[]> {
  const { data } = await db.from('clients').select('id, name, status, updated_at').eq('workspace_id', workspaceId).is('archived_at', null).order('name')
  return (data ?? []).map((c: any) => ({
    id: c.id,
    name: c.name,
    segment: '',
    situation: SITUATION[c.status] ?? 'ativo',
    tags: [],
    spendMonth: 0,
    spendYesterday: 0,
    balance: null,
    daysLeft: null,
    termination: null,
    lastChange: c.updated_at,
    alert: false,
    campaignState: 'nao_definido',
    roas: null,
    accountsCount: 0,
    ...EMPTY_OPS,
  }))
}
