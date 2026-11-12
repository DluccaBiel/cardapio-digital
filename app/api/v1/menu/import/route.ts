import { authenticate, isResponse } from '@/lib/api/auth'
import { platformOfExtensionId } from '@/lib/api/extensions'
import { err, fromFail, ok, preflight, readJson } from '@/lib/api/http'
import { importIfoodSnapshot, importSchema } from '@/lib/menu/import'
import { loadCatalog } from '@/lib/menu/load'
import { parseIfMatch } from '@/lib/menu/model'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
export const OPTIONS = preflight

/**
 * Importa o snapshot lido no Portal do Parceiro iFood para o cliente.
 * If-Match obrigatório = ETag de GET /menu?client_id= (garante que ninguém
 * mexeu no catálogo entre a leitura e a importação). Divergiu → 409.
 */
export async function POST(req: Request) {
  const auth = await authenticate(req, 'catalogo:escrever')
  if (isResponse(auth)) return auth

  const ifMatch = parseIfMatch(req.headers.get('if-match'))
  if (!ifMatch) return err(req, 'precondition_required', 'If-Match obrigatório: use o ETag de GET /api/v1/menu?client_id=.')

  const parsed = importSchema.safeParse(await readJson(req))
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return err(req, 'validation_failed', `Snapshot inválido: ${issue?.path.join('.')} ${issue?.message}`)
  }

  const current = await loadCatalog(auth.ctx.db, auth.workspaceId, parsed.data.client_id)
  if (!current) return err(req, 'not_found', 'Cliente não encontrado.')
  if (current.etag.replace(/"/g, '') !== ifMatch) {
    return err(req, 'conflict', 'O cardápio mudou no Undercut desde a última leitura. Recarregue e tente de novo.', {
      current: { etag: current.etag },
    })
  }

  const res = await importIfoodSnapshot(auth.ctx, parsed.data, await platformOfExtensionId(auth.ctx.db, auth.extensionId))
  if (!res.ok) return fromFail(req, res)
  const after = await loadCatalog(auth.ctx.db, auth.workspaceId, parsed.data.client_id)
  return ok(req, res.data, { headers: after ? { ETag: after.etag } : {} })
}
