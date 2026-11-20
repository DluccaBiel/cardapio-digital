import { z } from 'zod'
import { audit } from '@/lib/audit'
import { authenticate, isResponse } from '@/lib/api/auth'
import { err, ok, preflight, readJson } from '@/lib/api/http'
import { parseIfMatch } from '@/lib/menu/model'

export const dynamic = 'force-dynamic'
export const OPTIONS = preflight
void parseIfMatch

const body = z.object({
  body: z.string().trim().min(1).max(2000),
  remind_at: z.string().datetime({ offset: true }).nullable().optional(),
})

/** POST /api/v1/sdr/leads/:id/notes — nota ou lembrete (remind_at). */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await authenticate(req, 'sdr:escrever')
  if (isResponse(auth)) return auth
  if (!z.string().uuid().safeParse(params.id).success) return err(req, 'invalid_input', 'Lead inválido.')
  const parsed = body.safeParse(await readJson(req))
  if (!parsed.success) return err(req, 'validation_failed', 'Escreva a nota (e uma data válida para o lembrete).')
  const db = auth.ctx.db
  const { data: lead } = await db.from('prospect_leads').select('id').eq('workspace_id', auth.workspaceId).eq('id', params.id).maybeSingle()
  if (!lead) return err(req, 'not_found', 'Lead não encontrado.')
  const { data, error } = await db
    .from('sdr_notes')
    .insert({ workspace_id: auth.workspaceId, lead_id: params.id, body: parsed.data.body, remind_at: parsed.data.remind_at ?? null })
    .select('id, body, remind_at, done, created_at, updated_at')
    .single()
  if (error || !data) return err(req, 'internal', 'Não consegui salvar a nota.')
  await audit({ workspaceId: auth.workspaceId, actorType: 'api_key', actorId: auth.keyId, action: 'sdr_note.create', entityType: 'sdr_note', entityId: data.id })
  return ok(req, data, { status: 201, headers: { ETag: `"${data.updated_at}"` } })
}
