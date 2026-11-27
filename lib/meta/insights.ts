/**
 * Meta Graph API — dados por cliente para a tela de apresentação (SOMENTE servidor).
 *
 *   fetchAccountSeries  → totais do período + série diária (gasto, faturamento, cliques…)
 *   fetchStructure      → campanhas → conjuntos → anúncios (com criativo e métricas do período)
 *   fetchStatuses       → só o effective_status de campanhas/conjuntos/anúncios (polling "ao vivo")
 *
 * Todas as chamadas usam appsecret_proof (authParams) e só seguem paging.next da própria Graph API.
 */
import { authParams, graphBase, graphGet, graphVersion, isGraphUrl } from './graph'

type ActionValue = { action_type: string; value: string }

const PURCHASE = ['omni_purchase', 'purchase', 'offsite_conversion.fb_pixel_purchase', 'onsite_web_purchase']
const ADD_TO_CART = ['omni_add_to_cart', 'add_to_cart', 'offsite_conversion.fb_pixel_add_to_cart', 'onsite_web_add_to_cart']
const LINK_CLICK = ['link_click']

/** Primeiro tipo presente da lista (a Meta repete o mesmo evento em vários tipos). */
export function firstOf(list: ActionValue[] | undefined, types: string[]): number {
  for (const t of types) {
    const hit = list?.find((a) => a.action_type === t)
    if (hit) return Number(hit.value) || 0
  }
  return 0
}

const G = () => `${graphBase()}/${graphVersion()}`
const num = (v: unknown) => Number(v ?? 0) || 0
const round2 = (n: number) => Math.round(n * 100) / 100

export type Metrics = {
  spend: number
  revenue: number
  impressions: number
  reach: number
  linkClicks: number
  addToCart: number
  purchases: number
  roas: number
  ctr: number // CTR do link (%)
  cpc: number // custo por clique no link
  cpm: number
  costPerPurchase: number
}

export const EMPTY_METRICS: Metrics = {
  spend: 0,
  revenue: 0,
  impressions: 0,
  reach: 0,
  linkClicks: 0,
  addToCart: 0,
  purchases: 0,
  roas: 0,
  ctr: 0,
  cpc: 0,
  cpm: 0,
  costPerPurchase: 0,
}

type Base = Pick<Metrics, 'spend' | 'revenue' | 'impressions' | 'reach' | 'linkClicks' | 'addToCart' | 'purchases'>

/** Recalcula as taxas a partir das somas (nunca soma CTR/CPC). */
export function finalize(b: Base): Metrics {
  return {
    spend: round2(b.spend),
    revenue: round2(b.revenue),
    impressions: Math.round(b.impressions),
    reach: Math.round(b.reach),
    linkClicks: Math.round(b.linkClicks),
    addToCart: Math.round(b.addToCart),
    purchases: Math.round(b.purchases),
    roas: b.spend > 0 ? round2(b.revenue / b.spend) : 0,
    ctr: b.impressions > 0 ? round2((b.linkClicks / b.impressions) * 100) : 0,
    cpc: b.linkClicks > 0 ? round2(b.spend / b.linkClicks) : 0,
    cpm: b.impressions > 0 ? round2((b.spend / b.impressions) * 1000) : 0,
    costPerPurchase: b.purchases > 0 ? round2(b.spend / b.purchases) : 0,
  }
}

export function addBase(a: Base, b: Base): Base {
  return {
    spend: a.spend + b.spend,
    revenue: a.revenue + b.revenue,
    impressions: a.impressions + b.impressions,
    reach: a.reach + b.reach,
    linkClicks: a.linkClicks + b.linkClicks,
    addToCart: a.addToCart + b.addToCart,
    purchases: a.purchases + b.purchases,
  }
}

export const ZERO: Base = { spend: 0, revenue: 0, impressions: 0, reach: 0, linkClicks: 0, addToCart: 0, purchases: 0 }

type RawInsight = {
  date_start?: string
  ad_id?: string
  spend?: string
  impressions?: string
  reach?: string
  inline_link_clicks?: string
  actions?: ActionValue[]
  action_values?: ActionValue[]
}

