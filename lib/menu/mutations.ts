/**
 * Mutações do cardápio — implementação ÚNICA usada pelo painel (server actions,
 * cliente Supabase com RLS da sessão) e pela API /api/v1 (service role +
 * workspace_id da chave). Toda query filtra workspace_id explicitamente.
 *
 * Concorrência: toda edição recebe `expected` (= updated_at lido pelo cliente,
 * o If-Match). Divergiu → { ok:false, code:'conflict', current }.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { audit } from '../audit'
import { money } from './model'

export type Actor = { type: 'user' | 'api_key'; id: string | null }
export type Ctx = { db: SupabaseClient; workspaceId: string; actor: Actor }

export type Fail = {
  ok: false
  code: 'invalid' | 'not_found' | 'conflict' | 'has_items' | 'forbidden' | 'db' | 'merchant_mismatch'
  message: string
  current?: Record<string, unknown> | null
}
export type Result<T = { id: string; updated_at: string }> = { ok: true; data: T } | Fail

const fail = (code: Fail['code'], message: string, current?: Fail['current']): Fail => ({ ok: false, code, message, current })

function dbFail(error: { code?: string; message: string }): Fail {
  if (error.code === '42501' || /row-level security/i.test(error.message)) {
    return fail('forbidden', 'Seu papel neste workspace não permite esta alteração.')
  }
  if (error.code === '23505') return fail('invalid', 'Já existe um registro com esse nome/código neste cliente.')
  if (error.code === '23514') return fail('invalid', error.message.replace(/^.*?: /, ''))
  if (error.code === '23503') return fail('invalid', 'Referência inválida (registro de outro cliente ou removido).')
  return fail('db', 'Não foi possível salvar. Tente novamente.')
}

function zodFail(error: z.ZodError): Fail {
  const first = error.issues[0]
  return fail('invalid', first ? `${first.path.join('.') || 'campo'}: ${first.message}` : 'Dados inválidos')
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------
const uuid = z.string().uuid()
const status = z.enum(['active', 'inactive', 'out_of_stock'])
const price = z.number().finite().min(0).max(99999).transform(money)
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null))

export const clientInput = z.object({
  name: z.string().trim().min(1).max(160),
  ifood_merchant_id: optText(120),
})

export const categoryInput = z.object({
  id: uuid.optional(),
  expected: z.string().optional(),
  client_id: uuid,
  name: z.string().trim().min(1).max(120),
  description: optText(500),
  status: status.default('active'),
})

export const itemPatchInput = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  description: optText(1000).optional(),
  price: price.optional(),
  status: status.optional(),
  sku: optText(60).optional(),
  category_id: uuid.optional(),
  sort_order: z.number().int().min(0).max(1_000_000).optional(),
})

export const itemInput = z.object({
  id: uuid.optional(),
  expected: z.string().optional(),
  client_id: uuid,
  category_id: uuid,
  name: z.string().trim().min(1).max(160),
  description: optText(1000),
  price,
  status: status.default('active'),
  sku: optText(60),
  group_ids: z.array(uuid).max(30).default([]),
})

export const comboInput = z.object({
  id: uuid.optional(),
  expected: z.string().optional(),
  client_id: uuid,
  category_id: uuid.nullish(),
  name: z.string().trim().min(1).max(160),
  description: optText(1000),
  price,
  status: status.default('inactive'),
  sku: optText(60),
  components: z
    .array(z.object({ component_id: uuid, quantity: z.number().int().min(1).max(20) }))
    .min(2, 'um combo precisa de pelo menos 2 produtos')
    .max(12),
})

export const groupInput = z
  .object({
    id: uuid.optional(),
    expected: z.string().optional(),
    client_id: uuid,
    name: z.string().trim().min(1).max(120),
    min_qty: z.number().int().min(0).max(50),
    max_qty: z.number().int().min(1).max(50),
    status: status.default('active'),
  })
  .refine((g) => g.min_qty <= g.max_qty, { message: 'mínimo não pode ser maior que o máximo', path: ['min_qty'] })

export const subitemInput = z.object({
  id: uuid.optional(),
  expected: z.string().optional(),
  group_id: uuid,
  name: z.string().trim().min(1).max(160),
  price_delta: z.number().finite().min(-9999).max(9999).transform(money),
  status: status.default('active'),
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function nextSort(ctx: Ctx, table: string, column: string, value: string): Promise<number> {
  const { data } = await ctx.db
    .from(table)
    .select('sort_order')
    .eq('workspace_id', ctx.workspaceId)
    .eq(column, value)
    .order('sort_order', { ascending: false })
    .limit(1)
  return ((data?.[0] as any)?.sort_order ?? 0) + 10
}

/** UPDATE condicionado ao If-Match. Distingue conflito de inexistente. */
async function guardedUpdate(
  ctx: Ctx,
  table: string,
  id: string,
  expected: string | undefined,
  patch: Record<string, unknown>,
  currentCols: string,
): Promise<Result> {
  if (!expected) return fail('invalid', 'If-Match ausente: recarregue o registro antes de editar.')
  const { data, error } = await ctx.db
    .from(table)
    .update(patch)
    .eq('workspace_id', ctx.workspaceId)
    .eq('id', id)
    .eq('updated_at', expected)
    .select('id, updated_at')
  if (error) return dbFail(error)
  if (data && data.length === 1) return { ok: true, data: data[0] as { id: string; updated_at: string } }
  const { data: current } = await ctx.db
    .from(table)
    .select(currentCols)
    .eq('workspace_id', ctx.workspaceId)
    .eq('id', id)
    .maybeSingle()
  if (!current) return fail('not_found', 'Registro não encontrado (pode ter sido removido).')
  return fail('conflict', 'Este registro foi alterado por outra pessoa ou pela extensão. Recarregue e tente de novo.', current as any)
}

