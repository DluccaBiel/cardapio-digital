import {
  SNAPSHOT_SCHEMA_VERSION,
  type CaptureOrigin,
  type ComplementGroup,
  type ComplementOption,
  type ItemStatus,
  type MenuCategory,
  type MenuItem,
  type MenuSnapshot,
} from './schema'

type Rec = Record<string, unknown>

function isRec(value: unknown): value is Rec {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

function pickString(obj: Rec, keys: string[]): string | null {
  for (const key of keys) {
    const value = str(obj[key])
    if (value) return value
  }
  return null
}

function pickBool(obj: Rec, keys: string[]): boolean | null {
  for (const key of keys) {
    if (typeof obj[key] === 'boolean') return obj[key] as boolean
  }
  return null
}

/** Converte preços em número. Não assume centavos: usa o valor como veio. */
export function parsePrice(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value
  if (typeof value === 'string') {
    const cleaned = value.replace(/[^\d.,-]/g, '').trim()
    if (!cleaned) return null
    let normalized = cleaned
    const lastComma = cleaned.lastIndexOf(',')
    const lastDot = cleaned.lastIndexOf('.')
    if (lastComma > lastDot) {
      normalized = cleaned.replace(/\./g, '').replace(',', '.')
    } else if (lastDot > lastComma) {
      normalized = cleaned.replace(/,/g, '')
    } else {
      normalized = cleaned.replace(/,/g, '.')
    }
    const parsed = Number.parseFloat(normalized)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
  }
  if (isRec(value)) {
    for (const key of ['value', 'amount', 'price', 'sellingPrice']) {
      const parsed = parsePrice(value[key])
      if (parsed !== null) return parsed
    }
  }
  return null
}

function normalizeStatus(raw: unknown, flags: Rec): ItemStatus {
  if (typeof raw === 'string') {
    const value = raw.toLowerCase()
    if (['active', 'ativo', 'enabled', 'available', 'published', 'publicado'].includes(value)) return 'active'
    if (['paused', 'pausado', 'inactive', 'inativo', 'disabled', 'unavailable', 'deleted', 'arquivado'].includes(value)) return 'paused'
    if (value.includes('active') || value.includes('ativo')) return 'active'
    if (value.includes('paus') || value.includes('inativ') || value.includes('desativ')) return 'paused'
  }
  if (typeof raw === 'boolean') return raw ? 'active' : 'paused'
  const available = pickBool(flags, ['available', 'isAvailable', 'enabled', 'isEnabled', 'active', 'isActive'])
  if (available !== null) return available ? 'active' : 'paused'
  return 'unknown'
}

function imageUrlFrom(value: unknown): string | null {
  if (typeof value === 'string' && /^https?:\/\//i.test(value)) return value
  if (isRec(value)) {
    for (const key of ['url', 'src', 'href', 'imageUrl', 'photoUrl']) {
      const url = imageUrlFrom(value[key])
      if (url) return url
    }
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const url = imageUrlFrom(entry)
      if (url) return url
    }
  }
  return null
}

function pickImage(item: Rec): string | null {
  for (const key of ['imageUrl', 'image', 'photoUrl', 'photo', 'picture', 'pictureUrl', 'logo', 'images', 'media', 'files']) {
    const url = imageUrlFrom(item[key])
    if (url) return url
  }
  return null
}

function complementOptions(value: unknown): ComplementOption[] {
  if (!Array.isArray(value)) return []
  const options: ComplementOption[] = []
  for (const entry of value) {
    if (!isRec(entry)) continue
    const name = pickString(entry, ['name', 'title', 'label', 'description'])
    if (!name) continue
    const price =
      parsePrice(entry.price) ??
      parsePrice(entry.value) ??
      parsePrice(entry.additionalPrice) ??
      parsePrice(entry.amount) ??
      null
    options.push({
      id: pickString(entry, ['id', 'uuid', 'optionId', 'code']),
      name,
      price,
    })
  }
  return options
}

function normalizeComplements(item: Rec): ComplementGroup[] {
  const source =
    item.complements ?? item.complementGroups ?? item.optionGroups ?? item.addons ?? item.customizations ?? item.groups
  if (!Array.isArray(source)) return []
  const groups: ComplementGroup[] = []
  for (const entry of source) {
    if (!isRec(entry)) continue
    const name = pickString(entry, ['name', 'title', 'label'])
    if (!name) continue
    const optionsSource = entry.options ?? entry.items ?? entry.choices ?? entry.products
    groups.push({
      id: pickString(entry, ['id', 'uuid', 'groupId', 'code']),
      name,
      min: parsePrice(entry.min ?? entry.minOptions ?? entry.minimum),
      max: parsePrice(entry.max ?? entry.maxOptions ?? entry.maximum),
      required: pickBool(entry, ['required', 'mandatory', 'isRequired']),
      options: complementOptions(optionsSource),
    })
  }
  return groups
}

function toId(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

function normalizeItem(raw: unknown, index: number, categoryId: string | null, categoryName: string | null): MenuItem | null {
  if (!isRec(raw)) return null
  const name = pickString(raw, ['name', 'title', 'label', 'itemName', 'productName'])
  if (!name) return null

  const image = pickImage(raw)
  const statusRaw = raw.status ?? raw.state ?? raw.itemStatus ?? raw.situation
  const status = normalizeStatus(statusRaw, raw)
  const available = pickBool(raw, ['available', 'isAvailable', 'enabled', 'isEnabled'])
  const category = isRec(raw.category) ? raw.category : null

  return {
    id:
      pickString(raw, ['id', 'uuid', 'itemId', 'catalogItemId', 'productId', 'code']) ??
      `synth_${index}_${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24)}`,
    name,
    description: pickString(raw, ['description', 'details', 'subtitle', 'shortDescription', 'longDescription']) ?? '',
    price:
      parsePrice(raw.price) ??
      parsePrice(raw.sellingPrice) ??
      parsePrice(raw.value) ??
      parsePrice(raw.amount) ??
      parsePrice(raw.unitPrice) ??
      null,
    originalPrice:
      parsePrice(raw.originalPrice) ??
      parsePrice(raw.compareAtPrice) ??
      parsePrice(raw.oldPrice) ??
      parsePrice(raw.listPrice) ??
      null,
    status,
    hasImage: image !== null,
    imageUrl: image,
    categoryId: categoryId ?? pickString(raw, ['categoryId']) ?? (category ? pickString(category, ['id', 'uuid']) : null),
    categoryName: categoryName ?? pickString(raw, ['categoryName']) ?? (category ? pickString(category, ['name', 'title']) : null),
    complements: normalizeComplements(raw),
    available,
    updatedAt:
      pickString(raw, ['updatedAt', 'updated_at', 'lastModified', 'modifiedAt', 'changedAt']) ?? null,
  }
}

function looksLikeCategory(value: unknown): boolean {
  if (!isRec(value)) return false
  const hasItems = Array.isArray(value.items ?? value.products ?? value.menuItems ?? value.dishes ?? value.productsList)
  return hasItems && (str(value.name ?? value.title ?? value.label) !== null)
}

function looksLikeItem(value: unknown): boolean {
  if (!isRec(value)) return false
  const name = str(value.name ?? value.title ?? value.itemName ?? value.productName)
  if (!name) return false
  return (
    'price' in value ||
    'sellingPrice' in value ||
    'value' in value ||
    'description' in value ||
    'image' in value ||
    'imageUrl' in value
  )
}

const SKIP_ITEM_KEYS = new Set(['options', 'choices', 'addons', 'complements', 'complementGroups', 'optionGroups', 'groups', 'customizations'])

function collectCategories(payload: unknown): Rec[] {
  const found: Rec[] = []
  const seen = new Set<Rec>()
  const visit = (value: unknown, depth: number): void => {
    if (depth > 6 || found.length > 200) return
    if (Array.isArray(value)) {
      const categoryLike = value.filter(looksLikeCategory)
      if (categoryLike.length > 0) {
        categoryLike.forEach((entry) => {
          if (isRec(entry) && !seen.has(entry)) {
            seen.add(entry)
            found.push(entry)
          }
        })
        // Não interrompe: pode haver categorias aninhadas em submenus.
      }
      value.slice(0, 50).forEach((entry) => visit(entry, depth + 1))
      return
    }
    if (isRec(value)) {
      for (const [key, entry] of Object.entries(value)) {
        if (SKIP_ITEM_KEYS.has(key)) continue
        visit(entry, depth + 1)
      }
    }
  }
  visit(payload, 0)
  return found
}

function collectFlatItems(payload: unknown): Rec[] {
  const found: Rec[] = []
  const visit = (value: unknown, depth: number): void => {
    if (depth > 6) return
    if (Array.isArray(value)) {
      if (value.length >= 2 && value.filter(looksLikeItem).length >= Math.min(2, value.length)) {
        value.forEach((entry) => isRec(entry) && looksLikeItem(entry) && found.push(entry))
        return
      }
      value.slice(0, 50).forEach((entry) => visit(entry, depth + 1))
      return
    }
    if (isRec(value)) {
      for (const [key, entry] of Object.entries(value)) {
        if (SKIP_ITEM_KEYS.has(key)) continue
        visit(entry, depth + 1)
      }
    }
  }
  visit(payload, 0)
  return found
}

function findMerchant(payload: unknown): { id: string | null; name: string | null } {
  let best: { id: string | null; name: string | null } | null = null
  const visit = (value: unknown, depth: number, parentKey: string): void => {
    if (best || depth > 5) return
    if (isRec(value)) {
      if (['merchant', 'store', 'shop', 'restaurant', 'loja', 'establishment'].includes(parentKey.toLowerCase())) {
        const name = pickString(value, ['name', 'tradeName', 'fantasyName', 'title', 'storeName'])
        const id = pickString(value, ['id', 'uuid', 'merchantId', 'storeId'])
        if (name || id) best = { id, name }
      }
      for (const [key, entry] of Object.entries(value)) visit(entry, depth + 1, key)
    } else if (Array.isArray(value)) {
      value.slice(0, 10).forEach((entry) => visit(entry, depth + 1, parentKey))
    }
  }
  visit(payload, 0, '')
  return best ?? { id: null, name: null }
}

function findCatalogs(payload: unknown): { id: string | null; name: string | null }[] {
  if (!isRec(payload)) return []
  const source = payload.catalogs ?? payload.menus ?? payload.catalogsList
  if (!Array.isArray(source)) return []
  return source
    .filter(isRec)
    .slice(0, 20)
    .map((entry) => ({
      id: pickString(entry, ['id', 'uuid', 'catalogId']),
      name: pickString(entry, ['name', 'title', 'label']),
    }))
}

export interface NormalizeOptions {
  origin: CaptureOrigin
  capturedAt?: string
  requestPath?: string | null
  domUrl?: string
  merchantFallback?: { id: string | null; name: string | null }
}

/** Normaliza um payload de cardápio para o schema interno. Tolerante a formatos. */
export function normalizeMenuPayload(payload: unknown, options: NormalizeOptions): MenuSnapshot | null {
  const merchant = findMerchant(payload)
  const merchantInfo = { id: merchant.id ?? options.merchantFallback?.id ?? null, name: merchant.name ?? options.merchantFallback?.name ?? null }
  const categories: MenuCategory[] = []
  const items: MenuItem[] = []
  const seenItemIds = new Set<string>()

  const addItem = (item: MenuItem): void => {
    if (seenItemIds.has(item.id)) return
    seenItemIds.add(item.id)
    items.push(item)
  }

  const categorySources = collectCategories(payload)
  if (categorySources.length > 0) {
    const seenCategoryIds = new Set<string>()
    categorySources.slice(0, 60).forEach((category, index) => {
      const name = pickString(category, ['name', 'title', 'label']) ?? `Categoria ${index + 1}`
      const id = pickString(category, ['id', 'uuid', 'categoryId', 'code']) ?? `cat_${index}`
      if (seenCategoryIds.has(id)) return
      seenCategoryIds.add(id)
      const rawItems = (category.items ?? category.products ?? category.menuItems ?? category.dishes ?? category.productsList) as unknown
      const itemIds: string[] = []
      if (Array.isArray(rawItems)) {
        rawItems.forEach((raw, itemIndex) => {
          const item = normalizeItem(raw, items.length + itemIndex, id, name)
          if (item) {
            addItem(item)
            itemIds.push(item.id)
          }
        })
      }
      categories.push({ id, name, position: index, itemIds })
    })
  } else {
    const flat = collectFlatItems(payload)
    const groups = new Map<string, { id: string; name: string; itemIds: string[] }>()
    flat.forEach((raw, index) => {
      const categoryNameRaw = pickString(raw, ['categoryName', 'categoryTitle', 'category'])
      const categoryName = categoryNameRaw ?? 'Sem categoria'
      if (!groups.has(categoryName)) {
        const id = `cat_${groups.size}`
        groups.set(categoryName, { id, name: categoryName, itemIds: [] })
      }
      const group = groups.get(categoryName)!
      const item = normalizeItem(raw, index, group.id, group.name)
      if (item) {
        addItem(item)
        group.itemIds.push(item.id)
      }
    })
    ;[...groups.values()].forEach((group, index) => {
      categories.push({ id: group.id, name: group.name, position: index, itemIds: group.itemIds })
    })
  }

  if (items.length === 0) return null

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    id: '',
    capturedAt: options.capturedAt ?? new Date().toISOString(),
    origin: options.origin,
    merchant: merchantInfo,
    storeKey: merchantInfo.id ?? merchantInfo.name ?? 'unknown',
    catalogs: findCatalogs(payload),
    categories,
    items,
    source: { requestPath: options.requestPath ?? null, domUrl: options.domUrl ?? '' },
  }
}

/** Fallback somente-leitura por DOM. Limitado: pode não trazer categorias/complementos. */
export function normalizeFromDom(doc: Document, options: { domUrl: string; merchantName: string | null }): MenuSnapshot | null {
  const candidates = new Set<Element>()
  doc.querySelectorAll('[data-testid]').forEach((element) => {
    const testId = (element.getAttribute('data-testid') ?? '').toLowerCase()
    if (/product|item|dish|menu|cardapio/.test(testId)) candidates.add(element)
  })
  doc.querySelectorAll('li, article').forEach((element) => {
    const text = (element as HTMLElement).innerText ?? element.textContent ?? ''
    if (/R\$\s*\d/.test(text) && text.length < 1200) candidates.add(element)
  })

  const items: MenuItem[] = []
  const seen = new Set<string>()
  let index = 0
  for (const element of candidates) {
    if (items.length >= 400) break
    const text = ((element as HTMLElement).innerText ?? element.textContent ?? '').replace(/\u00a0/g, ' ').trim()
    if (!text) continue
    const priceMatch = text.match(/R\$\s*([\d.,]+)/)
    if (!priceMatch) continue
    const lines = text
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
    const priceLine = lines.find((line) => /R\$\s*[\d.,]+/.test(line)) ?? ''
    const name = lines.find((line) => !/R\$/.test(line) && line.length >= 2) ?? ''
    if (!name) continue
    const description = lines.filter((line) => line !== name && line !== priceLine && !/R\$/.test(line)).join(' ').slice(0, 400)
    const normalizedKey = `${name}|${priceMatch[1]}`
    if (seen.has(normalizedKey)) continue
    seen.add(normalizedKey)
    const image = element.querySelector('img')?.getAttribute('src') ?? null
    const paused = /pausado|inativo|indispon/i.test(text)
    items.push({
      id: `dom_${index}`,
      name,
      description,
      price: parsePrice(priceMatch[1] ?? ''),
      originalPrice: null,
      status: paused ? 'paused' : 'active',
      hasImage: Boolean(image),
      imageUrl: image && /^https?:\/\//i.test(image) ? image : null,
      categoryId: null,
      categoryName: null,
      complements: [],
      available: !paused,
    })
    index += 1
  }

  if (items.length === 0) return null
  const categoryId = 'cat_dom'
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    id: '',
    capturedAt: new Date().toISOString(),
    origin: 'dom',
    merchant: { id: null, name: options.merchantName },
    storeKey: options.merchantName ?? 'unknown',
    catalogs: [],
    categories: [{ id: categoryId, name: 'Sem categoria', position: 0, itemIds: items.map((item) => item.id) }],
    items: items.map((item) => ({ ...item, categoryId })),
    source: { requestPath: null, domUrl: options.domUrl },
  }
}

