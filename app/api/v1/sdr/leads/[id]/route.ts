import { z } from 'zod'
import { audit } from '@/lib/audit'
import { authenticate, isResponse } from '@/lib/api/auth'
import { err, ok, preflight, readJson } from '@/lib/api/http'
import { parseIfMatch } from '@/lib/menu/model'
import { changeStage, isStage, leadView, stopEnrollment, STAGES } from '@/lib/sdr/core'

export const dynamic = 'force-dynamic'
export const OPTIONS = preflight

const uuid = z.string().uuid()
const patchBody = z
  .object({
    stage: z.enum(STAGES).optional(),
    deal_value: z.number().min(0).max(10_000_000).nullable().optional(),
    name: z.string().trim().min(1).max(200).optional(),
    /** Humano assume a conversa (IA para de responder este lead). */
    ai_paused: z.boolean().optional(),
    /** Resolve o pedido de atendimento humano. */
    needs_human: z.literal(false).optional(),
    opt_out: z.literal(true).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nada para alterar.')

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const auth = await authenticate(req, 'sdr:ler')
  if (isResponse(auth)) return auth
  if (!uuid.safeParse(params.id).success) return err(req, 'invalid_input', 'Lead inválido.')
  const view = await leadView(auth.ctx.db, auth.workspaceId, params.id)
  if (!view) return err(req, 'not_found', 'Lead não encontrado.')
  return ok(req, view, { headers: { ETag: view.lead.etag } })
}

/** PATCH /api/v1/sdr/leads/:id — etapa, valor, pausa da IA, opt-out. If-Match obrigatório. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const auth = await authenticate(req, 'sdr:escrever')
  if (isResponse(auth)) return auth
  if (!uuid.safeParse(params.id).success) return err(req, 'invalid_input', 'Lead inválido.')
  const ifMatch = parseIfMatch(req.headers.get('if-match'))
  if (!ifMatch || ifMatch === '*') return err(req, 'precondition_required', 'If-Match obrigatório (ETag da ficha do lead).')
  const parsed = patchBody.safeParse(await readJson(req))
  if (!parsed.success) return err(req, 'validation_failed', parsed.error.issues[0]?.message ?? 'Dados inválidos.')
  const db = auth.ctx.db
  const { data: cur } = await db.from('prospect_leads').select('id, stage, updated_at').eq('workspace_id', auth.workspaceId).eq('id', params.id).maybeSingle()
  if (!cur) return err(req, 'not_found', 'Lead não encontrado.')
  if (cur.updated_at !== ifMatch) return err(req, 'conflict', 'O lead foi alterado por outra pessoa. Recarregue a ficha.', { current: { etag: `"${cur.updated_at}"` } })

  const v = parsed.data
  const fields: Record<string, unknown> = {}
  if (v.deal_value !== undefined) fields.deal_value = v.deal_value
  if (v.name !== undefined) fields.name = v.name
  if (v.ai_paused !== undefined) fields.ai_paused = v.ai_paused
  if (v.needs_human === false) Object.assign(fields, { needs_human: false, handoff_reason: null })
  if (v.opt_out) Object.assign(fields, { status: 'opt_out', needs_human: false })
  if (Object.keys(fields).length) {
    const { error } = await db.from('prospect_leads').update(fields).eq('workspace_id', auth.workspaceId).eq('id', params.id)
    if (error) return err(req, 'internal', 'Não consegui salvar o lead.')
  }
  if (v.opt_out) await stopEnrollment(db, auth.workspaceId, params.id, 'opt-out')
  if (v.stage && isStage(v.stage) && v.stage !== cur.stage) await changeStage(db, auth.workspaceId, params.id, v.stage)

  await audit({ workspaceId: auth.workspaceId, actorType: 'api_key', actorId: auth.keyId, action: 'sdr_lead.update', entityType: 'prospect_lead', entityId: params.id, metadata: { fields: Object.keys(v) } })
  const view = await leadView(db, auth.workspaceId, params.id)
  return ok(req, view, { headers: view ? { ETag: view.lead.etag } : {} })
}
