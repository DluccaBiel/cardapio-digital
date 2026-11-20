import { authenticate, isResponse } from '@/lib/api/auth'
import { ok, preflight } from '@/lib/api/http'
import { ensureSdrDefaults } from '@/lib/sdr/core'

export const dynamic = 'force-dynamic'
export const OPTIONS = preflight

/**
 * GET /api/v1/sdr/inbox — o que precisa de você: leads que pediram humano, respostas da IA
 * aguardando aprovação e lembretes vencidos. A extensão mostra como contador/alerta.
 */
export async function GET(req: Request) {
  const auth = await authenticate(req, 'sdr:ler')
  if (isResponse(auth)) return auth
  const db = auth.ctx.db
  await ensureSdrDefaults(db, auth.workspaceId)
  const now = new Date().toISOString()
  const [human, approvals, reminders, robot] = await Promise.all([
    db.from('prospect_leads').select('id, name, phone, stage, handoff_reason, last_inbound_at').eq('workspace_id', auth.workspaceId).eq('needs_human', true).order('last_inbound_at', { ascending: false }).limit(50),
    db
      .from('sdr_tasks')
      .select('id, body, created_at, updated_at, prospect_leads ( id, name, phone )')
      .eq('workspace_id', auth.workspaceId)
      .eq('status', 'aguardando_aprovacao')
      .order('created_at')
      .limit(50),
    db
      .from('sdr_notes')
      .select('id, body, remind_at, updated_at, prospect_leads ( id, name, phone )')
      .eq('workspace_id', auth.workspaceId)
      .eq('done', false)
      .lte('remind_at', now)
      .order('remind_at')
      .limit(50),
    db.from('whatsapp_sessions').select('status, worker_seen_at').eq('workspace_id', auth.workspaceId).maybeSingle(),
  ])
  const one = (v: any) => (Array.isArray(v) ? v[0] : v)
  const seen = robot.data?.worker_seen_at ? Date.parse(robot.data.worker_seen_at) : 0
  return ok(req, {
    needs_human: human.data ?? [],
    awaiting_approval: (approvals.data ?? []).map((t: any) => ({ id: t.id, body: t.body, created_at: t.created_at, etag: `"${t.updated_at}"`, lead: one(t.prospect_leads) })),
    reminders: (reminders.data ?? []).map((n: any) => ({ id: n.id, body: n.body, remind_at: n.remind_at, etag: `"${n.updated_at}"`, lead: one(n.prospect_leads) })),
    robot: { online: Date.now() - seen < 30_000, whatsapp: robot.data?.status ?? 'disconnected' },
  })
}
