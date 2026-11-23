import { z } from 'zod'
import { audit } from '@/lib/audit'
import { authenticate, isResponse } from '@/lib/api/auth'
import { err, ok, preflight, readJson } from '@/lib/api/http'
import { DEFAULT_SHOW, nextRunAt, PERIOD_KEYS, type PeriodKey, type Show } from '@/lib/reports/format'
import { generateAndQueue, type TargetRow } from '@/lib/reports/generate'

export const dynamic = 'force-dynamic'
export const maxDuration = 300
export const OPTIONS = preflight

const body = z.object({ schedule_id: z.string().uuid() })

/**
 * POST /api/v1/reports/run — o robô chama quando um agendamento venceu (next_run_at <= agora).
 * Reserva a execução (avança next_run_at de forma atômica), consulta a Meta de cada conta e
 * coloca os relatórios na fila do robô com horários escalonados. Escopo relatorios:escrever.
 */
export async function POST(req: Request) {
  const auth = await authenticate(req, 'relatorios:escrever')
  if (isResponse(auth)) return auth
  const parsed = body.safeParse(await readJson(req))
  if (!parsed.success) return err(req, 'validation_failed', 'schedule_id inválido.')
  const db = auth.ctx.db
  const ws = auth.workspaceId

  const { data: s } = await db
    .from('report_schedules')
    .select('id, name, active, days_of_week, send_time, period_key, compare, target_ids, interval_min_seconds, interval_max_seconds, next_run_at')
    .eq('workspace_id', ws)
    .eq('id', parsed.data.schedule_id)
    .maybeSingle()
  if (!s) return err(req, 'not_found', 'Agendamento não encontrado.')
  if (!s.active || !s.next_run_at || Date.parse(s.next_run_at) > Date.now()) return ok(req, { action: 'skip', reason: 'não está na hora' })

  // Reserva: só uma execução por horário, mesmo com dois robôs/chamadas.
  const next = nextRunAt(s.days_of_week as number[], s.send_time as string, new Date(Math.max(Date.now(), Date.parse(s.next_run_at)) + 60_000))
  const { data: claimed } = await db
    .from('report_schedules')
    .update({ next_run_at: next, last_run_at: new Date().toISOString() })
    .eq('workspace_id', ws)
    .eq('id', s.id)
    .eq('next_run_at', s.next_run_at)
    .select('id')
  if (!claimed?.length) return ok(req, { action: 'skip', reason: 'já executado' })

  const [{ data: targets }, { data: settings }, { data: wsRow }] = await Promise.all([
    db.from('report_targets').select('id, ad_account_id, group_jid, group_name, campaign_mode, campaign_ids').eq('workspace_id', ws).in('id', s.target_ids as string[]),
    db.from('report_settings').select('blocks').eq('workspace_id', ws).maybeSingle(),
    db.from('workspaces').select('name').eq('id', ws).maybeSingle(),
  ])
  const show: Show = { ...DEFAULT_SHOW, ...((settings?.blocks as Partial<Show> | null) ?? {}) }
  const period = (PERIOD_KEYS as readonly string[]).includes(s.period_key) ? (s.period_key as PeriodKey) : 'last'

  let result: { queued: number; errors: string[] }
  try {
    result = await generateAndQueue({
      db,
      workspaceId: ws,
      workspaceName: wsRow?.name ?? '',
      targets: (targets ?? []) as TargetRow[],
      period,
      compare: Boolean(s.compare),
      show,
      intervalMin: s.interval_min_seconds,
      intervalMax: s.interval_max_seconds,
      scheduleId: s.id,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 300) : 'falha ao gerar'
    await db.from('report_schedules').update({ last_error: msg }).eq('workspace_id', ws).eq('id', s.id)
    return err(req, 'internal', msg)
  }
  if ((targets ?? []).length < (s.target_ids as string[]).length) result.errors.push('Algumas contas do agendamento não têm mais configuração.')
  await db.from('report_schedules').update({ last_error: result.errors.length ? result.errors.join(' · ').slice(0, 500) : null }).eq('workspace_id', ws).eq('id', s.id)
  await audit({ workspaceId: ws, actorType: 'api_key', actorId: auth.keyId, action: 'reports.schedule_run', entityType: 'report_schedule', entityId: s.id })
  return ok(req, { action: 'queued', queued: result.queued, errors: result.errors, next_run_at: next })
}
