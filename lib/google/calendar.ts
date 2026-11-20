/**
 * Google Agenda para a IA do SDR — SOMENTE servidor.
 *
 *   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET  app OAuth do Google Cloud (Calendar API ligada)
 *   META_TOKEN_KEY                           mesma chave AES-256-GCM dos tokens (lib/meta/crypto)
 *
 * Fluxo: /api/google/oauth/start → consentimento → /api/google/oauth/callback grava o refresh
 * token CRIPTOGRAFADO (google_tokens, só service role). A IA pede horários livres (freeBusy) e
 * cria o evento com link do Meet. Nunca logamos tokens.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { brand } from '@undercut/brand'
import { decryptToken, encryptToken } from '../meta/crypto'

export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.freebusy',
]
export const GOOGLE_STATE_COOKIE = 'uc_google_oauth'

/** Simulador local (testes): só fora de produção e só http://localhost/127.0.0.1. */
function localOverride(name: string): string | null {
  if (process.env.NODE_ENV === 'production') return null
  const v = process.env[name]?.trim()
  return v && /^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}$/.test(v) ? v : null
}
const AUTH_BASE = () => localOverride('GOOGLE_AUTH_BASE_URL') ?? 'https://accounts.google.com'
const TOKEN_URL = () => `${localOverride('GOOGLE_OAUTH_BASE_URL') ?? 'https://oauth2.googleapis.com'}/token`
const API_BASE = () => localOverride('GOOGLE_API_BASE_URL') ?? 'https://www.googleapis.com'

export function googleAppConfig(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim()
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim()
  if (!clientId || !clientSecret || !/\.apps\.googleusercontent\.com$/.test(clientId)) return null
  return { clientId, clientSecret }
}

/** Mesmo princípio da Meta: em produção o redirect é sempre o endereço oficial. */
export function googleOrigin(requestOrigin: string, vercelEnv = process.env.VERCEL_ENV): string {
  return vercelEnv === 'production' ? new URL(brand.baseUrl).origin : requestOrigin
}

export function consentUrl(clientId: string, redirectUri: string, state: string): string {
  const qs = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent', // garante o refresh token
    include_granted_scopes: 'true',
    state,
  })
  return `${AUTH_BASE()}/o/oauth2/v2/auth?${qs}`
}

export class GoogleError extends Error {}