async function guardedDelete(ctx: Ctx, table: string, id: string, expected?: string): Promise<Result<{ id: string }>> {
  let q = ctx.db.from(table).delete().eq('workspace_id', ctx.workspaceId).eq('id', id)
  if (expected) q = q.eq('updated_at', expected)
  const { data, error } = await q.select('id')
  if (error) return dbFail(error)
  if (data && data.length === 1) return { ok: true, data: { id } }
  const { data: exists } = await ctx.db.from(table).select('id').eq('workspace_id', ctx.workspaceId).eq('id', id).maybeSingle()
  if (!exists) return fail('not_found', 'Registro não encontrado.')
  return fail('conflict', 'Registro alterado desde a última leitura. Recarregue antes de remover.')
}

async function ensureClient(ctx: Ctx, clientId: string): Promise<boolean> {
  const { data } = await ctx.db.from('clients').select('id').eq('workspace_id', ctx.workspaceId).eq('id', clientId).maybeSingle()
  return Boolean(data)
}

function log(ctx: Ctx, action: string, entityType: string, entityId: string | null, metadata?: Record<string, unknown>) {
  return audit({ workspaceId: ctx.workspaceId, actorType: ctx.actor.type, actorId: ctx.actor.id, action, entityType, entityId, metadata })
}

// ---------------------------------------------------------------------------
// Clientes (mínimo necessário para o cardápio)
// ---------------------------------------------------------------------------
export async function createMenuClient(ctx: Ctx, raw: unknown): Promise<Result> {
  const parsed = clientInput.safeParse(raw)
  if (!parsed.success) return zodFail(parsed.error)
  const { data, error } = await ctx.db
    .from('clients')
    .insert({ workspace_id: ctx.workspaceId, ...parsed.data })
    .select('id, updated_at')
    .single()
  if (error) return dbFail(error)
  await log(ctx, 'client.create', 'client', data.id, { source: 'cardapio' })
  return { ok: true, data }
}

