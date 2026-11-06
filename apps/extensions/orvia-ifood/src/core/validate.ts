import {
  PLAN_SCHEMA_VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  type ActionPlan,
  type ActionType,
  type ComboSpec,
  type MenuSnapshot,
  type PlanAction,
  type RiskLevel,
} from './schema'

export interface ValidationIssue {
  path: string
  message: string
}

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; issues: ValidationIssue[] }

const ACTIONS: ActionType[] = [
  'update_name',
  'update_description',
  'update_price',
  'set_status',
  'reorder_category',
  'create_combo',
  'update_image',
  'note',
]
const RISKS: RiskLevel[] = ['baixo', 'medio', 'alto']
const ORIGINS = ['passive', 'active', 'dom']
const STATUSES = ['active', 'paused', 'unknown']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isDate(value: unknown): boolean {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}

class Issues {
  readonly list: ValidationIssue[] = []
  add(path: string, message: string): void {
    this.list.push({ path, message })
  }
}

function validateCombo(value: unknown, path: string, issues: Issues, snapshot?: MenuSnapshot): void {
  if (!isRecord(value)) {
    issues.add(path, 'objeto do combo ausente ou inválido')
    return
  }
  if (typeof value.name !== 'string' || value.name.trim() === '') {
    issues.add(`${path}.name`, 'nome do combo é obrigatório')
  }
  if (!isFiniteNumber(value.price) || value.price <= 0) {
    issues.add(`${path}.price`, 'preço do combo deve ser um número maior que zero')
  }
  if (value.paused !== true) {
    issues.add(`${path}.paused`, 'combos devem nascer pausados (paused: true)')
  }
  if (!isFiniteNumber(value.discountPercent) || value.discountPercent < 0 || value.discountPercent > 90) {
    issues.add(`${path}.discountPercent`, 'desconto do combo deve estar entre 0 e 90')
  }
  if (!Array.isArray(value.components) || value.components.length < 2) {
    issues.add(`${path}.components`, 'combo precisa de pelo menos 2 itens')
    return
  }
  value.components.forEach((component, index) => {
    const p = `${path}.components[${index}]`
    if (!isRecord(component)) {
      issues.add(p, 'componente inválido')
      return
    }
    if (typeof component.itemId !== 'string' || component.itemId.trim() === '') {
      issues.add(`${p}.itemId`, 'itemId do componente é obrigatório')
    } else if (snapshot && !snapshot.items.some((item) => item.id === component.itemId)) {
      issues.add(`${p}.itemId`, `item "${component.itemId}" não existe no snapshot`)
    }
    if (!isFiniteNumber(component.quantity) || !Number.isInteger(component.quantity) || component.quantity < 1) {
      issues.add(`${p}.quantity`, 'quantidade deve ser inteira e >= 1')
    }
  })
  if (typeof value.description !== 'string') {
    issues.add(`${path}.description`, 'descrição do combo deve ser texto')
  }
}

function validateAction(
  value: unknown,
  index: number,
  issues: Issues,
  snapshot?: MenuSnapshot,
): void {
  const path = `actions[${index}]`
  if (!isRecord(value)) {
    issues.add(path, 'ação deve ser um objeto')
    return
  }

  if (typeof value.id !== 'string' || value.id.trim() === '') issues.add(`${path}.id`, 'id é obrigatório')
  if (!ACTIONS.includes(value.tipo as ActionType)) issues.add(`${path}.tipo`, `tipo inválido (use: ${ACTIONS.join(', ')})`)
  if (!RISKS.includes(value.risco as RiskLevel)) issues.add(`${path}.risco`, 'risco deve ser baixo, medio ou alto')
  if (typeof value.justificativa !== 'string' || value.justificativa.trim() === '') {
    issues.add(`${path}.justificativa`, 'justificativa é obrigatória')
  }
  if (!isFiniteNumber(value.prioridade) || !Number.isInteger(value.prioridade) || value.prioridade < 1 || value.prioridade > 5) {
    issues.add(`${path}.prioridade`, 'prioridade deve ser inteiro de 1 a 5')
  }
  if (!isRecord(value.alvo)) {
    issues.add(`${path}.alvo`, 'alvo é obrigatório')
    return
  }

  const alvo = value.alvo
  const tipo = value.tipo as ActionType
  const itemId = typeof alvo.itemId === 'string' ? alvo.itemId : ''
  const categoryId = typeof alvo.categoryId === 'string' ? alvo.categoryId : ''

  if (['update_name', 'update_description', 'update_price', 'update_image', 'set_status'].includes(tipo)) {
    if (!itemId) issues.add(`${path}.alvo.itemId`, `itemId é obrigatório para ${tipo}`)
    else if (snapshot && !snapshot.items.some((item) => item.id === itemId)) {
      issues.add(`${path}.alvo.itemId`, `item "${itemId}" não existe no snapshot`)
    }
  }

  switch (tipo) {
    case 'update_name':
      if (typeof value.depois !== 'string' || value.depois.trim() === '') issues.add(`${path}.depois`, 'novo nome é obrigatório')
      else if (value.depois.length > 120) issues.add(`${path}.depois`, 'nome deve ter no máximo 120 caracteres')
      break
    case 'update_description':
      if (typeof value.depois !== 'string') issues.add(`${path}.depois`, 'nova descrição deve ser texto')
      else if (value.depois.length > 600) issues.add(`${path}.depois`, 'descrição deve ter no máximo 600 caracteres')
      break
    case 'update_price':
      if (!isFiniteNumber(value.depois) || value.depois < 0) issues.add(`${path}.depois`, 'novo preço deve ser número >= 0')
      if (value.antes !== null && !isFiniteNumber(value.antes)) issues.add(`${path}.antes`, 'preço anterior deve ser número ou null')
      break
    case 'set_status':
      if (value.depois !== 'active' && value.depois !== 'paused') issues.add(`${path}.depois`, 'status deve ser active ou paused')
      break
    case 'reorder_category':
      if (!categoryId) issues.add(`${path}.alvo.categoryId`, 'categoryId é obrigatório para reorder_category')
      else if (snapshot && !snapshot.categories.some((category) => category.id === categoryId)) {
        issues.add(`${path}.alvo.categoryId`, `categoria "${categoryId}" não existe no snapshot`)
      }
      if (!isFiniteNumber(value.depois) || !Number.isInteger(value.depois) || value.depois < 0) {
        issues.add(`${path}.depois`, 'nova posição deve ser inteiro >= 0')
      }
      break
    case 'create_combo':
      validateCombo(value.depois, `${path}.depois`, issues, snapshot)
      break
    case 'update_image':
      if (typeof value.depois !== 'string' || !/^https?:\/\//i.test(value.depois)) {
        issues.add(`${path}.depois`, 'nova imagem deve ser uma URL http(s)')
      }
      break
    case 'note':
      break
    default:
      break
  }
}

