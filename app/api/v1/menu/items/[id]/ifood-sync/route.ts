import { z } from 'zod'
import { authenticate, isResponse } from '@/lib/api/auth'
import { err, fromFail, ok, preflight, readJson } from '@/lib/api/http'
import { parseIfMatch, rowEtag } from '@/lib/menu/model'
import { markSynced } from '@/lib/menu/mutations'

export const dynamic = 'force-dynamic'
export const OPTIONS = preflight

const body = z.object({ ifood_id: z.string().trim().min(1).max(120).nullish() }).default({})

/**
 * A extensão confirma que o produto/combo foi aplicado no iFood.
 * If-Match = etag recebido em /menu/pending (se o produto mudou no Undercut
 * nesse meio-tempo → 409 e continua pendente). `ifood_id` vincula combos/
 * produtos recém-criados no iFood.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await authenticate(req, 'catalogo:escrever')
  if (isResponse(auth)) return auth
  const ifMatch = parseIfMatch(req.headers.get('if-match'))
  if (!ifMatch || ifMatch === '*') return err(req, 'precondition_required', 'If-Match obrigatório (etag do item pendente).')
  const parsed = body.safeParse((await readJson(req)) ?? {})
  if (!parsed.success) return err(req, 'validation_failed', 'ifood_id inválido.')
  const res = await markSynced(auth.ctx, params.id, ifMatch, parsed.data.ifood_id ?? null)
  if (!res.ok) return fromFail(req, res)
  return ok(req, res.data, { headers: { ETag: rowEtag(res.data.updated_at) } })
}
