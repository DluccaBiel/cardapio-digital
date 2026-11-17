/**
 * Meta Graph API — OAuth, portfólios, enriquecimento de contas e relatórios.
 * SOMENTE servidor. Tokens nunca em log, nunca no audit_log.
 *
 *   META_APP_ID       id do app da Meta (não é segredo)
 *   META_APP_SECRET   segredo do app (secret)
 */
import { authParams, dialogBase, graphBase, graphGet, graphVersion, isGraphUrl, MetaError } from './graph'

export const META_SCOPES = ['ads_read', 'business_management'] as const

/** Cookie httpOnly com o state do OAuth (nonce + workspace). */
export const META_STATE_COOKIE = 'uc_meta_oauth'

export function metaAppConfig(): { appId: string; appSecret: string } | null {
  const appId = process.env.META_APP_ID?.trim()
  const appSecret = process.env.META_APP_SECRET?.trim()
  if (!appId || !appSecret || !/^\d{5,25}$/.test(appId)) return null
  return { appId, appSecret }
}

const G = () => `${graphBase()}/${graphVersion()}`

export function oauthDialogUrl(appId: string, redirectUri: string, state: string): string {
  const qs = new URLSearchParams({ client_id: appId, redirect_uri: redirectUri, state, response_type: 'code' })
  // App tipo Empresa (Login do Facebook para Empresas): permissões vêm da configuração (config_id).
  const configId = process.env.META_LOGIN_CONFIG_ID?.trim()
  if (configId && /^\d{5,25}$/.test(configId)) qs.set('config_id', configId)
  else qs.set('scope', META_SCOPES.join(','))
  return `${dialogBase()}/${graphVersion()}/dialog/oauth?${qs}`
}

/** code → token curto → token de longa duração (~60 dias). */
export async function exchangeCode(code: string, redirectUri: string): Promise<{ token: string; expiresAt: string | null }> {
  const app = metaAppConfig()
  if (!app) throw new MetaError('App da Meta não configurado (META_APP_ID/META_APP_SECRET).')
  const short = await graphGet<{ access_token: string }>(
    `${G()}/oauth/access_token?${new URLSearchParams({ client_id: app.appId, client_secret: app.appSecret, redirect_uri: redirectUri, code })}`,
  )
  const long = await graphGet<{ access_token: string; expires_in?: number }>(
    `${G()}/oauth/access_token?${new URLSearchParams({ grant_type: 'fb_exchange_token', client_id: app.appId, client_secret: app.appSecret, fb_exchange_token: short.access_token })}`,
  )
  const expiresAt = long.expires_in ? new Date(Date.now() + long.expires_in * 1000).toISOString() : null
  return { token: long.access_token, expiresAt }
}

export async function fetchMe(token: string): Promise<{ id: string; name: string | null; scopes: string[] }> {
  const me = await graphGet<{ id: string; name?: string }>(`${G()}/me?${authParams(token, { fields: 'id,name' })}`)
  let scopes: string[] = []
  try {
    const perms = await graphGet<{ data?: { permission: string; status: string }[] }>(`${G()}/me/permissions?${authParams(token)}`)
    scopes = (perms.data ?? []).filter((p) => p.status === 'granted').map((p) => p.permission)
  } catch {
    // sem permissão para listar permissões: segue sem
  }
  return { id: me.id, name: me.name?.slice(0, 160) ?? null, scopes }
}

/** Portfólios (Business Managers) que a pessoa conectada acessa. */
export async function fetchBusinesses(token: string): Promise<{ id: string; name: string }[]> {
  const out: { id: string; name: string }[] = []
  let url: string | undefined = `${G()}/me/businesses?${authParams(token, { fields: 'id,name', limit: '100' })}`
  let pages = 0
  while (url && pages < 10) {
    const page: { data?: { id: string; name?: string }[]; paging?: { next?: string } } = await graphGet(url)
    for (const b of page.data ?? []) if (/^\d{5,25}$/.test(b.id)) out.push({ id: b.id, name: (b.name || b.id).slice(0, 160) })
    const next = page.paging?.next
    url = isGraphUrl(next) ? next : undefined
    pages += 1
  }
  return out
}

// ============================================================================
// Enriquecimento por conta: gasto diário, ROAS, término e última alteração
// ============================================================================

type ActionValue = { action_type: string; value: string }
const PURCHASE_TYPES = ['omni_purchase', 'purchase', 'offsite_conversion.fb_pixel_purchase', 'onsite_web_purchase']

/** Usa o primeiro tipo de compra presente (evita somar o mesmo evento duas vezes). */
export function firstPurchase(list: ActionValue[] | undefined): number {
  for (const t of PURCHASE_TYPES) {
    const hit = list?.find((a) => a.action_type === t)
    if (hit) return Number(hit.value) || 0
  }
  return 0
}