// ---------------------------------------------------------------------------
// Categorias
// ---------------------------------------------------------------------------
export async function saveCategory(ctx: Ctx, raw: unknown): Promise<Result> {
  const parsed = categoryInput.safeParse(raw)
  if (!parsed.success) return zodFail(parsed.error)
  const { id, expected, client_id, ...fields } = parsed.data
  if (id) {
    const res = await guardedUpdate(ctx, 'menu_categories', id, expected, fields, 'id, name, updated_at')
    if (res.ok) await log(ctx, 'menu.category.update', 'menu_category', id)
    return res
  }
  if (!(await ensureClient(ctx, client_id))) return fail('not_found', 'Cliente não encontrado.')
  const sort_order = await nextSort(ctx, 'menu_categories', 'client_id', client_id)
  const { data, error } = await ctx.db
    .from('menu_categories')
    .insert({ workspace_id: ctx.workspaceId, client_id, sort_order, ...fields })
    .select('id, updated_at')
    .single()
  if (error) return dbFail(error)
  await log(ctx, 'menu.category.create', 'menu_category', data.id)
  return { ok: true, data }
}

export async function deleteCategory(ctx: Ctx, id: string, expected?: string): Promise<Result<{ id: string }>> {
  if (!uuid.safeParse(id).success) return fail('invalid', 'id inválido')
  const { count } = await ctx.db
    .from('menu_items')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', ctx.workspaceId)
    .eq('category_id', id)
  if ((count ?? 0) > 0) return fail('has_items', 'A categoria tem produtos. Mova ou remova os produtos antes.')
  const res = await guardedDelete(ctx, 'menu_categories', id, expected)
  if (res.ok) await log(ctx, 'menu.category.delete', 'menu_category', id)
  return res
}

export async function moveCategory(ctx: Ctx, clientId: string, id: string, direction: 'up' | 'down'): Promise<Result<{ id: string }>> {
  const { data, error } = await ctx.db
    .from('menu_categories')
    .select('id, sort_order, name')
    .eq('workspace_id', ctx.workspaceId)
    .eq('client_id', clientId)
    .order('sort_order')
    .order('name')
  if (error) return dbFail(error)
  const list = data ?? []
  const index = list.findIndex((c) => c.id === id)
  const target = direction === 'up' ? index - 1 : index + 1
  if (index < 0) return fail('not_found', 'Categoria não encontrada.')
  if (target < 0 || target >= list.length) return { ok: true, data: { id } }
  const reordered = [...list]
  ;[reordered[index], reordered[target]] = [reordered[target]!, reordered[index]!]
  for (let i = 0; i < reordered.length; i++) {
    const row = reordered[i]!
    const sort = (i + 1) * 10
    if (row.sort_order === sort) continue
    const { error: upErr } = await ctx.db
      .from('menu_categories')
      .update({ sort_order: sort })
      .eq('workspace_id', ctx.workspaceId)
      .eq('id', row.id)
    if (upErr) return dbFail(upErr)
  }
  await log(ctx, 'menu.category.reorder', 'menu_category', id, { direction })
  return { ok: true, data: { id } }
}

// ---------------------------------------------------------------------------
// Produtos
// ---------------------------------------------------------------------------
async function replaceItemGroups(ctx: Ctx, itemId: string, groupIds: string[]): Promise<Fail | null> {
  const { error: delErr } = await ctx.db
    .from('menu_item_addon_groups')
    .delete()
    .eq('workspace_id', ctx.workspaceId)
    .eq('item_id', itemId)
  if (delErr) return dbFail(delErr)
  if (groupIds.length === 0) return null
  const rows = Array.from(new Set(groupIds)).map((group_id, i) => ({
    workspace_id: ctx.workspaceId,
    item_id: itemId,
    group_id,
    sort_order: (i + 1) * 10,
  }))
  const { error } = await ctx.db.from('menu_item_addon_groups').insert(rows)
  return error ? dbFail(error) : null
}

