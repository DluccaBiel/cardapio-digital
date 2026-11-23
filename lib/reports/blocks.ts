/**
 * Blocos do relatório por objetivo — funções PURAS (servidor e navegador).
 * Ver lib/meta/reports.ts para a consulta à Meta.
 */
export type ActionValue = { action_type: string; value: string }

export type Kind = 'sales' | 'messages' | 'profile' | 'traffic' | 'engagement' | 'leads' | 'awareness' | 'other'

export const KIND_LABEL: Record<Kind, { title: string; result: string; cost: string; emoji: string }> = {
  sales: { title: 'Vendas', result: 'Compras', cost: 'Custo por compra', emoji: '🛒' },
  messages: { title: 'Mensagens', result: 'Conversas iniciadas', cost: 'Custo por conversa', emoji: '💬' },
  profile: { title: 'Visitas ao perfil', result: 'Visitas ao perfil', cost: 'Custo por visita', emoji: '📲' },
  traffic: { title: 'Tráfego', result: 'Visitas ao site', cost: 'Custo por visita', emoji: '🔗' },
  engagement: { title: 'Engajamento', result: 'Engajamentos', cost: 'Custo por engajamento', emoji: '❤️' },
  leads: { title: 'Cadastros', result: 'Cadastros', cost: 'Custo por cadastro', emoji: '📝' },
  awareness: { title: 'Alcance', result: 'Pessoas alcançadas', cost: 'Custo por mil pessoas', emoji: '📣' },
  other: { title: 'Outras campanhas', result: 'Cliques', cost: 'Custo por clique', emoji: '📊' },
}

const PURCHASE = ['offsite_conversion.fb_pixel_purchase', 'purchase', 'omni_purchase', 'onsite_web_purchase']
const MESSAGES = ['onsite_conversion.messaging_conversation_started_7d', 'onsite_conversion.total_messaging_connection']
const PROFILE = ['instagram_profile_visit', 'onsite_conversion.instagram_profile_visit', 'ig_profile_visit', 'link_click']
const TRAFFIC = ['landing_page_view', 'link_click']
const ENGAGEMENT = ['post_engagement', 'page_engagement']
const LEADS = ['lead', 'onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead']

export function firstAction(list: ActionValue[] | undefined, types: string[]): number {
  for (const t of types) {
    const hit = list?.find((a) => a.action_type === t)
    if (hit) return Number(hit.value) || 0
  }
  return 0
}

const MESSAGING_DEST = /MESSENGER|WHATSAPP|INSTAGRAM_DIRECT|MESSAGING/
const PROFILE_GOALS = new Set(['VISIT_INSTAGRAM_PROFILE', 'PROFILE_VISIT', 'INSTAGRAM_PROFILE_VISIT'])

/** Tipo da campanha a partir do objetivo e das metas/destinos dos conjuntos. */
export function classifyCampaign(objective: string | null | undefined, goals: string[] = [], destinations: string[] = []): Kind {
  const o = String(objective ?? '').toUpperCase()
  const g = goals.map((x) => String(x).toUpperCase())
  const d = destinations.map((x) => String(x).toUpperCase())
  if (['OUTCOME_SALES', 'CONVERSIONS', 'PRODUCT_CATALOG_SALES'].includes(o)) return 'sales'
  if (o === 'MESSAGES' || g.includes('CONVERSATIONS') || d.some((x) => MESSAGING_DEST.test(x))) return 'messages'
  if (g.some((x) => PROFILE_GOALS.has(x)) || d.includes('INSTAGRAM_PROFILE') || d.includes('INSTAGRAM_PROFILE_AND_FACEBOOK_PAGE')) return 'profile'
  if (['OUTCOME_LEADS', 'LEAD_GENERATION'].includes(o)) return 'leads'
  if (['OUTCOME_TRAFFIC', 'LINK_CLICKS'].includes(o)) return 'traffic'
  if (['OUTCOME_ENGAGEMENT', 'POST_ENGAGEMENT', 'PAGE_LIKES', 'VIDEO_VIEWS', 'EVENT_RESPONSES'].includes(o)) return 'engagement'
  if (['OUTCOME_AWARENESS', 'REACH', 'BRAND_AWARENESS'].includes(o)) return 'awareness'
  return 'other'
}

