import { z } from 'zod'
import { audit } from '@/lib/audit'
import { authenticate, isResponse } from '@/lib/api/auth'
import { err, ok, preflight, readJson } from '@/lib/api/http'
import { parseIfMatch } from '@/lib/menu/model'

export const dynamic = 'force-dynamic'
export const OPTIONS = preflight

const body = z
  .object({
    done: z.boolean().optional(),
    body: z.string().trim().min(1).max(2000).optional(),
    remind_at: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nada para alterar.')

/** PATCH /api/v1/sdr/notes/:id — concluir/editar lembrete. If-Match obrigatório. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const auth = await authenticate(req, 'sdr:escrever')
  if (isResponse(auth)) return auth
  if (!z.string().uuid().safeParse(params.id).success) return err(req, 'invalid_input', 'Nota inválida.')
  const ifMatch = parseIfMatch(req.headers.get('if-match'))
  if (!ifMatch || ifMatch === '*') return err(req, 'precondition_required', 'If-Match obrigatório (ETag da nota).')
  const parsed = body.safeParse(await readJson(req))
  if (!parsed.success) return err(req, 'validation_failed', parsed.error.issues[0]?.message ?? 'Dados inválidos.')
  const db = auth.ctx.db
  const { data, error } = await db
    .from('sdr_notes')
    .update(parsed.data)
    .eq('workspace_id', auth.workspaceId)
    .eq('id', params.id)
    .eq('updated_at', ifMatch)
    .select('id, body, remind_at, done, created_at, updated_at')
    .maybeSingle()
  if (error) return err(req, 'internal', 'Não consegui salvar a nota.')
  if (!data) {
    const { data: cur } = await db.from('sdr_notes').select('updated_at').eq('workspace_id', auth.workspaceId).eq('id', params.id).maybeSingle()
    return cur ? err(req, 'conflict', 'A nota mudou. Recarregue.', { current: { etag: `"${cur.updated_at}"` } }) : err(req, 'not_found', 'Nota não encontrada.')
  }
  void audit
  return ok(req, data, { headers: { ETag: `"${data.updated_at}"` } })
}
