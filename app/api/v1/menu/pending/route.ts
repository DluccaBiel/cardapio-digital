import { authenticate, isResponse } from '@/lib/api/auth'
import { err, ok, preflight } from '@/lib/api/http'
import { loadCatalog } from '@/lib/menu/load'
import { comboTotals, rowEtag } from '@/lib/menu/model'

export const dynamic = 'force-dynamic'
export const OPTIONS = preflight

/**
 * Fila "aplicar no iFood": produtos/combos alterados no Undercut e ainda não
 * refletidos no iFood. Cada item traz `etag` para o If-Match do ifood-sync.
 */
export async function GET(req: Request) {
  const auth = await authenticate(req, 'catalogo:ler')
  if (isResponse(auth)) return auth
  const clientId = new URL(req.url).searchParams.get('client_id')
  if (!clientId || !/^[0-9a-f-]{36}$/i.test(clientId)) return err(req, 'invalid_input', 'Informe client_id (uuid).')

  const catalog = await loadCatalog(auth.ctx.db, auth.workspaceId, clientId)
  if (!catalog) return err(req, 'not_found', 'Cliente não encontrado.')

  const byId = new Map(catalog.items.map((i) => [i.id, i]))
  const cat = new Map(catalog.categories.map((c) => [c.id, c.name]))
  const grp = new Map(catalog.groups.map((g) => [g.id, g.name]))

  const pending = catalog.items
    .filter((i) => i.pending)
    .map((i) => ({
      id: i.id,
      etag: rowEtag(i.updated_at),
      kind: i.kind,
      action: i.ifood_id ? 'update' : 'create',
      ifood_id: i.ifood_id,
      name: i.name,
      description: i.description,
      price: i.price,
      status: i.status,
      category: cat.get(i.category_id) ?? null,
      addon_groups: i.group_ids.map((g) => grp.get(g)).filter(Boolean),
      components:
        i.kind === 'combo'
          ? i.components.map((c) => {
              const p = byId.get(c.component_id)
              return { id: c.component_id, ifood_id: p?.ifood_id ?? null, name: p?.name ?? '?', price: p?.price ?? null, quantity: c.quantity }
            })
          : [],
      combo_full_price: i.kind === 'combo' ? comboTotals(i, byId).full : null,
      updated_at: i.updated_at,
    }))

  return ok(req, { client: catalog.client, pending })
}