export type Raw = {
  spend?: string
  reach?: string
  impressions?: string
  clicks?: string
  inline_link_clicks?: string
  outbound_clicks?: ActionValue[]
  actions?: ActionValue[]
  action_values?: ActionValue[]
  video_p50_watched_actions?: ActionValue[]
  video_p75_watched_actions?: ActionValue[]
  video_p100_watched_actions?: ActionValue[]
}

/** Métricas detalhadas (somáveis) da campanha no período — base da mensagem completa. */
export type Metrics = {
  impressions: number
  reach: number
  clicks: number // cliques (todos)
  linkClicks: number
  outboundClicks: number
  engagements: number
  reactions: number
  comments: number
  saves: number
  shares: number
  follows: number // curtidas da página / novos seguidores
  profileVisits: number
  landingViews: number
  purchases: number
  revenue: number
  addToCart: number
  checkout: number
  conversations: number
  leads: number
  videoViews: number
  video50: number
  video75: number
  video100: number
}
export const METRIC_KEYS = [
  'impressions', 'reach', 'clicks', 'linkClicks', 'outboundClicks', 'engagements', 'reactions', 'comments', 'saves', 'shares', 'follows',
  'profileVisits', 'landingViews', 'purchases', 'revenue', 'addToCart', 'checkout', 'conversations', 'leads', 'videoViews', 'video50', 'video75', 'video100',
] as const satisfies readonly (keyof Metrics)[]
export const emptyMetrics = (): Metrics => Object.fromEntries(METRIC_KEYS.map((k) => [k, 0])) as Metrics

const sumList = (list: ActionValue[] | undefined) => (list ?? []).reduce((t, a) => t + (Number(a.value) || 0), 0)

/** Extrai as métricas detalhadas de uma linha de insights da Meta. */
export function metricsOf(r: Raw | undefined): Metrics {
  if (!r) return emptyMetrics()
  const a = r.actions
  return {
    impressions: Number(r.impressions ?? 0) || 0,
    reach: Number(r.reach ?? 0) || 0,
    clicks: Number(r.clicks ?? 0) || 0,
    linkClicks: Number(r.inline_link_clicks ?? 0) || firstAction(a, ['link_click']),
    outboundClicks: firstAction(r.outbound_clicks, ['outbound_click']) || sumList(r.outbound_clicks),
    engagements: firstAction(a, ENGAGEMENT),
    reactions: firstAction(a, ['post_reaction']),
    comments: firstAction(a, ['comment']),
    saves: firstAction(a, ['onsite_conversion.post_save', 'post_save']),
    shares: firstAction(a, ['post']),
    follows: firstAction(a, ['like', 'onsite_conversion.instagram_follow', 'follow']),
    profileVisits: firstAction(a, PROFILE.filter((t) => t !== 'link_click')),
    landingViews: firstAction(a, ['landing_page_view', 'omni_landing_page_view']),
    purchases: firstAction(a, PURCHASE),
    revenue: firstAction(r.action_values, PURCHASE),
    addToCart: firstAction(a, ['offsite_conversion.fb_pixel_add_to_cart', 'add_to_cart', 'omni_add_to_cart']),
    checkout: firstAction(a, ['offsite_conversion.fb_pixel_initiate_checkout', 'initiate_checkout', 'omni_initiated_checkout']),
    conversations: firstAction(a, MESSAGES),
    leads: firstAction(a, LEADS),
    videoViews: firstAction(a, ['video_view']),
    video50: sumList(r.video_p50_watched_actions),
    video75: sumList(r.video_p75_watched_actions),
    video100: sumList(r.video_p100_watched_actions),
  }
}

export function sumMetrics(list: (Metrics | undefined)[]): Metrics {
  const out = emptyMetrics()
  for (const m of list) if (m) for (const k of METRIC_KEYS) out[k] += Number(m[k]) || 0
  return out
}

