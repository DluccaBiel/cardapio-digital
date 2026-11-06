/**
 * Schemas versionados da extensão.
 *
 * IMPORTANTE: nada aqui representa endpoints ou campos oficiais do iFood.
 * O `MenuSnapshot` é o formato interno da Orvia, preenchido pelo normalizador
 * tolerante a partir do que o portal expõe (ou do DOM, no fallback).
 */

export const SNAPSHOT_SCHEMA_VERSION = 1 as const
export const PLAN_SCHEMA_VERSION = 1 as const

export type CaptureOrigin = 'passive' | 'active' | 'dom'
export type ItemStatus = 'active' | 'paused' | 'unknown'

export interface ComplementOption {
  id: string | null
  name: string
  price: number | null
}

export interface ComplementGroup {
  id: string | null
  name: string
  min: number | null
  max: number | null
  required: boolean | null
  options: ComplementOption[]
}

export interface MenuItem {
  id: string
  name: string
  description: string
  price: number | null
  originalPrice: number | null
  status: ItemStatus
  hasImage: boolean
  imageUrl: string | null
  categoryId: string | null
  categoryName: string | null
  complements: ComplementGroup[]
  available: boolean | null
  /** Quando o portal informar; usado apenas para sinalizar itens pausados antigos. */
  updatedAt?: string | null
}

export interface MenuCategory {
  id: string
  name: string
  position: number
  itemIds: string[]
}

export interface MenuSnapshot {
  schemaVersion: typeof SNAPSHOT_SCHEMA_VERSION
  id: string
  capturedAt: string
  origin: CaptureOrigin
  merchant: { id: string | null; name: string | null }
  /** Chave usada para conferir se a loja ativa é a mesma do snapshot. */
  storeKey: string
  catalogs: { id: string | null; name: string | null }[]
  categories: MenuCategory[]
  items: MenuItem[]
  source: { requestPath: string | null; domUrl: string }
}

export type RiskLevel = 'baixo' | 'medio' | 'alto'

export type ActionType =
  | 'update_name'
  | 'update_description'
  | 'update_price'
  | 'set_status'
  | 'reorder_category'
  | 'create_combo'
  | 'update_image'
  | 'note'

export interface ComboSpec {
  name: string
  description: string
  /** Itens que compõem o combo, com quantidade. */
  components: { itemId: string; quantity: number }[]
  /** Preço final sugerido (soma dos itens com desconto aplicado pelo usuário). */
  price: number
  /** Percentual de desconto usado no cálculo (informativo). */
  discountPercent: number
  /** Combos SEMPRE nascem pausados. */
  paused: true
}

export interface PlanTarget {
  itemId?: string
  categoryId?: string
  itemName?: string
}

export interface PlanAction {
  id: string
  tipo: ActionType
  alvo: PlanTarget
  antes: unknown
  depois: unknown
  justificativa: string
  risco: RiskLevel
  prioridade: number
}

export interface ActionPlan {
  schemaVersion: typeof PLAN_SCHEMA_VERSION
  merchant: { id: string | null; name: string | null } | null
  createdAt: string
  summary: string
  actions: PlanAction[]
}

export interface DiscoveryEntry {
  id: string
  ts: string
  method: string
  path: string
  status: number
  req: StructureNode | null
  res: StructureNode | null
  menuLike: boolean
}

export type StructureNode =
  | { type: 'object'; keys: Record<string, StructureNode> }
  | { type: 'array'; items: StructureNode | null }
  | { type: 'string'; redacted?: boolean; sample?: string }
  | { type: 'number'; sample?: number }
  | { type: 'boolean'; sample?: boolean }
  | { type: 'null' }
  | { type: 'unknown' }

export interface Finding {
  id: string
  tipo: string
  severidade: RiskLevel
  titulo: string
  evidencia: string
  sugestao: string
  itemIds: string[]
  categoryIds: string[]
}

export interface ComboSuggestion {
  id: string
  name: string
  componentIds: string[]
  componentNames: string[]
  componentQuantities: number[]
  componentsTotal: number
  discountPercent: number
  price: number
  explanation: string
}

export interface AnalysisContext {
  niche: string
  nicheOther: string
  goal: 'ticket' | 'conversao' | 'margem' | 'volume'
  targetMarginPercent: number | null
  declaredCosts: string
  minPrice: number | null
  maxPrice: number | null
  comboDiscountPercent: number
  doNotTouchPrices: boolean
  doNotTouchItemIds: string[]
}