export function validateActionPlan(value: unknown, snapshot?: MenuSnapshot): ValidationResult<ActionPlan> {
  const issues = new Issues()
  if (!isRecord(value)) {
    return { ok: false, issues: [{ path: '$', message: 'plano deve ser um objeto JSON' }] }
  }
  if (value.schemaVersion !== PLAN_SCHEMA_VERSION) {
    issues.add('schemaVersion', `versão esperada: ${PLAN_SCHEMA_VERSION}`)
  }
  if (!isDate(value.createdAt)) issues.add('createdAt', 'data ISO inválida')
  if (typeof value.summary !== 'string') issues.add('summary', 'summary deve ser texto')
  if (value.merchant !== null && value.merchant !== undefined) {
    if (!isRecord(value.merchant)) issues.add('merchant', 'merchant deve ser objeto ou null')
    else if (value.merchant.name !== null && typeof value.merchant.name !== 'string') {
      issues.add('merchant.name', 'merchant.name deve ser texto ou null')
    }
  }
  if (!Array.isArray(value.actions)) {
    issues.add('actions', 'actions deve ser uma lista')
    return { ok: false, issues: issues.list }
  }
  if (value.actions.length === 0) issues.add('actions', 'o plano precisa de pelo menos uma ação')

  const seen = new Set<string>()
  value.actions.forEach((action, index) => {
    validateAction(action, index, issues, snapshot)
    if (isRecord(action) && typeof action.id === 'string') {
      if (seen.has(action.id)) issues.add(`actions[${index}].id`, 'id duplicado no plano')
      seen.add(action.id)
    }
  })

  if (issues.list.length > 0) return { ok: false, issues: issues.list }

  const plan = value as unknown as ActionPlan
  // Justificativa/risco garantidos acima; normaliza o alvo para não carregar campos extras.
  plan.actions = plan.actions.map((action) => ({
    ...action,
    alvo: {
      ...(action.alvo.itemId ? { itemId: action.alvo.itemId } : {}),
      ...(action.alvo.categoryId ? { categoryId: action.alvo.categoryId } : {}),
      ...(action.alvo.itemName ? { itemName: action.alvo.itemName } : {}),
    },
  }))
  return { ok: true, value: plan }
}

