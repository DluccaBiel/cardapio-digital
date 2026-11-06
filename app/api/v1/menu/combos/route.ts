import { authenticate, isResponse } from '@/lib/api/auth'
import { err, fromFail, ok, preflight, readJson } from '@/lib/api/http'
import { rowEtag } from '@/lib/menu/model'
import { saveCombo } from '@/lib/menu/mutations'

export const dynamic = 'force-dynamic'
export const OPTIONS = preflight

/**
 * Cria um combo no Orvia (ex.: sugestão da análise da extensão).
 * Sempre nasce PAUSADO (status forçado), para revisão no painel.
 * Edição de combo existente é feita no painel (PATCH genérico em /menu/items/{id} cobre nome/preço/status).
 */
export async function POST(req: Request) {
  const auth = await authenticate(req, 'catalogo:escrever')
  if (isResponse(auth)) return auth
  const body = (await readJson(req)) as Record<string, unknown> | undefined
  if (!body || typeof body !== 'object') return err(req, 'invalid_input', 'JSON inválido.')
  const { id: _ignored, expected: _ignored2, ...rest } = body
  const res = await saveCombo(auth.ctx, { ...rest, status: 'inactive' })
  if (!res.ok) return fromFail(req, res)
  return ok(req, res.data, { status: 201, headers: { ETag: rowEtag(res.data.updated_at) } })
}
