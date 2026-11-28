/**
 * Relatórios (SOMENTE servidor): consulta a Meta por conta e monta o relatório real,
 * e coloca relatórios na fila de envio do robô (grupos do WhatsApp).
 * Usado pela tela (prévias), pelo PNG e pelo disparo automático (/api/v1/reports/run).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { MetaError, metaConfig } from '../meta/graph'
import { fetchAccountReport } from '../meta/reports'
import { workspaceTokens } from '../meta/sync'
import { composeReport, DEFAULT_SHOW, ranges, reportMessage, staggered, type CampaignMode, type PeriodKey, type ReportPayload, type ReportSource, type Show } from './format'

export const ACCOUNT_FIELDS =
  'id, client_id, external_account_id, name, status, balance, funding_kind, unbilled_amount, spend_7d, meta_business_id, clients ( id, name, status )'

export type AccountRow = {
  id: string
  client_id: string | null
  external_account_id: string
  name: string
  status?: string | null
  balance: number | string | null
  funding_kind?: string | null
  unbilled_amount?: number | string | null
  spend_7d?: number | string | null
  meta_business_id: string | null
  clients?: { id: string; name: string; status: string } | { id: string; name: string; status: string }[] | null
}

export type TargetRow = {
  id?: string
  ad_account_id: string
  group_jid: string | null
  group_name: string | null
  campaign_mode: CampaignMode
  campaign_ids: string[]
}

export const clientOf = (a: AccountRow) => (Array.isArray(a.clients) ? a.clients[0] : a.clients) ?? null

/** Contas de anúncio da Meta do workspace (conectadas/sincronizadas). */
export async function loadAccounts(db: SupabaseClient, workspaceId: string, ids?: string[]): Promise<AccountRow[]> {
  let q = db.from('ad_accounts').select(ACCOUNT_FIELDS).eq('workspace_id', workspaceId).eq('platform', 'meta').order('name')
  if (ids) q = q.in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])
  const { data, error } = await q
  if (error) throw new Error('Não consegui ler as contas de anúncio.')
  return (data ?? []) as unknown as AccountRow[]
}

/** Token da conexão do portfólio da conta (ou o modo legado por variável de ambiente). */
export async function tokenResolver(db: SupabaseClient, workspaceId: string) {
  const tokens = await workspaceTokens(workspaceId)
  const { data: biz } = await db.from('meta_businesses').select('id, connection_id').eq('workspace_id', workspaceId)
  const connByBiz = new Map((biz ?? []).map((b) => [b.id as string, b.connection_id as string]))
  const legacy = metaConfig()?.token ?? null
  const anyToken: string | null = tokens.values().next().value ?? legacy
  return (bizId: string | null): string | null => (bizId ? tokens.get(connByBiz.get(bizId) ?? '') ?? anyToken : anyToken)
}

/** Dados reais da Meta de UMA conta no período (sem escolher juntar/separar ainda). */
export async function buildSource(input: {
  account: AccountRow
  workspaceName: string
  period: PeriodKey
  compare: boolean
  tokenFor: (bizId: string | null) => string | null
}): Promise<ReportSource> {
  const { account: a, period, compare } = input
  const token = input.tokenFor(a.meta_business_id)
  if (!token) throw new MetaError('Sem conexão ativa com o Facebook para esta conta.')
  const { cur, prev } = ranges(period)
  const data = await fetchAccountReport(token, a.external_account_id, cur, compare ? prev : null)
  const bal = Number(a.balance) || 0
  const kind = a.funding_kind === 'pix' || a.funding_kind === 'card' ? a.funding_kind : 'unknown'
  const daily = (Number(a.spend_7d) || 0) / 7
  const available = Math.max(0, bal)
  const client = clientOf(a)
  return {
    adAccountId: a.id,
    clientId: a.client_id,
    title: client?.name ?? a.name,
    accountName: a.name,
    accountId: a.external_account_id,
    workspaceName: input.workspaceName,
    periodKey: period,
    period: cur,
    previous: compare ? prev : null,
    campaigns: data.campaigns,
    reach: data.reach,
    impressions: data.impressions,
    topAds: data.topAds,
    balance: {
      kind,
      available,
      debt: kind === 'card' ? 0 : Math.max(0, -bal),
      unbilled: Number(a.unbilled_amount) || 0,
      daysLeft: kind === 'pix' && daily > 0 ? Math.floor(available / daily) : null,
    },
    generatedAt: new Date().toISOString(),
  }
}

