import { z } from 'zod'
import { audit } from '@/lib/audit'
import { authenticate, isResponse } from '@/lib/api/auth'
import { err, ok, preflight, readJson } from '@/lib/api/http'
import { parseIfMatch } from '@/lib/menu/model'

export const dynamic = 'force-dynamic'
export const OPTIONS = preflight

const body = z.object({
  action: z.enum(['approve', 'cancel']),
  /** Ao aprovar, pode corrigir o texto sugerido pela IA. */
  body: z.string().trim().min(1).max(4000).optional(),
})

/** PATCH /api/v1/sdr/tasks/:id — aprovar (com edição) ou cancelar um envio. If-Match obrigatório. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const auth = await authenticate(req, 'sdr:escrever')
  if (isResponse(auth)) return auth
  if (!z.string().uuid().safeParse(params.id).success) return err(req, 'invalid_input', 'Envio inválido.')
  const ifMatch = parseIfMatch(req.headers.get('if-match'))
  if (!ifMatch || ifMatch === '*') return err(req, 'precondition_required', 'If-Match obrigatório (ETag do envio).')
  const parsed = body.safeParse(await readJson(req))
  if (!parsed.success) return err(req, 'validation_failed', 'Ação inválida.')
  const { action, body: text } = parsed.data
  const patch = action === 'approve' ? { status: 'pendente', scheduled_at: new Date().toISOString(), ...(text ? { body: text } : {}) } : { status: 'cancelada', error: 'cancelado pelo usuário' }
  const allowedFrom = action === 'approve' ? ['aguardando_aprovacao'] : ['aguardando_aprovacao', 'pendente', 'falhou']
  const db = auth.ctx.db
  const { data, error } = await db
    .from('sdr_tasks')
    .update(patch)
    .eq('workspace_id', auth.workspaceId)
    .eq('id', params.id)
    .eq('updated_at', ifMatch)
    .in('status', allowedFrom)
    .select('id, kind, body, status, scheduled_at, updated_at')
    .maybeSingle()
  if (error) return err(req, 'internal', 'Não consegui atualizar o envio.')
  if (!data) {
    const { data: cur } = await db.from('sdr_tasks').select('status, updated_at').eq('workspace_id', auth.workspaceId).eq('id', params.id).maybeSingle()
    if (!cur) return err(req, 'not_found', 'Envio não encontrado.')
    return err(req, 'conflict', cur.status === 'enviada' ? 'Esta mensagem já foi enviada.' : 'O envio mudou. Recarregue.', { current: { etag: `"${cur.updated_at}"`, status: cur.status } })
  }
  await audit({ workspaceId: auth.workspaceId, actorType: 'api_key', actorId: auth.keyId, action: `sdr_task.${action}`, entityType: 'sdr_task', entityId: params.id })
  return ok(req, data, { headers: { ETag: `"${data.updated_at}"` } })
}
