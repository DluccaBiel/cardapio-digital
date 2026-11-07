/**
 * Aprendizado por exemplo: a extensão NÃO conhece (nem chuta) a API interna do
 * portal. Quando o usuário edita um produto no portal, observamos a requisição
 * de escrita que o PRÓPRIO portal fez e extraímos um "molde":
 *   - URL com o id do item no lugar de {id}
 *   - modo 'rmw' (lê o detalhe do item, altera só o campo, envia o objeto inteiro)
 *     quando o corpo enviado tem a mesma forma de uma leitura recente do item;
 *     ou 'patch' quando o corpo só contém o(s) campo(s) alterado(s)
 *   - caminho exato do campo (preço/status/nome/descrição) e unidade do preço
 * Puro: sem chrome.*, sem DOM.
 */

export type Field = 'price' | 'status' | 'name' | 'description'
export type Path = (string | number)[]

export interface Observed {
  method: string
  url: string
  body?: unknown
  json?: unknown
  status?: number
  at: number
}

export interface Template {
  field: Field
  mode: 'rmw' | 'patch'
  method: string
  urlTemplate: string
  /** rmw: GET do detalhe (mesma forma do corpo enviado) */
  detailUrlTemplate?: string
  /** rmw: caminho dentro da resposta do GET até o objeto que é enviado (ex.: ['data']) */
  unwrap?: Path
  path: Path
  unit?: 'reais' | 'centavos'
  statusValues?: { active?: unknown; paused?: unknown }
  /** patch: corpo modelo + caminhos onde vai o id */
  patchBody?: unknown
  idPaths?: Path[]
  learnedAt: string
}

export type LearnResult = { ok: true; templates: Template[]; itemId: string } | { ok: false; reason: string }

type Rec = Record<string, unknown>
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v)

export function leaves(value: unknown, path: Path = [], out: { path: Path; value: unknown }[] = []) {
  if (Array.isArray(value)) value.forEach((v, i) => leaves(v, [...path, i], out))
  else if (isRec(value)) for (const [k, v] of Object.entries(value)) leaves(v, [...path, k], out)
  else out.push({ path, value })
  return out
}

export function getPath(obj: unknown, path: Path): unknown {
  let cur: any = obj
  for (const key of path) {
    if (cur === null || cur === undefined) return undefined
    cur = cur[key as any]
  }
  return cur
}

export function setPath(obj: unknown, path: Path, value: unknown): void {
  let cur: any = obj
  for (let i = 0; i < path.length - 1; i += 1) cur = cur[path[i] as any]
  cur[path[path.length - 1] as any] = value
}

export const pathKey = (p: Path) => p.map(String).join('.')

/** Diferenças folha a folha entre dois objetos de mesma forma. */
export function diffLeaves(before: unknown, after: unknown): { path: Path; before: unknown; after: unknown }[] {
  const a = new Map(leaves(before).map((l) => [pathKey(l.path), l]))
  const out: { path: Path; before: unknown; after: unknown }[] = []
  const seen = new Set<string>()
  for (const l of leaves(after)) {
    const k = pathKey(l.path)
    seen.add(k)
    const prev = a.get(k)
    if (!prev || !Object.is(prev.value, l.value)) out.push({ path: l.path, before: prev?.value, after: l.value })
  }
  for (const [k, l] of a) if (!seen.has(k)) out.push({ path: l.path, before: l.value, after: undefined })
  return out
}

function keyOverlap(a: unknown, b: unknown): number {
  if (!isRec(a) || !isRec(b)) return 0
  const ka = Object.keys(a)
  const kb = new Set(Object.keys(b))
  if (ka.length === 0) return 0
  return ka.filter((k) => kb.has(k)).length / Math.max(ka.length, kb.size)
}

const UNWRAPS: Path[] = [[], ['data'], ['item'], ['data', 'item'], ['product'], ['data', 'product']]

function classify(path: Path, value: unknown): Field | null {
  const keys = path.filter((p) => typeof p === 'string').map((p) => (p as string).toLowerCase())
  const last = keys[keys.length - 1] ?? ''
  const all = keys.join('.')
  if (typeof value === 'number' && /(price|preco|valor|value|amount)/.test(all)) return 'price'
  if ((typeof value === 'boolean' || typeof value === 'string') && /(status|available|availability|paused|enabled|active|situa)/.test(last)) return 'status'
  if (typeof value === 'string' && /(description|descricao|details)/.test(last)) return 'description'
  if (typeof value === 'string' && /^(name|title|nome)$/.test(last)) return 'name'
  return null
}