export function validateMenuSnapshot(value: unknown): ValidationResult<MenuSnapshot> {
  const issues = new Issues()
  if (!isRecord(value)) {
    return { ok: false, issues: [{ path: '$', message: 'snapshot deve ser um objeto' }] }
  }
  if (value.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) issues.add('schemaVersion', `versão esperada: ${SNAPSHOT_SCHEMA_VERSION}`)
  if (typeof value.id !== 'string' || value.id === '') issues.add('id', 'id é obrigatório')
  if (!isDate(value.capturedAt)) issues.add('capturedAt', 'data ISO inválida')
  if (!ORIGINS.includes(value.origin as string)) issues.add('origin', 'origem inválida')
  if (typeof value.storeKey !== 'string' || value.storeKey === '') issues.add('storeKey', 'storeKey é obrigatório')

  if (!isRecord(value.merchant)) issues.add('merchant', 'merchant é obrigatório')
  else {
    if (value.merchant.id !== null && typeof value.merchant.id !== 'string') issues.add('merchant.id', 'id deve ser texto ou null')
    if (value.merchant.name !== null && typeof value.merchant.name !== 'string') issues.add('merchant.name', 'name deve ser texto ou null')
  }

  if (!isRecord(value.source) || typeof value.source.domUrl !== 'string') issues.add('source', 'source.domUrl é obrigatório')

  if (!Array.isArray(value.catalogs)) issues.add('catalogs', 'catalogs deve ser lista')
  if (!Array.isArray(value.categories)) issues.add('categories', 'categories deve ser lista')
  if (!Array.isArray(value.items)) issues.add('items', 'items deve ser lista')
  if (!Array.isArray(value.categories) || !Array.isArray(value.items)) return { ok: false, issues: issues.list }

  const categoryIds = new Set<string>()
  value.categories.forEach((category, index) => {
    const p = `categories[${index}]`
    if (!isRecord(category)) {
      issues.add(p, 'categoria inválida')
      return
    }
    if (typeof category.id !== 'string' || category.id === '') issues.add(`${p}.id`, 'id é obrigatório')
    else if (categoryIds.has(category.id)) issues.add(`${p}.id`, 'id de categoria duplicado')
    else categoryIds.add(category.id)
    if (typeof category.name !== 'string' || category.name === '') issues.add(`${p}.name`, 'nome é obrigatório')
    if (!isFiniteNumber(category.position) || !Number.isInteger(category.position) || category.position < 0) {
      issues.add(`${p}.position`, 'posição deve ser inteiro >= 0')
    }
    if (!Array.isArray(category.itemIds)) issues.add(`${p}.itemIds`, 'itemIds deve ser lista')
  })

  const itemIds = new Set<string>()
  value.items.forEach((item, index) => {
    const p = `items[${index}]`
    if (!isRecord(item)) {
      issues.add(p, 'item inválido')
      return
    }
    if (typeof item.id !== 'string' || item.id === '') issues.add(`${p}.id`, 'id é obrigatório')
    else if (itemIds.has(item.id)) issues.add(`${p}.id`, 'id de item duplicado')
    else itemIds.add(item.id)
    if (typeof item.name !== 'string' || item.name.trim() === '') issues.add(`${p}.name`, 'nome é obrigatório')
    if (typeof item.description !== 'string') issues.add(`${p}.description`, 'descrição deve ser texto')
    if (item.price !== null && (!isFiniteNumber(item.price) || item.price < 0)) issues.add(`${p}.price`, 'preço inválido')
    if (item.originalPrice !== null && (!isFiniteNumber(item.originalPrice) || item.originalPrice < 0)) {
      issues.add(`${p}.originalPrice`, 'preço original inválido')
    }
    if (!STATUSES.includes(item.status as string)) issues.add(`${p}.status`, 'status inválido')
    if (typeof item.hasImage !== 'boolean') issues.add(`${p}.hasImage`, 'hasImage deve ser booleano')
    if (item.imageUrl !== null && typeof item.imageUrl !== 'string') issues.add(`${p}.imageUrl`, 'imageUrl deve ser texto ou null')
    if (item.categoryId !== null) {
      if (typeof item.categoryId !== 'string') issues.add(`${p}.categoryId`, 'categoryId deve ser texto ou null')
      else if (categoryIds.size > 0 && !categoryIds.has(item.categoryId)) {
        issues.add(`${p}.categoryId`, `categoria "${item.categoryId}" não existe`)
      }
    }
    if (item.available !== null && typeof item.available !== 'boolean') issues.add(`${p}.available`, 'available deve ser booleano ou null')
    if (item.updatedAt !== undefined && item.updatedAt !== null && typeof item.updatedAt !== 'string') {
      issues.add(`${p}.updatedAt`, 'updatedAt deve ser texto ou null')
    }
    if (!Array.isArray(item.complements)) issues.add(`${p}.complements`, 'complements deve ser lista')
    else {
      item.complements.forEach((group, groupIndex) => {
        const gp = `${p}.complements[${groupIndex}]`
        if (!isRecord(group)) {
          issues.add(gp, 'grupo inválido')
          return
        }
        if (typeof group.name !== 'string' || group.name === '') issues.add(`${gp}.name`, 'nome do grupo é obrigatório')
        if (!Array.isArray(group.options)) issues.add(`${gp}.options`, 'options deve ser lista')
        else {
          group.options.forEach((option, optionIndex) => {
            const op = `${gp}.options[${optionIndex}]`
            if (!isRecord(option) || typeof option.name !== 'string') issues.add(op, 'opção inválida')
            else if (option.price !== null && !isFiniteNumber(option.price)) issues.add(`${op}.price`, 'preço inválido')
          })
        }
      })
    }
  })

  if (issues.list.length > 0) return { ok: false, issues: issues.list }
  return { ok: true, value: value as unknown as MenuSnapshot }
}

export function formatIssues(issues: ValidationIssue[], max = 12): string {
  const shown = issues.slice(0, max).map((issue) => `${issue.path}: ${issue.message}`)
  if (issues.length > max) shown.push(`… e mais ${issues.length - max} problema(s)`)
  return shown.join('\n')
}

export function isActionSupportedType(tipo: ActionType): boolean {
  return tipo !== 'note'
}
