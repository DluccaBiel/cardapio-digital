import { z } from 'zod'
import { audit } from '@/lib/audit'
import { authenticate, isResponse } from '@/lib/api/auth'
import { err, ok, preflight, readJson } from '@/lib/api/http'
import { parseIfMatch } from '@/lib/menu/model'
import { renderTemplate } from '@/lib/sdr/core'

export const dynamic = 'force-dynamic'
export const OPTIONS = preflight
void parseIfMatch

const body = z.object({ body: z.string().trim().min(1).max(4000) })

/**
 * POST /api/v1/sdr/leads/:id/send — pede ao robô para enviar agora (resposta manual pelo painel).
 * É resposta a uma conversa: não espera a janela de envio. Opt-out nunca recebe.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await authenticate(req, 'sdr:escrever')
  if (isResponse(auth)) return auth
  if (!z.string().uuid().safeParse(params.id).success) return err(req, 'invalid_input', 'Lead inválido.')
  const parsed = body.safeParse(await readJson(req))
  if (!parsed.success) return err(req, 'validation_failed', 'Escreva a mensagem.')
  const db = auth.ctx.db
  const { data: lead } = await db.from('prospect_leads').select('id, name, status').eq('workspace_id', auth.workspaceId).eq('id', params.id).maybeSingle()
  if (!lead) return err(req, 'not_found', 'Lead não encontrado.')
  if (lead.status === 'opt_out') return err(req, 'validation_failed', 'Este lead pediu para não receber mensagens (opt-out).')
  const { data, error } = await db
    .from('sdr_tasks')
    .insert({ workspace_id: auth.workspaceId, lead_id: params.id, kind: 'manual', body: renderTemplate(parsed.data.body, lead), respects_window: false })
    .select('id, kind, body, status, scheduled_at, updated_at')
    .single()
  if (error || !data) return err(req, 'internal', 'Não consegui colocar a mensagem na fila.')
  await audit({ workspaceId: auth.workspaceId, actorType: 'api_key', actorId: auth.keyId, action: 'sdr_task.create', entityType: 'sdr_task', entityId: data.id, metadata: { kind: 'manual' } })
  return ok(req, data, { status: 201, headers: { ETag: `"${data.updated_at}"` } })
}
