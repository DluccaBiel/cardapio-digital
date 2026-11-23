/**
 * Tipos e carga inicial da tela Relatórios (server component lê com sessão/RLS).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { DEFAULT_SHOW, PERIOD_KEYS, type CampaignMode, type PeriodKey, type Show } from './format'

export type AccountView = { id: string; name: string; externalId: string; clientName: string | null; status: string | null; watched: boolean }
export type TargetView = { id: string; ad_account_id: string; group_jid: string | null; group_name: string | null; campaign_mode: CampaignMode; campaign_ids: string[] }
export type GroupView = { jid: string; name: string; participants: number }
export type HistoryRow = {
  id: string
  title: string
  period_since: string
  period_until: string
  status: 'rascunho' | 'agendado' | 'enviando' | 'enviado' | 'falhou' | 'cancelado'
  group_name: string | null
  scheduled_at: string | null
  sent_at: string | null
  error: string | null
  created_at: string
  message: string
  schedule_id: string | null
}
export type ScheduleView = {
  id: string
  name: string
  active: boolean
  days_of_week: number[]
  send_time: string
  period_key: PeriodKey
  compare: boolean
  target_ids: string[]
  interval_min_seconds: number
  interval_max_seconds: number
  next_run_at: string | null
  last_run_at: string | null
  last_error: string | null
}
export type SettingsView = { show: Show; period: PeriodKey; compare: boolean; intervalMin: number; intervalMax: number }

export type ReportsData = {
  ready: boolean
  accounts: AccountView[]
  targets: TargetView[]
  groups: GroupView[]
  groupsSyncedAt: string | null
  settings: SettingsView
  schedules: ScheduleView[]
  history: HistoryRow[]
}

export const DEFAULT_SETTINGS: SettingsView = { show: DEFAULT_SHOW, period: 'last', compare: true, intervalMin: 60, intervalMax: 180 }

export async function loadReportsData(db: SupabaseClient, workspaceId: string): Promise<ReportsData> {
  const [acc, tg, gr, st, sc, hi, se] = await Promise.all([
    db.from('ad_accounts').select('id, name, external_account_id, status, is_watched, clients ( name )').eq('workspace_id', workspaceId).eq('platform', 'meta').order('name'),
    db.from('report_targets').select('id, ad_account_id, group_jid, group_name, campaign_mode, campaign_ids').eq('workspace_id', workspaceId),
    db.from('whatsapp_groups').select('jid, name, participants').eq('workspace_id', workspaceId).order('name').limit(1000),
    db.from('report_settings').select('blocks, period_key, compare, interval_min_seconds, interval_max_seconds').eq('workspace_id', workspaceId).maybeSingle(),
    db.from('report_schedules').select('id, name, active, days_of_week, send_time, period_key, compare, target_ids, interval_min_seconds, interval_max_seconds, next_run_at, last_run_at, last_error').eq('workspace_id', workspaceId).order('created_at'),
    db.from('reports').select('id, title, period_since, period_until, status, group_name, scheduled_at, sent_at, error, created_at, message, schedule_id').eq('workspace_id', workspaceId).order('created_at', { ascending: false }).limit(100),
    db.from('whatsapp_sessions').select('groups_synced_at').eq('workspace_id', workspaceId).maybeSingle(),
  ])
  const accounts: AccountView[] = ((acc.data ?? []) as any[]).map((a) => {
    const c = Array.isArray(a.clients) ? a.clients[0] : a.clients
    return { id: a.id, name: a.name, externalId: a.external_account_id, clientName: c?.name ?? null, status: a.status ?? null, watched: Boolean(a.is_watched) }
  })
  // Acompanhadas primeiro; depois por cliente/nome.
  accounts.sort((x, y) => Number(y.watched) - Number(x.watched) || (x.clientName ?? x.name).localeCompare(y.clientName ?? y.name, 'pt-BR'))
  const s = st.data
  const settings: SettingsView = s
    ? {
        show: { ...DEFAULT_SHOW, ...((s.blocks as Partial<Show>) ?? {}) },
        period: (PERIOD_KEYS as readonly string[]).includes(s.period_key) ? (s.period_key as PeriodKey) : 'last',
        compare: Boolean(s.compare),
        intervalMin: s.interval_min_seconds,
        intervalMax: s.interval_max_seconds,
      }
    : DEFAULT_SETTINGS
  return {
    ready: !tg.error && !hi.error,
    accounts,
    targets: (tg.data ?? []) as TargetView[],
    groups: (gr.data ?? []) as GroupView[],
    groupsSyncedAt: (se.data as { groups_synced_at?: string | null } | null)?.groups_synced_at ?? null,
    settings,
    schedules: (sc.data ?? []) as ScheduleView[],
    history: (hi.data ?? []) as HistoryRow[],
  }
}
