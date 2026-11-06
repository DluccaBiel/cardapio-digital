import { authenticate, isResponse } from '@/lib/api/auth'
import { err, ok, preflight } from '@/lib/api/http'

export const dynamic = 'force-dynamic'
export const OPTIONS = preflight

/** Diagnóstico da chave: workspace, escopos. Usado pela extensão em "Testar conexão". */
export async function GET(req: Request) {
  const auth = await authenticate(req, null)
  if (isResponse(auth)) return auth
  const { data: ws } = await auth.ctx.db.from('workspaces').select('id, name, slug').eq('id', auth.workspaceId).maybeSingle()
  if (!ws) return err(req, 'not_found', 'Workspace não encontrado.')
  return ok(req, { workspace: ws, scopes: auth.scopes, extension_id: auth.extensionId })
}