async function categoryBelongs(ctx: Ctx, categoryId: string, clientId: string): Promise<boolean> {
  const { data } = await ctx.db
    .from('menu_categories')
    .select('id')
    .eq('workspace_id', ctx.workspaceId)
    .eq('client_id', clientId)
    .eq('id', categoryId)
    .maybeSingle()
  return Boolean(data)
}

export async function saveItem(ctx: Ctx, raw: unknown): Promise<Result> {
  const parsed = itemInput.safeParse(raw)
  if (!parsed.success) return zodFail(parsed.error)
  const { id, expected, client_id, group_ids, ...fields } = parsed.data
  if (!(await categoryBelongs(ctx, fields.category_id, client_id))) return fail('invalid', 'Categoria não pertence a este cliente.')

  let result: Result
  if (id) {
    result = await guardedUpdate(ctx, 'menu_items', id, expected, fields, 'id, name, price, status, updated_at')
  } else {
    const sort_order = await nextSort(ctx, 'menu_items', 'category_id', fields.category_id)
    const { data, error } = await ctx.db
      .from('menu_items')
      .insert({ workspace_id: ctx.workspaceId, client_id, kind: 'item', sort_order, ...fields })
      .select('id, updated_at')
      .single()
    result = error ? dbFail(error) : { ok: true, data }
  }
  if (!result.ok) return result
  const groupsFail = await replaceItemGroups(ctx, result.data.id, group_ids)
  if (groupsFail) return groupsFail
  await log(ctx, id ? 'menu.item.update' : 'menu.item.create', 'menu_item', result.data.id, { fields: Object.keys(fields) })
  return result
}

export async function patchItem(ctx: Ctx, id: string, expected: string | undefined, raw: unknown): Promise<Result> {
  if (!uuid.safeParse(id).success) return fail('invalid', 'id inválido')
  const parsed = itemPatchInput.safeParse(raw)
  if (!parsed.success) return zodFail(parsed.error)
  const patch = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined))
  if (Object.keys(patch).length === 0) return fail('invalid', 'Nada para alterar.')
  if (patch.category_id) {
    const { data: item } = await ctx.db.from('menu_items').select('client_id').eq('workspace_id', ctx.workspaceId).eq('id', id).maybeSingle()
    if (!item) return fail('not_found', 'Produto não encontrado.')
    if (!(await categoryBelongs(ctx, patch.category_id as string, item.client_id))) return fail('invalid', 'Categoria não pertence a este cliente.')
  }
  const res = await guardedUpdate(ctx, 'menu_items', id, expected, patch, 'id, name, description, price, status, updated_at')
  if (res.ok) await log(ctx, 'menu.item.update', 'menu_item', id, { fields: Object.keys(patch) })
  return res
}

export async function deleteItem(ctx: Ctx, id: string, expected?: string): Promise<Result<{ id: string }>> {
  if (!uuid.safeParse(id).success) return fail('invalid', 'id inválido')
  const { count } = await ctx.db
    .from('menu_combo_components')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', ctx.workspaceId)
    .eq('component_id', id)
  if ((count ?? 0) > 0) return fail('has_items', 'Este produto faz parte de combo(s). Remova-o dos combos antes.')
  const res = await guardedDelete(ctx, 'menu_items', id, expected)
  if (res.ok) await log(ctx, 'menu.item.delete', 'menu_item', id)
  return res
}

// ---------------------------------------------------------------------------
// Combos
// ---------------------------------------------------------------------------
async function ensureComboCategory(ctx: Ctx, clientId: string): Promise<string | Fail> {
  const { data } = await ctx.db
    .from('menu_categories')
    .select('id')
    .eq('workspace_id', ctx.workspaceId)
    .eq('client_id', clientId)
    .ilike('name', 'combos')
    .maybeSingle()
  if (data) return data.id
  const { data: created, error } = await ctx.db
    .from('menu_categories')
    .insert({ workspace_id: ctx.workspaceId, client_id: clientId, name: 'Combos', sort_order: 5 })
    .select('id')
    .single()
  if (error) return dbFail(error)
  await log(ctx, 'menu.category.create', 'menu_category', created.id, { auto: 'combos' })
  return created.id
}

