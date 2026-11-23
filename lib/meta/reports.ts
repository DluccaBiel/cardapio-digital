/**
 * Relatórios por OBJETIVO de campanha (SOMENTE servidor).
 *
 *   vendas      → compras do pixel, faturamento, ROAS, custo por compra
 *   mensagens   → conversas iniciadas, custo por conversa
 *   perfil      → visitas ao perfil do Instagram (tráfego/engajamento com destino no perfil)
 *   tráfego     → visualizações da página / cliques no link
 *   engajamento → engajamentos com a publicação
 *   cadastros   → leads
 *   alcance     → pessoas alcançadas
 *
 * O tipo de cada campanha vem do objetivo + metas/destinos dos conjuntos (a Meta não dá "resultado"
 * pronto por campanha). Ao juntar campanhas, só se somam resultados do MESMO tipo.
 */
import { authParams, graphBase, graphGet, graphVersion, isGraphUrl } from './graph'
import { classifyCampaign, metricsOf, resultOf, type CampaignResult, type Range, type Raw, type TopAd } from '../reports/blocks'

export * from '../reports/blocks'

const r2 = (n: number) => Math.round(n * 100) / 100

// ---------------------------------------------------------------------------
// Consulta à Meta
// ---------------------------------------------------------------------------
const G = () => `${graphBase()}/${graphVersion()}`

async function listAll<T>(url: string, maxPages = 6): Promise<T[]> {
  const out: T[] = []
  let next: string | undefined = url
  for (let p = 0; next && p < maxPages; p++) {
    const page: { data?: T[]; paging?: { next?: string } } = await graphGet(next)
    out.push(...(page.data ?? []))
    next = isGraphUrl(page.paging?.next) ? page.paging!.next : undefined
  }
  return out
}


function safeImage(url: string | undefined): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && /(^|\.)(fbcdn\.net|facebook\.com|fbsbx\.com|cdninstagram\.com)$/.test(u.hostname) ? url : null
  } catch {
    return null
  }
}

/** Campanhas da conta com resultado por objetivo (período atual e, se pedido, o anterior) + top anúncios. */
export async function fetchAccountReport(
  token: string,
  actId: string,
  cur: Range,
  prev: Range | null,
): Promise<{ campaigns: CampaignResult[]; reach: number; impressions: number; topAds: TopAd[] }> {
  const fields =
    'campaign_id,campaign_name,objective,spend,reach,impressions,clicks,inline_link_clicks,outbound_clicks,actions,action_values,video_p50_watched_actions,video_p75_watched_actions,video_p100_watched_actions'
  const ins = (r: Range) =>
    listAll<Raw & { campaign_id?: string; campaign_name?: string; objective?: string }>(
      `${G()}/${actId}/insights?${authParams(token, { level: 'campaign', fields, time_range: JSON.stringify(r), limit: '200' })}`,
    )
  const [campaigns, adsets, curIns, prevIns, account, adIns] = await Promise.all([
    listAll<{ id: string; name?: string; effective_status?: string; objective?: string }>(`${G()}/${actId}/campaigns?${authParams(token, { fields: 'id,name,effective_status,objective', limit: '200' })}`),
    listAll<{ campaign_id?: string; optimization_goal?: string; destination_type?: string }>(`${G()}/${actId}/adsets?${authParams(token, { fields: 'campaign_id,optimization_goal,destination_type', limit: '300' })}`),
    ins(cur),
    prev ? ins(prev) : Promise.resolve([]),
    graphGet<{ data?: Raw[] }>(`${G()}/${actId}/insights?${authParams(token, { fields: 'reach,impressions', time_range: JSON.stringify(cur) })}`),
    listAll<Raw & { ad_id?: string; ad_name?: string; campaign_id?: string }>(
      `${G()}/${actId}/insights?${authParams(token, { level: 'ad', fields: 'ad_id,ad_name,campaign_id,spend,actions,action_values,inline_link_clicks,reach', time_range: JSON.stringify(cur), limit: '300' })}`,
      3,
    ),
  ])

  const goals = new Map<string, string[]>()
  const dests = new Map<string, string[]>()
  for (const s of adsets) {
    if (!s.campaign_id) continue
    if (s.optimization_goal) goals.set(s.campaign_id, [...(goals.get(s.campaign_id) ?? []), s.optimization_goal])
    if (s.destination_type) dests.set(s.campaign_id, [...(dests.get(s.campaign_id) ?? []), s.destination_type])
  }
  const meta = new Map(campaigns.map((c) => [c.id, c]))
  const ids = new Set([...curIns.map((r) => r.campaign_id!).filter(Boolean), ...campaigns.filter((c) => c.effective_status === 'ACTIVE').map((c) => c.id)])
  const curBy = new Map(curIns.map((r) => [r.campaign_id!, r]))
  const prevBy = new Map(prevIns.map((r) => [r.campaign_id!, r]))

  const out: CampaignResult[] = []
  for (const id of Array.from(ids)) {
    const m = meta.get(id)
    const r = curBy.get(id)
    const objective = m?.objective ?? r?.objective ?? null
    const kind = classifyCampaign(objective, goals.get(id), dests.get(id))
    const res = resultOf(kind, r)
    const pr = prevBy.get(id)
    out.push({
      id,
      name: (m?.name ?? r?.campaign_name ?? id).slice(0, 120),
      status: m?.effective_status ?? 'UNKNOWN',
      objective,
      kind,
      spend: r2(Number(r?.spend ?? 0) || 0),
      reach: Number(r?.reach ?? 0) || 0,
      impressions: Number(r?.impressions ?? 0) || 0,
      clicks: Number(r?.inline_link_clicks ?? 0) || 0,
      result: res.result,
      revenue: r2(res.revenue),
      prev: prev ? { spend: Number(pr?.spend ?? 0) || 0, ...resultOf(kind, pr) } : null,
      metrics: metricsOf(r),
    })
  }

  const kindOf = new Map(out.map((c) => [c.id, c.kind]))
  const ranked = adIns
    .map((a) => {
      const kind = kindOf.get(a.campaign_id ?? '') ?? 'other'
      return { id: a.ad_id ?? '', name: (a.ad_name ?? 'Anúncio').slice(0, 80), campaignId: a.campaign_id ?? '', kind, spend: Number(a.spend ?? 0) || 0, result: resultOf(kind, a).result, thumbnail: null as string | null }
    })
    .filter((a) => a.id && (a.spend > 0 || a.result > 0))
    .sort((x, y) => y.result - x.result || y.spend - x.spend)
    .slice(0, 3)
  if (ranked.length) {
    try {
      const thumbs = await graphGet<Record<string, { creative?: { thumbnail_url?: string; image_url?: string } }>>(
        `${G()}/?${authParams(token, { ids: ranked.map((a) => a.id).join(','), fields: 'creative{thumbnail_url,image_url}', thumbnail_width: '320', thumbnail_height: '320' })}`,
      )
      for (const a of ranked) a.thumbnail = safeImage(thumbs[a.id]?.creative?.thumbnail_url) ?? safeImage(thumbs[a.id]?.creative?.image_url)
    } catch {
      // sem miniatura: o card mostra só o nome
    }
  }
  const acc = account.data?.[0]
  return { campaigns: out, reach: Number(acc?.reach ?? 0) || 0, impressions: Number(acc?.impressions ?? 0) || 0, topAds: ranked }
}
