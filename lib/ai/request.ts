/**
 * Lê o pedido em texto livre que a extensão manda em `notes` ao refazer a análise
 * ("refazer novos combos com coca cola 2l") e o converte em requisitos verificáveis:
 * itens do cardápio que DEVEM entrar nos combos, o que não foi encontrado e as ideias
 * já reprovadas (para não repetir). Arquivo PURO (sem rede).
 *
 * Formato enviado pelas extensões 0.4.x:
 *   "Pedidos do cliente nas versões anteriores: A | B\nIdeias JÁ REPROVADAS (traga outras, não repita): X; Y"
 * Qualquer outro texto é tratado inteiro como pedido.
 */
import type { FreeItem } from './free-core'

const normalizeName = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()

export type ParsedRequest = {
  /** pedidos do gestor (o mais recente por último) */
  requests: string[]
  wantsCombos: boolean
  /** itens do cardápio que o gestor pediu explicitamente */
  required: FreeItem[]
  /** trechos pedidos que não existem no cardápio (ex.: "coca cola 2l") */
  missing: string[]
  /** substituições feitas quando o item exato não existe ("coca cola 2l" → "Refrigerante 2L") */
  substitutes: { asked: string; used: FreeItem }[]
  /** texto normalizado das ideias reprovadas */
  rejected: string
}

const REJ = /ideias\s+j[aá]\s+reprovadas[^:]*:/i
const PREV = /pedidos\s+do\s+cliente[^:]*:/i

/** normaliza volumes: "2 litros" → "2l", "1,5 L" → "15l", "600 ml" → "600ml", "coca-cola" → "coca cola" */
export function normalizeQty(s: string): string {
  const t = s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/(\d+)[,.](\d+)\s*(?:litros?|lts?|l)\b/g, '$1$2l')
    .replace(/(\d+)\s*(?:litros?|lts?|l)\b/g, '$1l')
    .replace(/(\d+)\s*ml\b/g, '$1ml')
  return normalizeName(t)
}

/** palavras que não identificam o produto (só o tipo/embalagem) */
const GENERIC = new Set(['refrigerante', 'refri', 'bebida', 'lata', 'garrafa', 'pet', 'demo', 'teste', 'unidade', 'un', 'und', 'gelado', 'gelada', 'original', 'tradicional', 'de', 'da', 'do', 'com', 'e', 'a', 'o'])
const SIZE = /^\d+(ml|l)$/
const DRINK_WORD = /\b(refri|refrigerante|coca|guarana|pepsi|fanta|sprite|suco|agua|cerveja|cha|energetico|\d+l|\d+ml)\b/
const NOT_PRODUCT = /\b(desconto|preco|precos|valor|valores|margem|foto|fotos|descricao|descricoes|nome|nomes|ticket|mais|menos|maior|menor|barato|baratos|caro|caros)\b/

const toks = (s: string) => normalizeQty(s).split(' ').filter((t) => t.length > 1 || /\d/.test(t))
const distinctive = (name: string) => Array.from(new Set(toks(name).filter((t) => !GENERIC.has(t))))
export const cleanName = (name: string) => name.replace(/\s*\([^)]*\)/g, '').replace(/\s+/g, ' ').trim() || name

export function splitNotes(notes: string | undefined): { requests: string[]; rejected: string } {
  if (!notes?.trim()) return { requests: [], rejected: '' }
  const rejAt = notes.search(REJ)
  const head = rejAt >= 0 ? notes.slice(0, rejAt) : notes
  const rejected = rejAt >= 0 ? notes.slice(rejAt).replace(REJ, '') : ''
  const body = head.replace(PREV, '')
  const requests = body.split(/\s\|\s|\n/).map((r) => r.trim()).filter(Boolean)
  return { requests, rejected: normalizeQty(rejected) }
}

/** tira trechos negados ("sem batata", "não quero cebola") para não virarem pedido */
const dropNegated = (s: string) => s.replace(/\b(sem|tirar|tire|exceto|menos|nao quero|nao usar|nao colocar)\s+\S+(\s+\S+)?/g, ' ')

export function parseRequest(notes: string | undefined, items: FreeItem[], strategy?: string): ParsedRequest {
  const { requests, rejected } = splitNotes(notes)
  const reqText = dropNegated(normalizeQty(requests.join(' . ')))
  const reqTokens = new Set(reqText.split(' '))
  const wantsCombos = /\b(combo|combos|kit|kits|familia|dupla|casal)\b/.test(reqText) || strategy === 'combos'

  // 1) itens cujo "nome distintivo" aparece inteiro no pedido
  let matched = items.filter((it) => {
    const d = distinctive(it.name)
    return d.length > 0 && d.some((t) => !SIZE.test(t)) && d.every((t) => reqTokens.has(t))
  })
  // o mais específico vence ("Coca-Cola 2L" tira "Coca-Cola" quando os dois batem)
  matched = matched.filter((a) => {
    const da = distinctive(a.name)
    return !matched.some((b) => b !== a && distinctive(b.name).length > da.length && da.every((t) => distinctive(b.name).includes(t)))
  })

  // 2) trechos pedidos ("com X") que não bateram com nenhum item
  const missing: string[] = []
  const substitutes: ParsedRequest['substitutes'] = []
  const phrases = requests.flatMap((r) => {
    const n = normalizeQty(r)
    return Array.from(n.matchAll(/\bcom\s+(?:o\s+|a\s+|um\s+|uma\s+)?(.+?)(?=\s+(?:e|para|pra|no|na|nos|nas|por|que|mas)\s+|$)/g)).map((m) => m[1]!.trim())
  })
  for (const p of phrases) {
    if (!p || NOT_PRODUCT.test(p)) continue
    const pt = p.split(' ').filter((t) => !GENERIC.has(t))
    if (!pt.length) continue
    const covered = matched.some((it) => { const d = distinctive(it.name); return pt.filter((t) => d.includes(t)).length >= Math.min(2, pt.length) })
    if (covered) continue
    const looksProduct = DRINK_WORD.test(p) || items.some((it) => distinctive(it.name).some((t) => !SIZE.test(t) && pt.includes(t)))
    if (!looksProduct) continue
    // substituto: mesmo volume (2l) ou mesma marca, preferindo bebida
    const size = pt.find((t) => SIZE.test(t))
    const sub = items
      .map((it) => ({ it, d: distinctive(it.name), score: 0 }))
      .map((x) => ({ ...x, score: pt.filter((t) => x.d.includes(t)).length + (size && x.d.includes(size) ? 1 : 0) }))
      .filter((x) => x.score > 0 && (!size || x.d.includes(size)))
      .sort((a, b) => b.score - a.score)[0]
    if (sub && !matched.includes(sub.it)) {
      matched.push(sub.it)
      substitutes.push({ asked: p, used: sub.it })
    } else if (!sub) missing.push(p)
  }

  return { requests, wantsCombos, required: matched.slice(0, 3), missing: Array.from(new Set(missing)).slice(0, 3), substitutes, rejected }
}

export function isRejected(name: string, rejected: string): boolean {
  if (!rejected) return false
  const n = normalizeQty(name)
  return n.length > 3 && rejected.includes(n)
}
