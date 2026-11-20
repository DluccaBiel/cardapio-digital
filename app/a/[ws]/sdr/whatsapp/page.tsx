import { notFound } from 'next/navigation'
import { getWorkspaceBySlug } from '../../../../../lib/db/workspaces'
import { googleAppConfig } from '../../../../../lib/google/calendar'
import { ensureSdrDefaults, STAGE_LABEL, STAGES } from '../../../../../lib/sdr/core'
import { createServerClient } from '../../../../../lib/supabaseServer'
import { SdrWhatsappScreen } from '../../../../../components/hub/sdr/SdrWhatsappScreen'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Undercut — SDR WhatsApp' }

export default async function SdrWhatsappPage({ params, searchParams }: { params: { ws: string }; searchParams: { tab?: string; google?: string; lead?: string } }) {
  const workspace = await getWorkspaceBySlug(params.ws)
  if (!workspace) notFound()
  const db = createServerClient()
  const canManage = ['owner', 'coordenador'].includes(workspace.role)
  const canOperate = canManage || workspace.role === 'editor'
  if (canManage) await ensureSdrDefaults(db, workspace.id).catch(() => undefined)

  const [settings, leads, cadences, quick, google, robot, awaiting] = await Promise.all([
    db.from('sdr_settings').select('*').eq('workspace_id', workspace.id).maybeSingle(),
    db
      .from('prospect_leads')
      .select('id, name, phone, city, uf, category, stage, status, deal_value, score, needs_human, handoff_reason, ai_paused, last_inbound_at, last_outbound_at, meeting_at, source')
      .eq('workspace_id', workspace.id)
      .not('status', 'in', '(invalido)')
      .order('needs_human', { ascending: false })
      .order('last_inbound_at', { ascending: false, nullsFirst: false })
      .limit(600),
    db.from('sdr_cadences').select('id, name, stage, active, steps').eq('workspace_id', workspace.id).order('created_at'),
    db.from('sdr_quick_replies').select('id, stage, title, body').eq('workspace_id', workspace.id).order('sort_order'),
    db.from('google_connections').select('email, status, last_error').eq('workspace_id', workspace.id).maybeSingle(),
    db.from('whatsapp_sessions').select('status, worker_seen_at').eq('workspace_id', workspace.id).maybeSingle(),
    db.from('sdr_tasks').select('lead_id').eq('workspace_id', workspace.id).eq('status', 'aguardando_aprovacao'),
  ])
  const missing = Boolean(settings.error || leads.error)
  const seen = robot.data?.worker_seen_at ? Date.parse(robot.data.worker_seen_at) : 0

  return (
    <SdrWhatsappScreen
      ws={workspace.slug}
      canManage={canManage}
      canOperate={canOperate}
      missingMigration={missing}
      initialTab={['funil', 'conversas', 'config'].includes(searchParams.tab ?? '') ? (searchParams.tab as 'funil' | 'conversas' | 'config') : 'funil'}
      googleStatus={searchParams.google ?? null}
      initialLead={searchParams.lead ?? null}
      settings={settings.data}
      leads={(leads.data ?? []).map((l: any) => ({ ...l, deal_value: l.deal_value == null ? null : Number(l.deal_value) }))}
      cadences={(cadences.data ?? []) as any}
      quickReplies={(quick.data ?? []) as any}
      google={{ appConfigured: Boolean(googleAppConfig()), ...(google.data ?? { email: null, status: null, last_error: null }) }}
      robot={{ online: Date.now() - seen < 30_000, whatsapp: robot.data?.status ?? 'disconnected' }}
      awaitingLeadIds={Array.from(new Set((awaiting.data ?? []).map((t: any) => t.lead_id)))}
      stages={STAGES.map((key) => ({ key, label: (settings.data?.stage_labels as Record<string, string> | undefined)?.[key] ?? STAGE_LABEL[key] }))}
    />
  )
}
