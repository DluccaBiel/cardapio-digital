/**
 * Modelo de cardápio compartilhado entre painel (/a/[ws]/cardapio) e API (/api/v1/menu).
 * Valores monetários sempre em reais com 2 casas.
 */

export type MenuStatus = 'active' | 'inactive' | 'out_of_stock'
export type ItemKind = 'item' | 'combo'

export const STATUS_LABEL: Record<MenuStatus, string> = {
  active: 'Ativo',
  inactive: 'Pausado',
  out_of_stock: 'Em falta',
}

export type MenuClient = {
  id: string
  name: string
  ifood_merchant_id: string | null
}

export type MenuCategory = {
  id: string
  name: string
  description: string | null
  sort_order: number
  status: MenuStatus
  ifood_id: string | null
  updated_at: string
}

export type ComboComponent = { component_id: string; quantity: number; sort_order: number }

export type MenuItem = {
  id: string
  category_id: string
  kind: ItemKind
  sku: string | null
  name: string
  description: string | null
  price: number
  status: MenuStatus
  sort_order: number
  ifood_id: string | null
  ifood_synced_at: string | null
  updated_at: string
  /** Grupos de complementos vinculados (ordem). */
  group_ids: string[]
  /** Somente combos. */
  components: ComboComponent[]
  /** Calculado: alterado no Undercut e ainda não refletido no iFood. */
  pending: boolean
}

export type MenuSubitem = {
  id: string
  group_id: string
  name: string
  price_delta: number
  sort_order: number
  status: MenuStatus
  ifood_id: string | null
  updated_at: string
}

export type MenuAddonGroup = {
  id: string
  name: string
  min_qty: number
  max_qty: number
  sort_order: number
  status: MenuStatus
  ifood_id: string | null
  updated_at: string
  subitems: MenuSubitem[]
}

export type MenuCatalog = {
  client: MenuClient
  categories: MenuCategory[]
  items: MenuItem[]
  groups: MenuAddonGroup[]
  /** ETag do catálogo inteiro (usado no If-Match da importação). */
  etag: string
}

export function isPending(row: { updated_at: string; ifood_synced_at: string | null }): boolean {
  if (!row.ifood_synced_at) return true
  return new Date(row.updated_at).getTime() > new Date(row.ifood_synced_at).getTime()
}

export function money(value: number): number {
  return Math.round(value * 100) / 100
}

/** Aceita "32,90", "32.90", "R$ 1.032,90". Retorna null se inválido. */
export function parseMoney(input: string | number): number | null {
  if (typeof input === 'number') return Number.isFinite(input) ? money(input) : null
  let text = input.replace(/[R$\s]/g, '')
  if (!text) return null
  if (text.includes(',')) text = text.replace(/\./g, '').replace(',', '.')
  const value = Number(text)
  if (!Number.isFinite(value) || value < 0) return null
  return money(value)
}

/** Soma dos componentes (preço cheio) e economia do combo. */
export function comboTotals(combo: Pick<MenuItem, 'price' | 'components'>, itemsById: Map<string, Pick<MenuItem, 'price'>>) {
  const full = money(
    combo.components.reduce((sum, c) => sum + (itemsById.get(c.component_id)?.price ?? 0) * c.quantity, 0),
  )
  const savings = money(full - combo.price)
  const discountPercent = full > 0 ? Math.round((savings / full) * 1000) / 10 : 0
  return { full, savings, discountPercent }
}

/** Preço sugerido a partir de um desconto percentual, arredondado para terminar em ,90. */
export function suggestComboPrice(full: number, discountPercent: number): number {
  const raw = full * (1 - Math.min(90, Math.max(0, discountPercent)) / 100)
  if (raw < 1) return money(raw)
  const ninety = Math.floor(raw) + 0.9
  return money(ninety > raw ? ninety - 1 : ninety)
}

/** ETag do catálogo: maior updated_at + quantidade de linhas (muda em qualquer insert/update/delete). */
export function catalogEtag(rows: { updated_at: string }[]): string {
  let max = 0
  for (const row of rows) max = Math.max(max, new Date(row.updated_at).getTime())
  return `"${new Date(max || 0).toISOString()}:${rows.length}"`
}

/** ETag de uma linha = updated_at bruto do Postgres (microssegundos preservados). */
export function rowEtag(updatedAt: string): string {
  return `"${updatedAt}"`
}

/** Extrai o valor de um If-Match (`"..."`, `W/"..."`). `*` = qualquer versão. */
export function parseIfMatch(header: string | null | undefined): string | null {
  if (!header) return null
  const value = header.trim().replace(/^W\//, '')
  if (value === '*') return '*'
  return value.replace(/^"|"$/g, '') || null
}