function toBase(r: RawInsight | undefined): Base {
  if (!r) return { ...ZERO }
  const linkFromActions = firstOf(r.actions, LINK_CLICK)
  return {
    spend: num(r.spend),
    revenue: firstOf(r.action_values, PURCHASE),
    impressions: num(r.impressions),
    reach: num(r.reach),
    linkClicks: num(r.inline_link_clicks) || linkFromActions,
    addToCart: firstOf(r.actions, ADD_TO_CART),
    purchases: firstOf(r.actions, PURCHASE),
  }
}

/** Lista paginada de um edge (máx. `maxPages` páginas). */
async function listAll<T>(url: string, maxPages = 10): Promise<T[]> {
  const out: T[] = []
  let next: string | undefined = url
  let pages = 0
  while (next && pages < maxPages) {
    const page: { data?: T[]; paging?: { next?: string } } = await graphGet(next)
    out.push(...(page.data ?? []))
    const n = page.paging?.next
    next = isGraphUrl(n) ? n : undefined
    pages += 1
  }
  return out
}

const INSIGHT_FIELDS = 'spend,impressions,reach,inline_link_clicks,actions,action_values'

export type DayPoint = Base & { date: string }

/** Só os totais do período (1 chamada) — usado na Visão geral. */
export async function fetchAccountTotals(token: string, actId: string, since: string, until: string): Promise<Base> {
  const range = JSON.stringify({ since, until })
  const res = await graphGet<{ data?: RawInsight[] }>(`${G()}/${actId}/insights?${authParams(token, { fields: INSIGHT_FIELDS, time_range: range })}`)
  return toBase(res.data?.[0])
}

/** Totais do período (com alcance real) + série diária de uma conta. */
export async function fetchAccountSeries(token: string, actId: string, since: string, until: string): Promise<{ totals: Base; days: DayPoint[] }> {
  const range = JSON.stringify({ since, until })
  const [totals, days] = await Promise.all([
    graphGet<{ data?: RawInsight[] }>(`${G()}/${actId}/insights?${authParams(token, { fields: INSIGHT_FIELDS, time_range: range })}`),
    listAll<RawInsight>(`${G()}/${actId}/insights?${authParams(token, { fields: INSIGHT_FIELDS, time_range: range, time_increment: '1', limit: '100' })}`, 4),
  ])
  return {
    totals: toBase(totals.data?.[0]),
    days: days.filter((d) => d.date_start).map((d) => ({ date: d.date_start!, ...toBase(d) })),
  }
}

// ============================================================================
// Estrutura: campanhas → conjuntos → anúncios
// ============================================================================

export type Level = 'campaign' | 'adset' | 'ad'

export type StructNode = {
  id: string
  level: Level
  name: string
  status: string // effective_status da Meta (ACTIVE, PAUSED, CAMPAIGN_PAUSED, ADSET_PAUSED, …)
  budget: string | null
  start: string | null
  end: string | null
  objective?: string | null
  thumbnail?: string | null
  accountId: string
  metrics: Metrics
  children?: StructNode[]
}

type RawCampaign = { id: string; name?: string; effective_status?: string; daily_budget?: string; lifetime_budget?: string; objective?: string; start_time?: string; stop_time?: string }
type RawAdset = RawCampaign & { campaign_id?: string; end_time?: string }
type RawAd = { id: string; name?: string; effective_status?: string; adset_id?: string; campaign_id?: string; creative?: { thumbnail_url?: string; image_url?: string } }

const money = (cents: string | undefined, suffix: string) => (cents && /^\d+$/.test(cents) && cents !== '0' ? `R$ ${(Number(cents) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${suffix}` : null)
const budgetOf = (r: { daily_budget?: string; lifetime_budget?: string }) => money(r.daily_budget, '/dia') ?? money(r.lifetime_budget, ' total')

/** Só aceita imagem HTTPS da Meta (fbcdn) — nada de URL arbitrária no painel. */
function safeImage(url: string | undefined): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:') return null
    return /(^|\.)(fbcdn\.net|facebook\.com|fbsbx\.com|cdninstagram\.com)$/.test(u.hostname) ? url : null
  } catch {
    return null
  }
}