export async function pool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i]!)
      }
    }),
  )
  return out
}

export type QueueItem = { payload: ReportPayload; message: string; groupJid: string; groupName: string | null }

/** Coloca relatórios na fila do robô com horários escalonados (intervalo aleatório entre envios). */
export async function queueReports(
  db: SupabaseClient,
  workspaceId: string,
  items: QueueItem[],
  opts: { intervalMin: number; intervalMax: number; start?: Date; scheduleId?: string | null; userId?: string | null },
): Promise<{ ids: string[]; times: string[] }> {
  if (items.length === 0) return { ids: [], times: [] }
  const times = staggered(opts.start ?? new Date(), items.length, opts.intervalMin, opts.intervalMax)
  const rows = items.map((it, i) => ({
    workspace_id: workspaceId,
    ad_account_id: it.payload.adAccountId,
    client_id: it.payload.clientId,
    title: it.payload.title.slice(0, 200),
    period_key: it.payload.periodKey,
    period_since: it.payload.period.since,
    period_until: it.payload.period.until,
    payload: it.payload,
    message: it.message.slice(0, 4000),
    status: 'agendado',
    group_jid: it.groupJid,
    group_name: it.groupName,
    scheduled_at: times[i],
    schedule_id: opts.scheduleId ?? null,
    created_by: opts.userId ?? null,
  }))
  const { data, error } = await db.from('reports').insert(rows).select('id')
  if (error) throw new Error(`Não consegui colocar os relatórios na fila (${error.code ?? error.message}).`)
  return { ids: (data ?? []).map((r) => r.id as string), times }
}

/** Gera (Meta) e enfileira os relatórios das configurações dadas — usado pelo disparo automático. */
export async function generateAndQueue(input: {
  db: SupabaseClient
  workspaceId: string
  workspaceName: string
  targets: TargetRow[]
  period: PeriodKey
  compare: boolean
  show?: Show
  intervalMin: number
  intervalMax: number
  scheduleId?: string | null
}): Promise<{ queued: number; errors: string[] }> {
  const { db, workspaceId } = input
  const errors: string[] = []
  const withGroup = input.targets.filter((t) => t.group_jid)
  if (withGroup.length < input.targets.length) errors.push(`${input.targets.length - withGroup.length} conta(s) sem grupo do WhatsApp vinculado.`)
  const accounts = await loadAccounts(db, workspaceId, withGroup.map((t) => t.ad_account_id))
  const byId = new Map(accounts.map((a) => [a.id, a]))
  const tokenFor = await tokenResolver(db, workspaceId)
  const built = await pool(withGroup, 3, async (t) => {
    const account = byId.get(t.ad_account_id)
    if (!account) return null
    try {
      const src = await buildSource({ account, workspaceName: input.workspaceName, period: input.period, compare: input.compare, tokenFor })
      const payload = composeReport(src, { mode: t.campaign_mode, selected: t.campaign_ids, show: input.show ?? DEFAULT_SHOW })
      return { payload, message: reportMessage(payload), groupJid: t.group_jid!, groupName: t.group_name } satisfies QueueItem
    } catch (e) {
      errors.push(`${account.name}: ${e instanceof MetaError ? e.message : 'falha ao consultar a Meta'}`)
      return null
    }
  })
  const items = built.filter((x): x is QueueItem => x !== null)
  // Nada saiu por falha (Meta fora do ar, token vencido…): estoura para o disparo tentar de novo.
  if (!items.length && withGroup.length > 0) throw new Error(errors.join(' · ') || 'Não consegui gerar nenhum relatório.')
  await queueReports(db, workspaceId, items, { intervalMin: input.intervalMin, intervalMax: input.intervalMax, scheduleId: input.scheduleId })
  return { queued: items.length, errors }
}