/** Hash FNV-1a curto para deduplicar capturas passivas. */
export function snapshotFingerprint(snapshot: MenuSnapshot): string {
  const payload = JSON.stringify({
    store: snapshot.storeKey,
    merchant: snapshot.merchant,
    catalogs: snapshot.catalogs,
    categories: snapshot.categories.map((category) => ({ id: category.id, name: category.name, position: category.position })),
    items: snapshot.items.map((item) => ({
      id: item.id,
      name: item.name,
      description: item.description,
      price: item.price,
      originalPrice: item.originalPrice,
      status: item.status,
      imageUrl: item.imageUrl,
      categoryId: item.categoryId,
      complements: item.complements.map((group) => ({ name: group.name, options: group.options })),
    })),
  })
  let hash = 0x811c9dc5
  for (let index = 0; index < payload.length; index += 1) {
    hash ^= payload.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** Finaliza um snapshot vindo do normalizador (id + fingerprint). */
export function finalizeSnapshot(snapshot: MenuSnapshot): MenuSnapshot {
  const fingerprint = snapshotFingerprint(snapshot)
  const captured = new Date(snapshot.capturedAt)
  const stamp = Number.isNaN(captured.getTime()) ? Date.now() : captured.getTime()
  return { ...snapshot, id: `snap_${stamp}_${fingerprint}` }
}