export async function fetchStructure(token: string, actId: string, since: string, until: string): Promise<StructNode[]> {
  const range = JSON.stringify({ since, until })
  const [campaigns, adsets, ads, insights] = await Promise.all([
    listAll<RawCampaign>(`${G()}/${actId}/campaigns?${authParams(token, { fields: 'id,name,effective_status,daily_budget,lifetime_budget,objective,start_time,stop_time', limit: '200' })}`, 5),
    listAll<RawAdset>(`${G()}/${actId}/adsets?${authParams(token, { fields: 'id,name,campaign_id,effective_status,daily_budget,lifetime_budget,start_time,end_time', limit: '300' })}`, 5),
    listAll<RawAd>(`${G()}/${actId}/ads?${authParams(token, { fields: 'id,name,adset_id,campaign_id,effective_status,creative{thumbnail_url,image_url}', limit: '300', thumbnail_width: '160', thumbnail_height: '160' })}`, 5),
    listAll<RawInsight>(`${G()}/${actId}/insights?${authParams(token, { level: 'ad', fields: `ad_id,${INSIGHT_FIELDS}`, time_range: range, limit: '500' })}`, 6),
  ])

  const byAd = new Map<string, Base>()
  for (const r of insights) if (r.ad_id) byAd.set(r.ad_id, addBase(byAd.get(r.ad_id) ?? ZERO, toBase(r)))

  const adsBySet = new Map<string, StructNode[]>()
  const baseBySet = new Map<string, Base>()
  for (const ad of ads) {
    const base = byAd.get(ad.id) ?? ZERO
    const node: StructNode = {
      id: ad.id,
      level: 'ad',
      name: (ad.name || ad.id).slice(0, 160),
      status: ad.effective_status ?? 'UNKNOWN',
      budget: null,
      start: null,
      end: null,
      thumbnail: safeImage(ad.creative?.thumbnail_url) ?? safeImage(ad.creative?.image_url),
      accountId: actId,
      metrics: finalize(base),
    }
    const set = ad.adset_id ?? '_'
    adsBySet.set(set, [...(adsBySet.get(set) ?? []), node])
    baseBySet.set(set, addBase(baseBySet.get(set) ?? ZERO, base))
  }

  const setsByCampaign = new Map<string, StructNode[]>()
  const baseByCampaign = new Map<string, Base>()
  for (const s of adsets) {
    const base = baseBySet.get(s.id) ?? ZERO
    const node: StructNode = {
      id: s.id,
      level: 'adset',
      name: (s.name || s.id).slice(0, 160),
      status: s.effective_status ?? 'UNKNOWN',
      budget: budgetOf(s),
      start: s.start_time ?? null,
      end: s.end_time ?? null,
      accountId: actId,
      metrics: finalize(base),
      children: sortNodes(adsBySet.get(s.id) ?? []),
    }
    const camp = s.campaign_id ?? '_'
    setsByCampaign.set(camp, [...(setsByCampaign.get(camp) ?? []), node])
    baseByCampaign.set(camp, addBase(baseByCampaign.get(camp) ?? ZERO, base))
  }

  return sortNodes(
    campaigns.map((c) => ({
      id: c.id,
      level: 'campaign' as const,
      name: (c.name || c.id).slice(0, 160),
      status: c.effective_status ?? 'UNKNOWN',
      budget: budgetOf(c),
      start: c.start_time ?? null,
      end: c.stop_time ?? null,
      objective: c.objective ?? null,
      accountId: actId,
      metrics: finalize(baseByCampaign.get(c.id) ?? ZERO),
      children: sortNodes(setsByCampaign.get(c.id) ?? []),
    })),
  )
}

/** Ativos primeiro, depois maior gasto. */
function sortNodes(list: StructNode[]): StructNode[] {
  return list.sort((a, b) => Number(b.status === 'ACTIVE') - Number(a.status === 'ACTIVE') || b.metrics.spend - a.metrics.spend || a.name.localeCompare(b.name, 'pt-BR'))
}

/** Status atual (sem métricas) — barato, para o "ao vivo". */
export async function fetchStatuses(token: string, actId: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const edges = ['campaigns', 'adsets', 'ads'] as const
  const lists = await Promise.all(edges.map((e) => listAll<{ id: string; effective_status?: string }>(`${G()}/${actId}/${e}?${authParams(token, { fields: 'id,effective_status', limit: '500' })}`, 4)))
  for (const list of lists) for (const r of list) out[r.id] = r.effective_status ?? 'UNKNOWN'
  return out
}