async function postToken(params: Record<string, string>): Promise<any> {
  const res = await fetch(TOKEN_URL(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new GoogleError(json?.error === 'invalid_grant' ? 'Acesso ao Google Agenda expirou ou foi revogado — conecte de novo.' : `Google respondeu ${res.status}.`)
  return json
}

/** code → refresh token + e-mail da conta. */
export async function exchangeGoogleCode(code: string, redirectUri: string): Promise<{ refreshToken: string; email: string | null }> {
  const app = googleAppConfig()
  if (!app) throw new GoogleError('App do Google não configurado (GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET).')
  const tok = await postToken({ code, client_id: app.clientId, client_secret: app.clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' })
  if (!tok.refresh_token) throw new GoogleError('O Google não devolveu acesso permanente. Remova o app em myaccount.google.com/permissions e conecte de novo.')
  let email: string | null = null
  try {
    const payload = JSON.parse(Buffer.from(String(tok.id_token).split('.')[1] ?? '', 'base64url').toString('utf8'))
    email = typeof payload.email === 'string' ? payload.email.slice(0, 200) : null
  } catch {
    email = null
  }
  return { refreshToken: tok.refresh_token, email }
}

export async function saveGoogleConnection(admin: SupabaseClient, workspaceId: string, refreshToken: string, email: string | null, userId: string): Promise<void> {
  const { error: e1 } = await admin
    .from('google_connections')
    .upsert({ workspace_id: workspaceId, email, status: 'active', last_error: null, connected_by: userId }, { onConflict: 'workspace_id' })
  const { error: e2 } = await admin.from('google_tokens').upsert({ workspace_id: workspaceId, refresh_ciphertext: encryptToken(refreshToken) }, { onConflict: 'workspace_id' })
  if (e1 || e2) throw new GoogleError('Não consegui salvar a conexão com o Google.')
}

// ---------------------------------------------------------------------------
// Agenda (freeBusy + evento com Meet)
// ---------------------------------------------------------------------------
export type Calendar = {
  connected: boolean
  busy(fromIso: string, toIso: string): Promise<{ start: string; end: string }[]>
  createMeeting(input: { startIso: string; minutes: number; title: string; description: string }): Promise<{ id: string; meetLink: string | null; htmlLink: string | null }>
}

export async function workspaceCalendar(admin: SupabaseClient, workspaceId: string): Promise<Calendar> {
  const notConnected: Calendar = {
    connected: false,
    busy: async () => {
      throw new GoogleError('Google Agenda não conectado.')
    },
    createMeeting: async () => {
      throw new GoogleError('Google Agenda não conectado.')
    },
  }
  const app = googleAppConfig()
  if (!app) return notConnected
  const [{ data: conn }, { data: tok }] = await Promise.all([
    admin.from('google_connections').select('calendar_id, status').eq('workspace_id', workspaceId).maybeSingle(),
    admin.from('google_tokens').select('refresh_ciphertext').eq('workspace_id', workspaceId).maybeSingle(),
  ])
  if (!conn || conn.status !== 'active' || !tok) return notConnected
  let refresh: string
  try {
    refresh = decryptToken(tok.refresh_ciphertext)
  } catch {
    return notConnected
  }
  const calendarId = conn.calendar_id || 'primary'
  let access: { token: string; until: number } | null = null
  const token = async () => {
    if (access && access.until > Date.now() + 60_000) return access.token
    try {
      const r = await postToken({ refresh_token: refresh, client_id: app.clientId, client_secret: app.clientSecret, grant_type: 'refresh_token' })
      access = { token: r.access_token, until: Date.now() + (Number(r.expires_in) || 3000) * 1000 }
      return access.token
    } catch (e) {
      await admin.from('google_connections').update({ status: 'error', last_error: e instanceof Error ? e.message.slice(0, 200) : 'erro' }).eq('workspace_id', workspaceId)
      throw e
    }
  }
  const api = async (path: string, init: RequestInit) => {
    const res = await fetch(`${API_BASE()}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    })
    const json = await res.json().catch(() => null)
    if (!res.ok) throw new GoogleError(`Google Agenda respondeu ${res.status}.`)
    return json
  }
  return {
    connected: true,
    async busy(fromIso, toIso) {
      const r = await api('/calendar/v3/freeBusy', { method: 'POST', body: JSON.stringify({ timeMin: fromIso, timeMax: toIso, timeZone: 'America/Sao_Paulo', items: [{ id: calendarId }] }) })
      return (r?.calendars?.[calendarId]?.busy ?? []) as { start: string; end: string }[]
    },
    async createMeeting({ startIso, minutes, title, description }) {
      const start = new Date(startIso)
      const end = new Date(start.getTime() + minutes * 60_000)
      const r = await api(`/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?conferenceDataVersion=1`, {
        method: 'POST',
        body: JSON.stringify({
          summary: title.slice(0, 200),
          description: description.slice(0, 2000),
          start: { dateTime: start.toISOString(), timeZone: 'America/Sao_Paulo' },
          end: { dateTime: end.toISOString(), timeZone: 'America/Sao_Paulo' },
          conferenceData: { createRequest: { requestId: `uc-${start.getTime()}-${Math.random().toString(36).slice(2, 8)}`, conferenceSolutionKey: { type: 'hangoutsMeet' } } },
          reminders: { useDefault: true },
        }),
      })
      const meet = (r?.conferenceData?.entryPoints ?? []).find((p: any) => p.entryPointType === 'video')?.uri ?? r?.hangoutLink ?? null
      return { id: String(r?.id ?? ''), meetLink: meet, htmlLink: r?.htmlLink ?? null }
    },
  }
}

// ---------------------------------------------------------------------------
// Horários livres (puro — testável): janela de reuniões em America/Sao_Paulo (UTC-03:00)
// ---------------------------------------------------------------------------
export type MeetingRules = { meeting_days: number[]; meeting_start: string; meeting_end: string; meeting_minutes: number }

const SP_OFFSET = '-03:00'
const ymdSP = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
const dowSP = (d: Date) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short' }).format(d))

/** Gera candidatos livres nos próximos `days` dias (mín. 2 h de antecedência), até `limit`, espalhados por dia. */
export function freeSlots(rules: MeetingRules, busy: { start: string; end: string }[], now = new Date(), days = 6, limit = 6): { start: string; label: string }[] {
  const minutes = Math.max(10, rules.meeting_minutes)
  const busyR = busy.map((b) => [Date.parse(b.start), Date.parse(b.end)] as const)
  const earliest = now.getTime() + 2 * 3_600_000
  const perDay: { start: string; label: string }[][] = []
  for (let i = 0; i <= days; i++) {
    const day = new Date(now.getTime() + i * 86_400_000)
    if (!rules.meeting_days.includes(dowSP(day))) continue
    const ymd = ymdSP(day)
    const startMs = Date.parse(`${ymd}T${rules.meeting_start.slice(0, 5)}:00${SP_OFFSET}`)
    const endMs = Date.parse(`${ymd}T${rules.meeting_end.slice(0, 5)}:00${SP_OFFSET}`)
    const list: { start: string; label: string }[] = []
    for (let t = startMs; t + minutes * 60_000 <= endMs; t += 30 * 60_000) {
      if (t < earliest) continue
      const tEnd = t + minutes * 60_000
      if (busyR.some(([b0, b1]) => t < b1 && tEnd > b0)) continue
      const d = new Date(t)
      list.push({
        start: d.toISOString(),
        label: new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(d),
      })
    }
    if (list.length) perDay.push(list)
  }
  // 2 por dia (manhã/tarde quando der), nos primeiros dias com vaga
  const out: { start: string; label: string }[] = []
  for (const list of perDay) {
    const pick = list.length > 1 ? [list[0]!, list[Math.floor(list.length / 2)]!] : [list[0]!]
    for (const p of pick) if (out.length < limit) out.push(p)
    if (out.length >= limit) break
  }
  return out
}

export function isSlotFree(startIso: string, minutes: number, busy: { start: string; end: string }[]): boolean {
  const t = Date.parse(startIso)
  const tEnd = t + minutes * 60_000
  return Number.isFinite(t) && !busy.some((b) => t < Date.parse(b.end) && tEnd > Date.parse(b.start))
}
