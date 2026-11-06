import type { SupabaseClient } from '@supabase/supabase-js'
import {
  catalogEtag,
  isPending,
  type MenuAddonGroup,
  type MenuCatalog,
  type MenuCategory,
  type MenuClient,
  type MenuItem,
  type MenuSubitem,
} from './model'

/**
 * Carrega o catálogo completo de um cliente.
 * Usado pelo painel (cliente com RLS da sessão) e pela API (service role) —
 * em AMBOS os casos filtramos explicitamente por workspace_id + client_id.
 */
export async function loadCatalog(
  db: SupabaseClient,
  workspaceId: string,
  clientId: string,
): Promise<MenuCatalog | null> {
  const { data: client } = await db
    .from('clients')
    .select('id, name, ifood_merchant_id')
    .eq('workspace_id', workspaceId)
    .eq('id', clientId)
    .is('archived_at', null)
    .maybeSingle()
  if (!client) return null

  const [cats, items, groups, links, comps] = await Promise.all([
    db
      .from('menu_categories')
      .select('id, name, description, sort_order, status, ifood_id, updated_at')
      .eq('workspace_id', workspaceId)
      .eq('client_id', clientId)
      .order('sort_order')
      .order('name'),
    db
      .from('menu_items')
      .select('id, category_id, kind, sku, name, description, price, status, sort_order, ifood_id, ifood_synced_at, updated_at')
      .eq('workspace_id', workspaceId)
      .eq('client_id', clientId)
      .order('sort_order')
      .order('name'),
    db
      .from('menu_addon_groups')
      .select('id, name, min_qty, max_qty, sort_order, status, ifood_id, updated_at, menu_subitems ( id, group_id, name, price_delta, sort_order, status, ifood_id, updated_at )')
      .eq('workspace_id', workspaceId)
      .eq('client_id', clientId)
      .order('sort_order')
      .order('name'),
    db.from('menu_item_addon_groups').select('item_id, group_id, sort_order').eq('workspace_id', workspaceId),
    db.from('menu_combo_components').select('combo_id, component_id, quantity, sort_order').eq('workspace_id', workspaceId),
  ])

  for (const res of [cats, items, groups, links, comps]) {
    if (res.error) throw new Error(`Falha ao carregar cardápio: ${res.error.message}`)
  }

  const itemIds = new Set((items.data ?? []).map((i: any) => i.id as string))
  const groupIdsByItem = new Map<string, { id: string; o: number }[]>()
  for (const l of links.data ?? []) {
    if (!itemIds.has(l.item_id)) continue
    const list = groupIdsByItem.get(l.item_id) ?? []
    list.push({ id: l.group_id, o: l.sort_order })
    groupIdsByItem.set(l.item_id, list)
  }
  const compsByCombo = new Map<string, MenuItem['components']>()
  for (const c of comps.data ?? []) {
    if (!itemIds.has(c.combo_id)) continue
    const list = compsByCombo.get(c.combo_id) ?? []
    list.push({ component_id: c.component_id, quantity: c.quantity, sort_order: c.sort_order })
    compsByCombo.set(c.combo_id, list)
  }

  const categories: MenuCategory[] = (cats.data ?? []) as MenuCategory[]
  const menuItems: MenuItem[] = (items.data ?? []).map((i: any) => ({
    ...i,
    price: Number(i.price),
    group_ids: (groupIdsByItem.get(i.id) ?? []).sort((a, b) => a.o - b.o).map((g) => g.id),
    components: (compsByCombo.get(i.id) ?? []).sort((a, b) => a.sort_order - b.sort_order),
    pending: isPending(i),
  }))
  const addonGroups: MenuAddonGroup[] = (groups.data ?? []).map((g: any) => ({
    id: g.id,
    name: g.name,
    min_qty: g.min_qty,
    max_qty: g.max_qty,
    sort_order: g.sort_order,
    status: g.status,
    ifood_id: g.ifood_id,
    updated_at: g.updated_at,
    subitems: ((g.menu_subitems ?? []) as any[])
      .map((s) => ({ ...s, price_delta: Number(s.price_delta) }) as MenuSubitem)
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)),
  }))

  const etag = catalogEtag([
    ...categories,
    ...menuItems,
    ...addonGroups,
    ...addonGroups.flatMap((g) => g.subitems),
  ])

  return { client: client as MenuClient, categories, items: menuItems, groups: addonGroups, etag }
}

export async function listMenuClients(db: SupabaseClient, workspaceId: string): Promise<MenuClient[]> {
  const { data, error } = await db
    .from('clients')
    .select('id, name, ifood_merchant_id')
    .eq('workspace_id', workspaceId)
    .is('archived_at', null)
    .order('name')
  if (error) throw new Error(`Falha ao listar clientes: ${error.message}`)
  return (data ?? []) as MenuClient[]
}