export async function saveCombo(ctx: Ctx, raw: unknown): Promise<Result> {
  const parsed = comboInput.safeParse(raw)
  if (!parsed.success) return zodFail(parsed.error)
  const { id, expected, client_id, components, category_id: rawCategory, ...fields } = parsed.data
  if (!(await ensureClient(ctx, client_id))) return fail('not_found', 'Cliente não encontrado.')

  // Componentes: mesmo cliente, produtos simples, sem duplicata
  const ids = Array.from(new Set(components.map((c) => c.component_id)))
  if (ids.length !== components.length) return fail('invalid', 'O mesmo produto aparece duas vezes — ajuste a quantidade.')
  const { data: compRows, error: compErr } = await ctx.db
    .from('menu_items')
    .select('id, kind')
    .eq('workspace_id', ctx.workspaceId)
    .eq('client_id', client_id)
    .in('id', ids)
  if (compErr) return dbFail(compErr)
  if ((compRows ?? []).length !== ids.length || compRows!.some((r) => r.kind !== 'item')) {
    return fail('invalid', 'Todos os componentes precisam ser produtos simples deste cliente.')
  }

  let category_id = rawCategory ?? null
  if (category_id) {
    if (!(await categoryBelongs(ctx, category_id, client_id))) return fail('invalid', 'Categoria não pertence a este cliente.')
  } else {
    const ensured = await ensureComboCategory(ctx, client_id)
    if (typeof ensured !== 'string') return ensured
    category_id = ensured
  }

  let comboId: string
  if (id) {
    const res = await guardedUpdate(ctx, 'menu_items', id, expected, { ...fields, category_id }, 'id, name, price, status, updated_at')
    if (!res.ok) return res
    comboId = id
    const { error } = await ctx.db.from('menu_combo_components').delete().eq('workspace_id', ctx.workspaceId).eq('combo_id', id)
    if (error) return dbFail(error)
  } else {
    const sort_order = await nextSort(ctx, 'menu_items', 'category_id', category_id)
    const { data, error } = await ctx.db
      .from('menu_items')
      .insert({ workspace_id: ctx.workspaceId, client_id, kind: 'combo', category_id, sort_order, ...fields })
      .select('id')
      .single()
    if (error) return dbFail(error)
    comboId = data.id
  }

  const { error: insErr } = await ctx.db.from('menu_combo_components').insert(
    components.map((c, i) => ({
      workspace_id: ctx.workspaceId,
      combo_id: comboId,
      component_id: c.component_id,
      quantity: c.quantity,
      sort_order: (i + 1) * 10,
    })),
  )
  if (insErr) return dbFail(insErr)

  const { data: fresh } = await ctx.db.from('menu_items').select('id, updated_at').eq('workspace_id', ctx.workspaceId).eq('id', comboId).single()
  await log(ctx, id ? 'menu.combo.update' : 'menu.combo.create', 'menu_item', comboId, { components: components.length })
  return { ok: true, data: fresh as { id: string; updated_at: string } }
}

// ---------------------------------------------------------------------------
// Complementos
// ---------------------------------------------------------------------------
export async function saveGroup(ctx: Ctx, raw: unknown): Promise<Result> {
  const parsed = groupInput.safeParse(raw)
  if (!parsed.success) return zodFail(parsed.error)
  const { id, expected, client_id, ...fields } = parsed.data
  if (id) {
    const res = await guardedUpdate(ctx, 'menu_addon_groups', id, expected, fields, 'id, name, min_qty, max_qty, updated_at')
    if (res.ok) await log(ctx, 'menu.addon_group.update', 'menu_addon_group', id)
    return res
  }
  if (!(await ensureClient(ctx, client_id))) return fail('not_found', 'Cliente não encontrado.')
  const sort_order = await nextSort(ctx, 'menu_addon_groups', 'client_id', client_id)
  const { data, error } = await ctx.db
    .from('menu_addon_groups')
    .insert({ workspace_id: ctx.workspaceId, client_id, sort_order, ...fields })
    .select('id, updated_at')
    .single()
  if (error) return dbFail(error)
  await log(ctx, 'menu.addon_group.create', 'menu_addon_group', data.id)
  return { ok: true, data }
}

