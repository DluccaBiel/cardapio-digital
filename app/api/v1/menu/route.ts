import { authenticate, isResponse } from '@/lib/api/auth'
import { err, ok, preflight } from '@/lib/api/http'
import { loadCatalog } from '@/lib/menu/load'

export const dynamic = 'force-dynamic'
export const OPTIONS = preflight

/** Catálogo completo do cliente. ETag = versão do catálogo (If-Match da importação). */
export async function GET(req: Request) {
  const auth = await authenticate(req, 'catalogo:ler')
  if (isResponse(auth)) return auth
  const clientId = new URL(req.url).searchParams.get('client_id')
  if (!clientId || !/^[0-9a-f-]{36}$/i.test(clientId)) return err(req, 'invalid_input', 'Informe client_id (uuid).')
  try {
    const catalog = await loadCatalog(auth.ctx.db, auth.workspaceId, clientId)
    if (!catalog) return err(req, 'not_found', 'Cliente não encontrado.')
    return ok(req, catalog, { headers: { ETag: catalog.etag } })
  } catch {
    return err(req, 'internal', 'Falha ao carregar o cardápio.')
  }
}
