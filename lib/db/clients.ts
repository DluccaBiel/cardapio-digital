import { createServerClient } from '../supabaseServer'

export type TagRow = { id: string; name: string; color: string }

export type ClientTagLink = { tag_id: string; tags: TagRow | null }

export type ClientWithMeta = {
  id: string
  workspace_id: string
  name: string
  segment: string
  situation: 'ativo' | 'onboarding' | 'stand_by' | 'churn'
  campaign_state: string
  creative_status: string
  delivery_state: string
  editor: string
  termination_date: string | null
  last_change_at: string
  has_alert: boolean
  pix_paid_at: string | null
  pix_amount: number | null
  routine_week: string | null
  routine_report: boolean
  routine_upload: boolean
  routine_ia: boolean
  routine_share: boolean
  routine_note: boolean
  routine_camera: boolean
  status: string
  monthly_fee: number | null
  client_tags: ClientTagLink[]
  ad_accounts: { id: string; balance: number; spend_month: number; is_watched: boolean }[]
}

export async function listClientsWithMeta(workspaceId: string): Promise<ClientWithMeta[]> {
  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('clients')
    .select(`
      id, workspace_id, name, segment, situation, campaign_state, creative_status, delivery_state,
      editor, termination_date, last_change_at, has_alert, pix_paid_at, pix_amount,
      routine_week, routine_report, routine_upload, routine_ia, routine_share, routine_note, routine_camera,
      status, monthly_fee,
      client_tags ( tag_id, tags ( id, name, color ) ),
      ad_accounts ( id, balance, spend_month, is_watched )
    `)
    .eq('workspace_id', workspaceId)
    .order('name', { ascending: true })

  if (error) throw new Error(`Falha ao ler clientes: ${error.message}`)
  return (data ?? []) as unknown as ClientWithMeta[]
}

export async function listTags(workspaceId: string): Promise<TagRow[]> {
  const supabase = createServerClient()
  const { data, error } = await supabase.from('tags').select('id, name, color').eq('workspace_id', workspaceId).order('name')
  if (error) throw new Error(`Falha ao ler tags: ${error.message}`)
  return (data ?? []) as TagRow[]
}
