import { createServerClient } from '../supabaseServer'

export type WhatsappStatus = 'disconnected' | 'starting' | 'qr' | 'connecting' | 'syncing' | 'ready' | 'logged_out' | 'error'

export type WhatsappSession = {
  desired_state: 'connected' | 'disconnected'
  status: WhatsappStatus
  qr_data_url: string | null
  qr_updated_at: string | null
  phone: string | null
  display_name: string | null
  sync_progress: number | null
  sync_detail: string | null
  last_error: string | null
  worker_seen_at: string | null
  connected_at: string | null
}

export type ProspectLead = {
  id: string
  name: string
  phone: string
  category: string | null
  city: string | null
  uf: string | null
  address: string | null
  website: string | null
  status: 'novo' | 'na_fila' | 'contatado' | 'respondeu' | 'opt_out' | 'invalido'
  found_at: string
}

export type Campaign = {
  id: string
  name: string
  message: string
  status: 'agendada' | 'enviando' | 'pausada' | 'concluida' | 'cancelada'
  start_date: string
  days_of_week: number[]
  window_start: string
  window_end: string
  interval_min_seconds: number
  interval_max_seconds: number
  daily_limit: number
  total: number
  sent_count: number
  failed_count: number
  next_send_at: string | null
  last_error: string | null
  created_at: string
}

export const SESSION_FIELDS =
  'desired_state, status, qr_data_url, qr_updated_at, phone, display_name, sync_progress, sync_detail, last_error, worker_seen_at, connected_at'

export async function getWhatsappSession(workspaceId: string): Promise<WhatsappSession | null> {
  const db = createServerClient()
  const { data } = await db.from('whatsapp_sessions').select(SESSION_FIELDS).eq('workspace_id', workspaceId).maybeSingle()
  return (data as WhatsappSession | null) ?? null
}

/** Dados da tela Disparos. `ready=false` quando a migration ainda não foi aplicada. */
export async function loadDisparos(workspaceId: string): Promise<{ ready: boolean; session: WhatsappSession | null; leads: ProspectLead[]; campaigns: Campaign[] }> {
  const db = createServerClient()
  const [leads, campaigns, session] = await Promise.all([
    db
      .from('prospect_leads')
      .select('id, name, phone, category, city, uf, address, website, status, found_at')
      .eq('workspace_id', workspaceId)
      .order('found_at', { ascending: false })
      .limit(1000),
    db
      .from('broadcast_campaigns')
      .select('id, name, message, status, start_date, days_of_week, window_start, window_end, interval_min_seconds, interval_max_seconds, daily_limit, total, sent_count, failed_count, next_send_at, last_error, created_at')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(50),
    db.from('whatsapp_sessions').select(SESSION_FIELDS).eq('workspace_id', workspaceId).maybeSingle(),
  ])
  if (leads.error || campaigns.error) return { ready: false, session: null, leads: [], campaigns: [] }
  return {
    ready: true,
    session: (session.data as WhatsappSession | null) ?? null,
    leads: (leads.data ?? []) as ProspectLead[],
    campaigns: (campaigns.data ?? []) as Campaign[],
  }
}
