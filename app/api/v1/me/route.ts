import { authenticate, isResponse } from '@/lib/api/auth'
import { err, ok, preflight } from '@/lib/api/http'
import { isExtensionSlug, PLATFORM_OF } from '@/lib/api/extensions'

export const dynamic = 'force-dynamic'
export const OPTIONS = preflight

/** Diagnóstico da chave: workspace, escopos. Usado pela extensão em "Testar conexão". */
export async function GET(req: Request) {
  const auth = await authenticate(req, null)
  if (isResponse(auth)) return auth
  const { data: ws } = await auth.ctx.db.from('workspaces').select('id, name, slug').eq('id', auth.workspaceId).maybeSingle()
  if (!ws) return err(req, 'not_found', 'Workspace não encontrado.')
  const { data: ext } = auth.extensionId ? await auth.ctx.db.from('extensions').select('slug').eq('id', auth.extensionId).maybeSingle() : { data: null }
  const slug = isExtensionSlug(ext?.slug) ? ext.slug : null
  // extension/platform: a extensão confere que a chave é DELA (ex.: Cardápio Web não usar chave do iFood)
  return ok(req, { workspace: ws, scopes: auth.scopes, extension_id: auth.extensionId, extension: slug, platform: slug ? PLATFORM_OF[slug] : null })
}
