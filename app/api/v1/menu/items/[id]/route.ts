import { authenticate, isResponse } from '@/lib/api/auth'
import { err, fromFail, ok, preflight, readJson } from '@/lib/api/http'
import { parseIfMatch, rowEtag } from '@/lib/menu/model'
import { patchItem } from '@/lib/menu/mutations'

export const dynamic = 'force-dynamic'
export const OPTIONS = preflight

const COLS = 'id, client_id, category_id, kind, sku, name, description, price, status, sort_order, ifood_id, ifood_synced_at, updated_at'

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const auth = await authenticate(req, 'catalogo:ler')
  if (isResponse(auth)) return auth
  const { data } = await auth.ctx.db.from('menu_items').select(COLS).eq('workspace_id', auth.workspaceId).eq('id', params.id).maybeSingle()
  if (!data) return err(req, 'not_found', 'Produto não encontrado.')
  return ok(req, { ...data, price: Number(data.price) }, { headers: { ETag: rowEtag(data.updated_at) } })
}

/** Atualiza name/description/price/status/sku/category_id/sort_order. If-Match obrigatório. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const auth = await authenticate(req, 'catalogo:escrever')
  if (isResponse(auth)) return auth
  const ifMatch = parseIfMatch(req.headers.get('if-match'))
  if (!ifMatch || ifMatch === '*') return err(req, 'precondition_required', 'If-Match obrigatório (ETag do GET do produto).')
  const body = await readJson(req)
  if (body === undefined) return err(req, 'invalid_input', 'JSON inválido.')
  const res = await patchItem(auth.ctx, params.id, ifMatch, body)
  if (!res.ok) return fromFail(req, res)
  return ok(req, res.data, { headers: { ETag: rowEtag(res.data.updated_at) } })
}