/** Resultado da campanha conforme o tipo. */
export function resultOf(kind: Kind, r: Raw | undefined): { result: number; revenue: number } {
  if (!r) return { result: 0, revenue: 0 }
  const a = r.actions
  switch (kind) {
    case 'sales':
      return { result: firstAction(a, PURCHASE), revenue: firstAction(r.action_values, PURCHASE) }
    case 'messages':
      return { result: firstAction(a, MESSAGES), revenue: 0 }
    case 'profile':
      return { result: firstAction(a, PROFILE), revenue: 0 }
    case 'traffic':
      return { result: firstAction(a, TRAFFIC) || Number(r.inline_link_clicks ?? 0) || 0, revenue: 0 }
    case 'engagement':
      return { result: firstAction(a, ENGAGEMENT), revenue: 0 }
    case 'leads':
      return { result: firstAction(a, LEADS), revenue: 0 }
    case 'awareness':
      return { result: Number(r.reach ?? 0) || 0, revenue: 0 }
    default:
      return { result: Number(r.inline_link_clicks ?? 0) || firstAction(a, ['link_click']), revenue: 0 }
  }
}

export type CampaignResult = {
  id: string
  name: string
  status: string
  objective: string | null
  kind: Kind
  spend: number
  reach: number
  impressions: number
  clicks: number
  result: number
  revenue: number
  prev: { spend: number; result: number; revenue: number } | null
  /** Ausente em relatórios salvos antes da mensagem detalhada. */
  metrics?: Metrics
}

export type Block = {
  key: string
  kind: Kind
  title: string // "Vendas" ou nome da campanha (modo separado)
  campaigns: string[]
  spend: number
  result: number
  resultLabel: string
  costLabel: string
  costPerResult: number | null
  revenue: number
  roas: number | null
  deltaResult: number | null // % vs período anterior
  deltaCost: number | null
  metrics?: Metrics
}

const r2 = (n: number) => Math.round(n * 100) / 100
const pct = (cur: number, prev: number) => (prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null)

function toBlock(key: string, kind: Kind, title: string, list: CampaignResult[]): Block {
  const spend = list.reduce((t, c) => t + c.spend, 0)
  const result = list.reduce((t, c) => t + c.result, 0)
  const revenue = list.reduce((t, c) => t + c.revenue, 0)
  const hasPrev = list.some((c) => c.prev)
  const pSpend = list.reduce((t, c) => t + (c.prev?.spend ?? 0), 0)
  const pResult = list.reduce((t, c) => t + (c.prev?.result ?? 0), 0)
  const rawCost = result > 0 ? (spend / result) * (kind === 'awareness' ? 1000 : 1) : null
  const cost = rawCost == null ? null : r2(rawCost)
  const pCost = pResult > 0 ? (pSpend / pResult) * (kind === 'awareness' ? 1000 : 1) : 0
  return {
    key,
    kind,
    title,
    campaigns: list.map((c) => c.name),
    spend: r2(spend),
    result: Math.round(result),
    resultLabel: KIND_LABEL[kind].result,
    costLabel: KIND_LABEL[kind].cost,
    costPerResult: cost,
    revenue: r2(revenue),
    roas: kind === 'sales' && spend > 0 ? r2(revenue / spend) : null,
    deltaResult: hasPrev ? pct(result, pResult) : null,
    deltaCost: hasPrev && rawCost != null && pCost > 0 ? pct(rawCost, pCost) : null,
    metrics: list.some((c) => c.metrics) ? sumMetrics(list.map((c) => c.metrics)) : undefined,
  }
}

/**
 * Blocos do relatório. `merged`: um bloco por TIPO (soma campanhas do mesmo objetivo);
 * `separate`: um bloco por campanha. `selected` vazio = todas com gasto no período.
 */
export function buildBlocks(campaigns: CampaignResult[], mode: 'merged' | 'separate', selected: string[] = []): Block[] {
  const pool = (selected.length ? campaigns.filter((c) => selected.includes(c.id)) : campaigns).filter((c) => c.spend > 0 || c.result > 0)
  if (mode === 'separate') {
    return pool.sort((a, b) => b.spend - a.spend).map((c) => toBlock(c.id, c.kind, c.name, [c]))
  }
  const order: Kind[] = ['sales', 'messages', 'profile', 'leads', 'traffic', 'engagement', 'awareness', 'other']
  return order
    .map((k) => ({ k, list: pool.filter((c) => c.kind === k) }))
    .filter((g) => g.list.length)
    .map((g) => toBlock(g.k, g.k, KIND_LABEL[g.k].title, g.list))
}

export type Range = { since: string; until: string }
export type TopAd = { id: string; name: string; campaignId: string; kind: Kind; spend: number; result: number; thumbnail: string | null }
