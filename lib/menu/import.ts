/**
 * Importação iFood → Orvia (chamada pela extensão via POST /api/v1/menu/import).
 *
 * Regras de segurança/consistência:
 *  - Trava de loja: se o cliente já tem loja vinculada NO CANAL (ifood_merchant_id ou,
 *    para a extensão Cardápio Web, cardapioweb_store_id) e o snapshot é de outra
 *    loja → merchant_mismatch (nada é gravado).
 *  - Nunca apaga nada: itens do Orvia que não vieram no snapshot só são contados.
 *  - Nunca sobrescreve edição local pendente: item com ifood_id e alterado no
 *    Orvia depois da última sincronização fica como está ("kept_local") — a
 *    extensão o mostra em Pendências para aplicar no iFood.
 *  - IDs sintéticos do normalizador (cat_N, synth_, dom_) não viram ifood_id.
 */
import { z } from 'zod'
import { audit } from '../audit'
import { PLATFORM_LABEL, STORE_COLUMN, type Platform } from '../api/extensions'
import type { Ctx, Fail } from './mutations'
import { isPending, money } from './model'

const SYNTHETIC = /^(cat_\d+|synth_|dom_)/

const optionSchema = z.object({ id: z.string().nullish(), name: z.string().trim().min(1).max(160), price: z.number().nullish() })
const groupSchema = z.object({
  id: z.string().nullish(),
  name: z.string().trim().min(1).max(120),
  min: z.number().int().nullish(),
  max: z.number().int().nullish(),
  options: z.array(optionSchema).max(200).default([]),
})
export const importSchema = z.object({
  client_id: z.string().uuid(),
  merchant: z.object({ id: z.string().max(120).nullish(), name: z.string().max(200).nullish() }),
  categories: z.array(z.object({ id: z.string().max(120), name: z.string().trim().min(1).max(120), position: z.number().int().min(0).max(10_000) })).max(200),
  items: z
    .array(
      z.object({
        id: z.string().max(120),
        name: z.string().trim().min(1).max(160),
        description: z.string().max(2000).nullish(),
        price: z.number().nullish(),
        status: z.enum(['active', 'paused', 'unknown']),
        categoryId: z.string().nullish(),
        complements: z.array(groupSchema).max(40).default([]),
      }),
    )
    .max(2000),
})
export type ImportInput = z.infer<typeof importSchema>

export type ImportSummary = {
  categories: { created: number; updated: number }
  items: { created: number; updated: number; unchanged: number; linked_by_name: number }
  groups: { created: number; options_created: number }
  kept_local: { id: string; name: string }[]
  skipped: { name: string; reason: string }[]
  missing_in_ifood: number
}

const realId = (id: string | null | undefined) => (id && !SYNTHETIC.test(id) ? id.slice(0, 120) : null)
const norm = (s: string) => s.trim().toLowerCase()