function findItemId(write: Observed, ids: Set<string>): string | null {
  for (const seg of new URL(write.url, 'https://portal.ifood.com.br').pathname.split('/')) {
    if (seg && ids.has(decodeURIComponent(seg))) return decodeURIComponent(seg)
  }
  for (const l of leaves(write.body)) if (typeof l.value === 'string' && ids.has(l.value)) return l.value
  return null
}

/**
 * Aprende moldes a partir de uma escrita observada.
 * @param itemsById itens do snapshot (preço/status atuais em reais) — usados para unidade e status
 */
export function learnFromWrite(
  write: Observed,
  recentReads: Observed[],
  itemsById: Map<string, { price: number | null; status: string }>,
): LearnResult {
  const method = write.method.toUpperCase()
  if (!['PUT', 'PATCH', 'POST'].includes(method)) return { ok: false, reason: 'não é escrita' }
  if (!isRec(write.body)) return { ok: false, reason: 'corpo não é objeto JSON' }
  if (write.status !== undefined && (write.status < 200 || write.status >= 300)) return { ok: false, reason: 'o portal recusou a alteração' }
  const itemId = findItemId(write, new Set(itemsById.keys()))
  if (!itemId) return { ok: false, reason: 'não reconheci qual produto foi alterado (abra o cardápio antes para a extensão ler os produtos)' }
  const item = itemsById.get(itemId)!
  const urlTemplate = write.url.split(itemId).join('{id}')

  // Leitura do detalhe com a mesma forma do corpo enviado → modo rmw
  let rmw: { read: Observed; unwrap: Path; obj: unknown } | null = null
  for (const read of [...recentReads].sort((a, b) => b.at - a.at)) {
    if (!read.url.includes(itemId) || read.method.toUpperCase() !== 'GET') continue
    for (const unwrap of UNWRAPS) {
      const obj = unwrap.length ? getPath(read.json, unwrap) : read.json
      if (keyOverlap(obj, write.body) >= 0.6) {
        rmw = { read, unwrap, obj }
        break
      }
    }
    if (rmw) break
  }

  const diffs = rmw
    ? diffLeaves(rmw.obj, write.body).filter((d) => d.after !== undefined)
    : leaves(write.body)
        .filter((l) => l.value !== itemId)
        .map((l) => ({ path: l.path, before: undefined as unknown, after: l.value }))
  if (diffs.length === 0) return { ok: false, reason: 'nenhuma mudança detectada' }

  const templates: Template[] = []
  const unknownPaths: Path[] = []
  for (const d of diffs) {
    const field = classify(d.path, d.after)
    if (!field) {
      unknownPaths.push(d.path)
      continue
    }
    if (templates.some((t) => t.field === field)) continue
    const base: Template = {
      field,
      mode: rmw ? 'rmw' : 'patch',
      method,
      urlTemplate,
      path: d.path,
      learnedAt: new Date(write.at).toISOString(),
    }
    if (rmw) {
      base.detailUrlTemplate = rmw.read.url.split(itemId).join('{id}')
      base.unwrap = rmw.unwrap
    }
    if (field === 'price') {
      const ref = typeof d.before === 'number' ? d.before : (d.after as number)
      const p = item.price ?? 0
      base.unit = Number.isInteger(ref) && Math.abs(ref / 100 - p) < Math.abs(ref - p) ? 'centavos' : 'reais'
    }
    if (field === 'status') {
      const wasActive = item.status !== 'paused'
      base.statusValues = wasActive ? { paused: d.after, active: d.before } : { active: d.after, paused: d.before }
      if (base.statusValues.active === undefined && typeof d.after === 'boolean') base.statusValues = wasActive ? { paused: d.after, active: !d.after } : { active: d.after, paused: !d.after }
    }
    templates.push(base)
  }

  if (templates.length === 0) return { ok: false, reason: 'mudança em campo que a extensão ainda não sabe aplicar' }
  if (!rmw) {
    // Patch só é seguro se o corpo NÃO carregar outros dados do item (senão copiaríamos dados de um item para outro)
    if (unknownPaths.length > 0) return { ok: false, reason: 'o portal envia o produto inteiro sem uma leitura correspondente — abra o produto no portal (para a extensão ler o detalhe) e salve de novo' }
    const idPaths = leaves(write.body).filter((l) => l.value === itemId).map((l) => l.path)
    for (const t of templates) {
      t.patchBody = write.body
      t.idPaths = idPaths
    }
  }
  return { ok: true, templates, itemId }
}

export const FIELD_LABEL: Record<Field, string> = { price: 'Preço', status: 'Pausar/ativar', name: 'Nome', description: 'Descrição' }
