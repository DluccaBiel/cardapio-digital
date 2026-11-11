import { authenticate, isResponse } from '@/lib/api/auth'
import { err, ok, preflight } from '@/lib/api/http'
import { platformOfExtensionId, STORE_COLUMN } from '@/lib/api/extensions'
import { listMenuClients } from '@/lib/menu/load'

export const dynamic = 'force-dynamic'
export const OPTIONS = preflight

/**
 * Lista enxuta de clientes (sem PII) — a extensão usa para escolher o destino da importação.
 * Para as extensões Cardápio Web / Anota AI, `ifood_merchant_id` traz o id da loja NO canal
 * (clients.cardapioweb_store_id / anotaai_store_id): é o campo que ela compara com a loja aberta.
 */
export async function GET(req: Request) {
  const auth = await authenticate(req, 'clientes:ler')
  if (isResponse(auth)) return auth
  try {
    const clients = await listMenuClients(auth.ctx.db, auth.workspaceId)
    const col = STORE_COLUMN[await platformOfExtensionId(auth.ctx.db, auth.extensionId)]
    if (col === 'ifood_merchant_id') return ok(req, clients)
    const { data: stores, error } = await auth.ctx.db
      .from('clients')
      .select(`id, ${col}`)
      .eq('workspace_id', auth.workspaceId)
      .is('archived_at', null)
    if (error) throw error
    const byId = new Map(((stores ?? []) as unknown as Record<string, string | null>[]).map((s) => [s.id, s[col] ?? null]))
    return ok(req, clients.map((c) => ({ ...c, ifood_merchant_id: byId.get(c.id) ?? null })))
  } catch {
    return err(req, 'internal', 'Falha ao listar clientes.')
  }
}