export async function deleteGroup(ctx: Ctx, id: string, expected?: string): Promise<Result<{ id: string }>> {
  if (!uuid.safeParse(id).success) return fail('invalid', 'id inválido')
  const res = await guardedDelete(ctx, 'menu_addon_groups', id, expected)
  if (res.ok) await log(ctx, 'menu.addon_group.delete', 'menu_addon_group', id)
  return res
}

export async function saveSubitem(ctx: Ctx, raw: unknown): Promise<Result> {
  const parsed = subitemInput.safeParse(raw)
  if (!parsed.success) return zodFail(parsed.error)
  const { id, expected, group_id, ...fields } = parsed.data
  if (id) {
    const res = await guardedUpdate(ctx, 'menu_subitems', id, expected, fields, 'id, name, price_delta, updated_at')
    if (res.ok) await log(ctx, 'menu.subitem.update', 'menu_subitem', id)
    return res
  }
  const { data: group } = await ctx.db.from('menu_addon_groups').select('id').eq('workspace_id', ctx.workspaceId).eq('id', group_id).maybeSingle()
  if (!group) return fail('not_found', 'Grupo não encontrado.')
  const sort_order = await nextSort(ctx, 'menu_subitems', 'group_id', group_id)
  const { data, error } = await ctx.db
    .from('menu_subitems')
    .insert({ workspace_id: ctx.workspaceId, group_id, sort_order, ...fields })
    .select('id, updated_at')
    .single()
  if (error) return dbFail(error)
  await log(ctx, 'menu.subitem.create', 'menu_subitem', data.id)
  return { ok: true, data }
}

export async function deleteSubitem(ctx: Ctx, id: string, expected?: string): Promise<Result<{ id: string }>> {
  if (!uuid.safeParse(id).success) return fail('invalid', 'id inválido')
  const res = await guardedDelete(ctx, 'menu_subitems', id, expected)
  if (res.ok) await log(ctx, 'menu.subitem.delete', 'menu_subitem', id)
  return res
}

// ---------------------------------------------------------------------------
// Sincronização iFood
// ---------------------------------------------------------------------------
export async function markSynced(
  ctx: Ctx,
  id: string,
  expected: string | null,
  ifoodId?: string | null,
): Promise<Result<{ id: string; updated_at: string; ifood_synced_at: string; ifood_id: string | null }>> {
  if (!uuid.safeParse(id).success) return fail('invalid', 'id inválido')
  const ifood = ifoodId?.trim() ? ifoodId.trim().slice(0, 120) : null
  const { data, error } = await ctx.db.rpc('mark_menu_items_ifood_synced', {
    p_workspace: ctx.workspaceId,
    p_items: [id],
    p_expected: expected,
    p_ifood_id: ifood,
  })
  if (error) return dbFail(error)
  const row = (data as any[] | null)?.[0]
  if (row) {
    await log(ctx, 'menu.item.ifood_synced', 'menu_item', id, { with_ifood_id: Boolean(ifood) })
    return { ok: true, data: row }
  }
  const { data: current } = await ctx.db
    .from('menu_items')
    .select('id, name, price, status, updated_at')
    .eq('workspace_id', ctx.workspaceId)
    .eq('id', id)
    .maybeSingle()
  if (!current) return fail('not_found', 'Produto não encontrado.')
  return fail('conflict', 'O produto mudou no Orvia depois que a extensão leu. Confira de novo antes de marcar.', current as any)
}
