import { authenticate, isResponse } from '@/lib/api/auth'
import { err, ok, preflight } from '@/lib/api/http'
import { platformOfExtensionId } from '@/lib/api/extensions'
import { listMenuClients } from '@/lib/menu/load'

export const dynamic = 'force-dynamic'
export const OPTIONS = preflight

/**
 * Lista enxuta de clientes (sem PII) — a extensão usa para escolher o destino da importação.
 * Para a extensão Cardápio Web, `ifood_merchant_id` traz o id da loja NO Cardápio Web
 * (clients.cardapioweb_store_id): é o campo que ela compara com a loja aberta.
 */
export async function GET(req: Request) {
  const auth = await authenticate(req, 'clientes:ler')
  if (isResponse(auth)) return auth
  try {
    const clients = await listMenuClients(auth.ctx.db, auth.workspaceId)
    if ((await platformOfExtensionId(auth.ctx.db, auth.extensionId)) !== 'cardapioweb') return ok(req, clients)
    const { data: stores, error } = await auth.ctx.db
      .from('clients')
      .select('id, cardapioweb_store_id')
      .eq('workspace_id', auth.workspaceId)
      .is('archived_at', null)
    if (error) throw error
    const byId = new Map((stores ?? []).map((s: { id: string; cardapioweb_store_id: string | null }) => [s.id, s.cardapioweb_store_id]))
    return ok(req, clients.map((c) => ({ ...c, ifood_merchant_id: byId.get(c.id) ?? null })))
  } catch {
    return err(req, 'internal', 'Falha ao listar clientes.')
  }
}