/** Data (YYYY-MM-DD) no fuso de São Paulo, deslocada em dias. */
export function spDate(offsetDays = 0, base = new Date()): string {
  const d = new Date(base.getTime() + offsetDays * 86_400_000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

export type AccountEnrichment = {
  spend_month: number
  spend_yesterday: number
  spend_7d: number
  revenue_month: number
  roas_month: number | null
  ends_at: string | null
  runs_continuously: boolean
  last_change_at: string | null
  active_adsets: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

export async function enrichAccount(token: string, actId: string): Promise<AccountEnrichment> {
  const today = spDate(0)
  const monthStart = `${today.slice(0, 8)}01`
  const weekStart = spDate(-7)
  const yesterday = spDate(-1)
  const since = monthStart < weekStart ? monthStart : weekStart

  const [insights, adsets] = await Promise.all([
    graphGet<{ data?: { date_start: string; spend?: string; action_values?: ActionValue[] }[] }>(
      `${G()}/${actId}/insights?${authParams(token, {
        fields: 'spend,action_values',
        time_range: JSON.stringify({ since, until: today }),
        time_increment: '1',
        limit: '62',
      })}`,
    ),
    graphGet<{ data?: { end_time?: string; updated_time?: string; effective_status?: string }[] }>(
      `${G()}/${actId}/adsets?${authParams(token, { fields: 'end_time,updated_time,effective_status', limit: '200' })}`,
    ),
  ])

  let spend_month = 0
  let spend_yesterday = 0
  let spend_7d = 0
  let revenue_month = 0
  for (const row of insights.data ?? []) {
    const spend = Number(row.spend ?? 0) || 0
    if (row.date_start >= monthStart) {
      spend_month += spend
      revenue_month += firstPurchase(row.action_values)
    }
    if (row.date_start === yesterday) spend_yesterday = spend
    if (row.date_start >= weekStart && row.date_start <= yesterday) spend_7d += spend
  }

  let ends_at: string | null = null
  let runs_continuously = false
  let last_change_at: string | null = null
  let active_adsets = 0
  for (const a of adsets.data ?? []) {
    if (a.updated_time) {
      const iso = new Date(a.updated_time).toISOString()
      if (!last_change_at || iso > last_change_at) last_change_at = iso
    }
    if (a.effective_status !== 'ACTIVE') continue
    active_adsets += 1
    if (!a.end_time) runs_continuously = true
    else {
      const iso = new Date(a.end_time).toISOString()
      if (!ends_at || iso > ends_at) ends_at = iso
    }
  }

  return {
    spend_month: round2(spend_month),
    spend_yesterday: round2(spend_yesterday),
    spend_7d: round2(spend_7d),
    revenue_month: round2(revenue_month),
    roas_month: spend_month > 0 ? round2(revenue_month / spend_month) : null,
    ends_at,
    runs_continuously,
    last_change_at,
    active_adsets,
  }
}

// ============================================================================
// Relatórios: métricas do período e melhores anúncios
// ============================================================================

export type PeriodMetrics = { spend: number; reach: number; impressions: number; clicks: number; purchases: number; revenue: number }

export async function fetchPeriodMetrics(token: string, actId: string, since: string, until: string): Promise<PeriodMetrics> {
  const res = await graphGet<{ data?: { spend?: string; reach?: string; impressions?: string; clicks?: string; actions?: ActionValue[]; action_values?: ActionValue[] }[] }>(
    `${G()}/${actId}/insights?${authParams(token, { fields: 'spend,reach,impressions,clicks,actions,action_values', time_range: JSON.stringify({ since, until }) })}`,
  )
  const r = res.data?.[0]
  return {
    spend: Number(r?.spend ?? 0) || 0,
    reach: Number(r?.reach ?? 0) || 0,
    impressions: Number(r?.impressions ?? 0) || 0,
    clicks: Number(r?.clicks ?? 0) || 0,
    purchases: firstPurchase(r?.actions),
    revenue: firstPurchase(r?.action_values),
  }
}

export async function fetchTopAds(token: string, actId: string, since: string, until: string): Promise<{ name: string; purchases: number; spend: number }[]> {
  const res = await graphGet<{ data?: { ad_name?: string; spend?: string; actions?: ActionValue[] }[] }>(
    `${G()}/${actId}/insights?${authParams(token, { level: 'ad', fields: 'ad_name,spend,actions', time_range: JSON.stringify({ since, until }), limit: '200' })}`,
  )
  return (res.data ?? []).map((a) => ({ name: (a.ad_name || 'Anúncio').slice(0, 80), purchases: firstPurchase(a.actions), spend: Number(a.spend ?? 0) || 0 }))
}