export async function importIfoodSnapshot(ctx: Ctx, input: ImportInput, platform: Platform = 'ifood'): Promise<{ ok: true; data: ImportSummary } | Fail> {
  const { db, workspaceId } = ctx
  const clientId = input.client_id
  const summary: ImportSummary = {
    categories: { created: 0, updated: 0 },
    items: { created: 0, updated: 0, unchanged: 0, linked_by_name: 0 },
    groups: { created: 0, options_created: 0 },
    kept_local: [],
    skipped: [],
    missing_in_ifood: 0,
  }

  // ---- 1) Cliente + trava de loja (coluna do canal: iFood ou Cardápio Web — 0006)
  const col = STORE_COLUMN[platform]
  const label = PLATFORM_LABEL[platform]
  const { data: client } = await db
    .from('clients')
    .select(`id, ${col}`)
    .eq('workspace_id', workspaceId)
    .eq('id', clientId)
    .is('archived_at', null)
    .maybeSingle()
  if (!client) return { ok: false, code: 'not_found', message: 'Cliente não encontrado.' }
  const linked = ((client as Record<string, unknown>)[col] as string | null) ?? null
  const merchantId = input.merchant.id?.trim() || null
  if (linked && merchantId && linked !== merchantId) {
    return {
      ok: false,
      code: 'merchant_mismatch',
      message: `Esta loja do ${label} é diferente da vinculada a este cliente. Confira a loja aberta no portal.`,
      current: { [col]: linked },
    }
  }
  if (!linked && merchantId) {
    const { error } = await db.from('clients').update({ [col]: merchantId }).eq('workspace_id', workspaceId).eq('id', clientId)
    if (error?.code === '23505') {
      return { ok: false, code: 'merchant_mismatch', message: `Esta loja do ${label} já está vinculada a outro cliente do workspace.` }
    }
  }

  // ---- 2) Estado atual
  const [catsRes, itemsRes, groupsRes] = await Promise.all([
    db.from('menu_categories').select('id, name, sort_order, ifood_id').eq('workspace_id', workspaceId).eq('client_id', clientId),
    db
      .from('menu_items')
      .select('id, name, description, price, status, category_id, kind, ifood_id, ifood_synced_at, updated_at')
      .eq('workspace_id', workspaceId)
      .eq('client_id', clientId),
    db
      .from('menu_addon_groups')
      .select('id, name, ifood_id, menu_subitems ( id, name, ifood_id )')
      .eq('workspace_id', workspaceId)
      .eq('client_id', clientId),
  ])
  if (catsRes.error || itemsRes.error || groupsRes.error) return { ok: false, code: 'db', message: 'Falha ao ler o cardápio atual.' }

  // ---- 3) Categorias
  const catByIfood = new Map<string, string>()
  const catByName = new Map<string, any>()
  for (const c of catsRes.data ?? []) {
    if (c.ifood_id) catByIfood.set(c.ifood_id, c.id)
    catByName.set(norm(c.name), c)
  }
  const snapCatToLocal = new Map<string, string>() // id do snapshot -> id local
  for (const sc of input.categories) {
    const ifoodId = realId(sc.id)
    const sort_order = (sc.position + 1) * 10
    let localId = ifoodId ? catByIfood.get(ifoodId) : undefined
    if (!localId) {
      const byName = catByName.get(norm(sc.name))
      if (byName && (!byName.ifood_id || byName.ifood_id === ifoodId)) localId = byName.id
    }
    if (localId) {
      const { error } = await db
        .from('menu_categories')
        .update({ name: sc.name, sort_order, ...(ifoodId ? { ifood_id: ifoodId } : {}) })
        .eq('workspace_id', workspaceId)
        .eq('id', localId)
      if (error) summary.skipped.push({ name: sc.name, reason: 'categoria: conflito de nome' })
      else summary.categories.updated += 1
    } else {
      const { data, error } = await db
        .from('menu_categories')
        .insert({ workspace_id: workspaceId, client_id: clientId, name: sc.name, sort_order, ifood_id: ifoodId })
        .select('id')
        .single()
      if (error || !data) {
        summary.skipped.push({ name: sc.name, reason: 'categoria não criada' })
        continue
      }
      localId = data.id
      summary.categories.created += 1
      catByName.set(norm(sc.name), { id: data.id, name: sc.name, ifood_id: ifoodId })
    }
    snapCatToLocal.set(sc.id, localId!)
  }

  // Categoria de fallback para itens sem categoria reconhecida
  const fallbackCategory = async (): Promise<string | null> => {
    const existing = catByName.get('sem categoria')
    if (existing) return existing.id
    const { data } = await db
      .from('menu_categories')
      .insert({ workspace_id: workspaceId, client_id: clientId, name: 'Sem categoria', sort_order: 9990 })
      .select('id')
      .single()
    if (data) catByName.set('sem categoria', { id: data.id, name: 'Sem categoria', ifood_id: null })
    return data?.id ?? null
  }

  // ---- 4) Complementos (grupos únicos por id do iFood ou nome)
  const groupByIfood = new Map<string, { id: string; subs: Map<string, string>; subsByName: Map<string, string> }>()
  const groupByName = new Map<string, { id: string; subs: Map<string, string>; subsByName: Map<string, string> }>()
  for (const g of (groupsRes.data ?? []) as any[]) {
    const entry = { id: g.id as string, subs: new Map<string, string>(), subsByName: new Map<string, string>() }
    for (const s of g.menu_subitems ?? []) {
      if (s.ifood_id) entry.subs.set(s.ifood_id, s.id)
      entry.subsByName.set(norm(s.name), s.id)
    }
    if (g.ifood_id) groupByIfood.set(g.ifood_id, entry)
    groupByName.set(norm(g.name), entry)
  }

  const resolveGroup = async (sg: z.infer<typeof groupSchema>): Promise<string | null> => {
    const ifoodId = realId(sg.id)
    let entry = (ifoodId && groupByIfood.get(ifoodId)) || (!ifoodId ? groupByName.get(norm(sg.name)) : undefined)
    if (!entry) {
      const min = Math.max(0, sg.min ?? 0)
      const max = Math.max(1, min, sg.max ?? Math.max(1, sg.options.length))
      const { data, error } = await db
        .from('menu_addon_groups')
        .insert({ workspace_id: workspaceId, client_id: clientId, name: sg.name, min_qty: min, max_qty: max, ifood_id: ifoodId })
        .select('id')
        .single()
      if (error || !data) return null
      entry = { id: data.id, subs: new Map(), subsByName: new Map() }
      if (ifoodId) groupByIfood.set(ifoodId, entry)
      groupByName.set(norm(sg.name), entry)
      summary.groups.created += 1
    }
    const newSubs = sg.options
      .filter((o) => {
        const oid = realId(o.id)
        return !(oid && entry!.subs.has(oid)) && !entry!.subsByName.has(norm(o.name))
      })
      .map((o, i) => ({
        workspace_id: workspaceId,
        group_id: entry!.id,
        name: o.name,
        price_delta: money(o.price ?? 0),
        sort_order: (entry!.subsByName.size + i + 1) * 10,
        ifood_id: realId(o.id),
      }))
    if (newSubs.length > 0) {
      const { data } = await db.from('menu_subitems').insert(newSubs).select('id, name, ifood_id')
      for (const s of data ?? []) {
        if (s.ifood_id) entry.subs.set(s.ifood_id, s.id)
        entry.subsByName.set(norm(s.name), s.id)
      }
      summary.groups.options_created += data?.length ?? 0
    }
    return entry.id
  }

  // ---- 5) Produtos
  const existing = (itemsRes.data ?? []).filter((i: any) => i.kind === 'item')
  const byIfood = new Map(existing.filter((i: any) => i.ifood_id).map((i: any) => [i.ifood_id as string, i]))
  const byName = new Map(existing.filter((i: any) => !i.ifood_id).map((i: any) => [norm(i.name), i]))
  const seenIfood = new Set<string>()
  const toSync: string[] = []
  const linksToAdd: { item_id: string; group_id: string; sort_order: number }[] = []

  for (const si of input.items) {
    const ifoodId = realId(si.id)
    if (ifoodId) seenIfood.add(ifoodId)
    if (si.price == null || !Number.isFinite(si.price) || si.price < 0) {
      summary.skipped.push({ name: si.name, reason: 'sem preço legível' })
      continue
    }
    const price = money(si.price)
    const status = si.status === 'paused' ? 'inactive' : 'active'
    const categoryId = (si.categoryId && snapCatToLocal.get(si.categoryId)) || (await fallbackCategory())
    if (!categoryId) {
      summary.skipped.push({ name: si.name, reason: 'sem categoria' })
      continue
    }
    const fields = { name: si.name, description: si.description?.trim() || null, price, status, category_id: categoryId }

    let local: any = ifoodId ? byIfood.get(ifoodId) : undefined
    let itemId: string | null = null
    if (local) {
      if (isPending(local)) {
        summary.kept_local.push({ id: local.id, name: local.name })
        continue
      }
      const same =
        local.name === fields.name &&
        (local.description ?? null) === fields.description &&
        Number(local.price) === price &&
        local.status === status &&
        local.category_id === categoryId
      if (same) summary.items.unchanged += 1
      else {
        const { error } = await db.from('menu_items').update(fields).eq('workspace_id', workspaceId).eq('id', local.id)
        if (error) {
          summary.skipped.push({ name: si.name, reason: 'falha ao atualizar' })
          continue
        }
        summary.items.updated += 1
      }
      itemId = local.id
      toSync.push(local.id)
    } else if ((local = byName.get(norm(si.name)))) {
      // Produto criado no Orvia com o mesmo nome: vincula, mantém os valores do Orvia.
      byName.delete(norm(si.name))
      const { error } = await db.from('menu_items').update({ ifood_id: ifoodId }).eq('workspace_id', workspaceId).eq('id', local.id)
      if (error) {
        summary.skipped.push({ name: si.name, reason: 'falha ao vincular' })
        continue
      }
      summary.items.linked_by_name += 1
      itemId = local.id
      const same = Number(local.price) === price && local.status === status && (local.description ?? null) === fields.description
      if (same && ifoodId) toSync.push(local.id)
      else summary.kept_local.push({ id: local.id, name: local.name })
    } else {
      const { data, error } = await db
        .from('menu_items')
        .insert({ workspace_id: workspaceId, client_id: clientId, kind: 'item', ifood_id: ifoodId, sort_order: (summary.items.created + 1) * 10, ...fields })
        .select('id')
        .single()
      if (error || !data) {
        summary.skipped.push({ name: si.name, reason: error?.code === '23505' ? 'duplicado' : 'falha ao criar' })
        continue
      }
      summary.items.created += 1
      itemId = data.id
      if (ifoodId) toSync.push(data.id)
    }

    if (itemId) {
      let order = 10
      for (const sg of si.complements) {
        const groupId = await resolveGroup(sg)
        if (groupId) linksToAdd.push({ item_id: itemId, group_id: groupId, sort_order: (order += 10) })
      }
    }
  }

  // Vínculos produto ↔ grupo (só adiciona; nunca remove)
  if (linksToAdd.length > 0) {
    const unique = new Map(linksToAdd.map((l) => [`${l.item_id}:${l.group_id}`, l]))
    await db
      .from('menu_item_addon_groups')
      .upsert(
        Array.from(unique.values()).map((l) => ({ workspace_id: workspaceId, ...l })),
        { onConflict: 'item_id,group_id', ignoreDuplicates: true },
      )
  }

  // ---- 6) Marca como sincronizado (relógio do banco) o que reflete o iFood
  for (let i = 0; i < toSync.length; i += 200) {
    await db.rpc('mark_menu_items_ifood_synced', { p_workspace: workspaceId, p_items: toSync.slice(i, i + 200) })
  }

  summary.missing_in_ifood = existing.filter((i: any) => i.ifood_id && !seenIfood.has(i.ifood_id)).length

  await audit({
    workspaceId,
    actorType: ctx.actor.type,
    actorId: ctx.actor.id,
    action: platform === 'cardapioweb' ? 'menu.import.cardapioweb' : 'menu.import.ifood',
    entityType: 'client',
    entityId: clientId,
    metadata: {
      categories: summary.categories,
      items: summary.items,
      groups: summary.groups,
      kept_local: summary.kept_local.length,
      skipped: summary.skipped.length,
      missing_in_ifood: summary.missing_in_ifood,
    },
  })

  return { ok: true, data: summary }
}
