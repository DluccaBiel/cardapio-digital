import { z } from 'zod'
import { audit } from '@/lib/audit'
import { authenticate, isResponse } from '@/lib/api/auth'
import { err, ok, preflight, readJson } from '@/lib/api/http'
import { generateAiReply } from '@/lib/sdr/ai'

export const dynamic = 'force-dynamic'
export const maxDuration = 120
export const OPTIONS = preflight

const body = z.object({ lead_id: z.string().uuid() })

/**
 * POST /api/v1/sdr/ai/reply — o robô chama quando um LEAD escreve.
 * Gera a resposta da IA e coloca na fila do robô (modo "auto": sai após ai_reply_delay_seconds;
 * modo "suggest": aguarda aprovação no painel/extensão). Idempotente por mensagem recebida.
 */
export async function POST(req: Request) {
  const auth = await authenticate(req, 'sdr:escrever')
  if (isResponse(auth)) return auth
  const parsed = body.safeParse(await readJson(req))
  if (!parsed.success) return err(req, 'validation_failed', 'lead_id inválido.')
  if (!process.env.ANTHROPIC_API_KEY) return err(req, 'internal', 'IA indisponível: ANTHROPIC_API_KEY não configurada no servidor.')
  const db = auth.ctx.db
  const leadId = parsed.data.lead_id

  // Já existe resposta da IA para a última mensagem do lead? Não gera de novo.
  const { data: lastIn } = await db.from('sdr_messages').select('created_at').eq('workspace_id', auth.workspaceId).eq('lead_id', leadId).eq('direction', 'in').order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (lastIn) {
    const { count } = await db
      .from('sdr_tasks')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', auth.workspaceId)
      .eq('lead_id', leadId)
      .eq('kind', 'ai_reply')
      .in('status', ['aguardando_aprovacao', 'pendente', 'enviando'])
      .gte('created_at', lastIn.created_at)
    if ((count ?? 0) > 0) return ok(req, { action: 'skip', reason: 'já há resposta na fila' })
  }

  let outcome
  try {
    outcome = await generateAiReply(db, auth.workspaceId, leadId)
  } catch (e) {
    console.error('[sdr-ai] falha ao gerar resposta:', e instanceof Error ? e.name : 'erro')
    return err(req, 'internal', 'Falha ao gerar a resposta da IA.')
  }

  const text = outcome.action === 'reply' ? outcome.text : outcome.action === 'handoff' ? outcome.text : undefined
  let taskId: string | null = null
  if (text) {
    const { data: s } = await db.from('sdr_settings').select('ai_mode, ai_reply_delay_seconds').eq('workspace_id', auth.workspaceId).maybeSingle()
    const auto = (s?.ai_mode ?? 'auto') === 'auto'
    const { data: task } = await db
      .from('sdr_tasks')
      .insert({
        workspace_id: auth.workspaceId,
        lead_id: leadId,
        kind: 'ai_reply',
        body: text,
        status: auto ? 'pendente' : 'aguardando_aprovacao',
        respects_window: false, // resposta: 24h
        scheduled_at: new Date(Date.now() + (s?.ai_reply_delay_seconds ?? 45) * 1000).toISOString(),
      })
      .select('id')
      .single()
    taskId = task?.id ?? null
  }
  await audit({
    workspaceId: auth.workspaceId,
    actorType: 'api_key',
    actorId: auth.keyId,
    action: `sdr_ai.${outcome.action}`,
    entityType: 'prospect_lead',
    entityId: leadId,
    metadata: { reason: outcome.action === 'reply' ? null : outcome.reason, booked: outcome.action === 'reply' && !!outcome.booked, task: taskId }, // nunca o texto
  })
  return ok(req, { action: outcome.action, task_id: taskId, ...(outcome.action !== 'reply' ? { reason: outcome.reason } : {}) })
}
