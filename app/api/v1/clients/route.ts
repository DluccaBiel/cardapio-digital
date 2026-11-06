import { authenticate, isResponse } from '@/lib/api/auth'
import { err, ok, preflight } from '@/lib/api/http'
import { listMenuClients } from '@/lib/menu/load'

export const dynamic = 'force-dynamic'
export const OPTIONS = preflight

/** Lista enxuta de clientes (sem PII) — a extensão usa para escolher o destino da importação. */
export async function GET(req: Request) {
  const auth = await authenticate(req, 'clientes:ler')
  if (isResponse(auth)) return auth
  try {
    const clients = await listMenuClients(auth.ctx.db, auth.workspaceId)
    return ok(req, clients)
  } catch {
    return err(req, 'internal', 'Falha ao listar clientes.')
  }
}
