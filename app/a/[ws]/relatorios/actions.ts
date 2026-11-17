'use server'

import { z } from 'zod'
import { getWorkspaceBySlug } from '../../../../lib/db/workspaces'
import { fetchPeriodMetrics, fetchTopAds, spDate, type PeriodMetrics } from '../../../../lib/meta/api'
import { MetaError, metaConfig } from '../../../../lib/meta/graph'
import { workspaceTokens } from '../../../../lib/meta/sync'
import { createServerClient } from '../../../../lib/supabaseServer'
import type { MockReportDraft } from '../../../../lib/mock'

const PERIODS = ['last', '7d', '14d', '30d', 'month', 'lastMonth', 'yesterday', 'custom'] as const
const schema = z.object({
  target: z.union([z.literal('all'), z.string().uuid()]),
  period: z.enum(PERIODS),
  compare: z.boolean(),
})

type Range = { since: string; until: string }
const GRADIENTS = [
  'linear-gradient(135deg,#D7141F,#5B0A10)',
  'linear-gradient(135deg,#F59E0B,#7C2D12)',
  'linear-gradient(135deg,#22C55E,#064E3B)',
]

function shift(day: string, days: number): string {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
const diffDays = (a: string, b: string) => Math.round((new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime()) / 86_400_000)

/** Período atual e o anterior equivalente (datas no fuso de São Paulo). */
function ranges(period: (typeof PERIODS)[number]): { cur: Range; prev: Range } {
  const today = spDate(0)
  const yesterday = spDate(-1)
  const back = (n: number): Range => ({ since: shift(yesterday, -(n - 1)), until: yesterday })
  let cur: Range
  if (period === 'last') {
    const dow = new Date(`${today}T12:00:00Z`).getUTCDay() // 0 = domingo
    const lastSunday = shift(today, -(dow === 0 ? 7 : dow))
    cur = { since: shift(lastSunday, -6), until: lastSunday }
  } else if (period === '14d') cur = back(14)
  else if (period === '30d') cur = back(30)
  else if (period === 'month') cur = { since: `${today.slice(0, 8)}01`, until: today }
  else if (period === 'lastMonth') {
    const firstThis = `${today.slice(0, 8)}01`
    const lastPrev = shift(firstThis, -1)
    cur = { since: `${lastPrev.slice(0, 8)}01`, until: lastPrev }
  } else if (period === 'yesterday') cur = { since: yesterday, until: yesterday }
  else cur = back(7)

  if (period === 'lastMonth') {
    const lastPrev = shift(cur.since, -1)
    return { cur, prev: { since: `${lastPrev.slice(0, 8)}01`, until: lastPrev } }
  }
  const len = diffDays(cur.since, cur.until) + 1
  return { cur, prev: { since: shift(cur.since, -len), until: shift(cur.since, -1) } }
}

const br = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`
const label = (r: Range) => (r.since === r.until ? br(r.since) : `${br(r.since)} a ${br(r.until)}`)
const pct = (cur: number, prev: number) => (prev > 0 ? Math.round(((cur - prev) / prev) * 100) : 0)
const money = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

async function pool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
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

export type ReportResult =
  | { ok: true; draft: MockReportDraft; accounts: number; warnings: string[]; range: Range }
  | { ok: false; error: string }

/** Relatório com valores reais da Meta para um cliente (ou todos os ativos) no período. */
export async function buildReportAction(ws: string, input: unknown): Promise<ReportResult> {
  const workspace = await getWorkspaceBySlug(ws)
  if (!workspace) return { ok: false, error: 'Workspace não encontrado.' }
  const parsed = schema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Pedido inválido.' }
  const { target, period, compare } = parsed.data

  const db = createServerClient()
  const { data: u } = await db.auth.getUser()
  if (!u.user) return { ok: false, error: 'Sessão expirada.' }

  // Contas do alvo (RLS: membros leem). Por cliente: acompanhadas; senão todas as vinculadas.
  let q = db
    .from('ad_accounts')
    .select('id, client_id, external_account_id, name, status, balance, account_type, spend_7d, is_watched, meta_business_id, clients!inner ( id, name, status )')
    .eq('workspace_id', workspace.id)
    .eq('platform', 'meta')
  q = target === 'all' ? q.eq('clients.status', 'ativo') : q.eq('client_id', target)
  const { data: rows, error } = await q
  if (error) return { ok: false, error: 'Não consegui ler as contas (migrations aplicadas?).' }

  let accounts = (rows ?? []) as any[]
  if (target !== 'all' && accounts.some((a) => a.is_watched)) accounts = accounts.filter((a) => a.is_watched)
  const client = target === 'all' ? null : (Array.isArray(accounts[0]?.clients) ? accounts[0].clients[0] : accounts[0]?.clients) ?? null
  let clientName = client?.name as string | undefined
  if (!clientName && target !== 'all') {
    const { data: c } = await db.from('clients').select('name').eq('id', target).eq('workspace_id', workspace.id).maybeSingle()
    clientName = c?.name
  }
  const name = target === 'all' ? 'Resumo do time' : clientName ?? 'Cliente'

  const { cur, prev } = ranges(period)
  const empty: PeriodMetrics = { spend: 0, reach: 0, impressions: 0, clicks: 0, purchases: 0, revenue: 0 }
  const warnings: string[] = []

  if (accounts.length === 0) {
    return { ok: false, error: `${name} não tem conta de anúncio vinculada. Vincule em Contas de anúncio e sincronize.` }
  }

  // Token por conta: portfólio conectado → conexão; senão modo legado (env).
  const tokens = await workspaceTokens(workspace.id)
  const { data: biz } = await db.from('meta_businesses').select('id, connection_id').eq('workspace_id', workspace.id)
  const connByBiz = new Map((biz ?? []).map((b) => [b.id, b.connection_id as string]))
  const legacy = metaConfig()?.token ?? null
  const anyToken = tokens.values().next().value ?? legacy
  const tokenFor = (a: any): string | null => (a.meta_business_id ? tokens.get(connByBiz.get(a.meta_business_id) ?? '') ?? null : legacy ?? anyToken ?? null)

  const results = await pool(accounts, 4, async (a) => {
    const token = tokenFor(a)
    if (!token) {
      warnings.push(`${a.name}: sem conexão ativa com o Facebook.`)
      return null
    }
    try {
      const [m, p, ads] = await Promise.all([
        fetchPeriodMetrics(token, a.external_account_id, cur.since, cur.until),
        compare ? fetchPeriodMetrics(token, a.external_account_id, prev.since, prev.until) : Promise.resolve(empty),
        fetchTopAds(token, a.external_account_id, cur.since, cur.until),
      ])
      return { m, p, ads }
    } catch (e) {
      warnings.push(`${a.name}: ${e instanceof MetaError ? e.message : 'falha ao consultar a Meta'}`)
      return null
    }
  })

  const ok = results.filter((r): r is NonNullable<typeof r> => r !== null)
  if (ok.length === 0) return { ok: false, error: warnings[0] ?? 'Não consegui consultar a Meta.' }

  const sum = (pick: (x: PeriodMetrics) => number, which: 'm' | 'p') => ok.reduce((t, r) => t + pick(r[which]), 0)
  const m = { spend: sum((x) => x.spend, 'm'), reach: sum((x) => x.reach, 'm'), impressions: sum((x) => x.impressions, 'm'), clicks: sum((x) => x.clicks, 'm'), purchases: sum((x) => x.purchases, 'm'), revenue: sum((x) => x.revenue, 'm') }
  const p = { spend: sum((x) => x.spend, 'p'), reach: sum((x) => x.reach, 'p'), purchases: sum((x) => x.purchases, 'p') }
  const cpp = m.purchases > 0 ? m.spend / m.purchases : 0
  const prevCpp = p.purchases > 0 ? p.spend / p.purchases : 0
  const roas = m.spend > 0 ? m.revenue / m.spend : 0

  const balance = accounts.reduce((t, a) => t + (Number(a.balance) || 0), 0)
  const daily = accounts.reduce((t, a) => t + (Number(a.spend_7d) || 0), 0) / 7
  const balanceDays = balance > 0 && daily > 0 ? Math.round(balance / daily) : 0

  const top = ok
    .flatMap((r) => r.ads)
    .sort((x, y) => y.purchases - x.purchases || y.spend - x.spend)
    .slice(0, 3)
    .map((ad, i) => ({ id: `ad-${i}`, label: ad.name, purchases: Math.round(ad.purchases), gradient: GRADIENTS[i % GRADIENTS.length]! }))

  const r2 = (v: number) => Math.round(v * 100) / 100
  const whatsappText = [
    `Olá! Segue o resumo de ${name} (${label(cur)}):`,
    ``,
    `💰 Investimento: ${money(m.spend)}`,
    `👥 Alcance: ${Math.round(m.reach).toLocaleString('pt-BR')} pessoas`,
    `🛒 Compras: ${Math.round(m.purchases)}${m.purchases > 0 ? ` (custo por compra ${money(cpp)})` : ''}`,
    m.revenue > 0 ? `📈 Faturamento: ${money(m.revenue)} · ROAS ${roas.toFixed(2).replace('.', ',')}x` : '',
    balance > 0 ? `🏦 Saldo da conta: ${money(balance)}${balanceDays ? ` (~${balanceDays} dias)` : ''}` : '',
    ``,
    `Qualquer dúvida, estou à disposição!`,
  ]
    .filter((l, i, arr) => l !== '' || (arr[i - 1] ?? '') !== '')
    .join('\n')

  const draft: MockReportDraft = {
    clientId: target,
    clientName: name,
    clientSituation: target === 'all' ? 'todos' : client?.status ?? 'ativo',
    periodLabel: label(cur),
    previousPeriodLabel: label(prev),
    compare,
    blocks: { general: true, byObjective: false, topCreatives: top.length > 0, balance: balance > 0 },
    metrics: {
      investment: r2(m.spend),
      investmentDelta: compare ? pct(m.spend, p.spend) : 0,
      reach: Math.round(m.reach),
      reachDelta: compare ? pct(m.reach, p.reach) : 0,
      purchases: Math.round(m.purchases),
      purchasesDelta: compare ? pct(m.purchases, p.purchases) : 0,
      costPerPurchase: r2(cpp),
      costPerPurchaseDelta: compare ? pct(cpp, prevCpp) : 0,
      revenue: r2(m.revenue),
      roas: r2(roas),
      impressions: Math.round(m.impressions),
      clicks: Math.round(m.clicks),
      ctr: m.impressions > 0 ? r2((m.clicks / m.impressions) * 100) : 0,
      cpm: m.impressions > 0 ? r2((m.spend / m.impressions) * 1000) : 0,
      frequency: m.reach > 0 ? r2(m.impressions / m.reach) : 0,
      balance: r2(balance),
      balanceDays,
    },
    creatives: top,
    whatsappText,
  }
  if (target === 'all' || accounts.length > 1) warnings.push('Alcance somado entre contas (pessoas podem se repetir).')
  return { ok: true, draft, accounts: ok.length, warnings, range: cur }
}
