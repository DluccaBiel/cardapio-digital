/**
 * Modo GRATUITO (sem ANTHROPIC_API_KEY, sem token): pesquisa pública + ideias por regras.
 * Este arquivo é PURO (sem rede, sem Next): extração de resultados/menus e geração de ideias.
 * A parte de rede fica em free-research.ts.
 */
import type { CompetitorResearch } from './competitors'
import { cleanName, isRejected, parseRequest, type ParsedRequest } from './request'

export type FreeItem = { id: string; ifood_id: string | null; name: string; price: number | null; description: string | null; kind?: 'item' | 'combo'; status?: string }
export type SearchHit = { title: string; url: string; snippet: string }
export type MenuLine = { name: string; price: number }

// ---------------------------------------------------------------------------
// utilidades de texto
// ---------------------------------------------------------------------------
const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
export const decodeEntities = (s: string) =>
  s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, g: string) => {
    if (g[0] === '#') {
      const code = g[1]?.toLowerCase() === 'x' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m
    }
    return ENT[g.toLowerCase()] ?? m
  })
export const stripTags = (s: string) => decodeEntities(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()

const STOP = new Set(['de', 'da', 'do', 'com', 'e', 'a', 'o', 'para', 'em', 'no', 'na', 'un', 'und', 'grande', 'pequena', 'media', 'média', 'g', 'm', 'p'])
export const normalizeName = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
export const tokens = (s: string) => normalizeName(s).split(' ').filter((t) => t.length > 1 && !STOP.has(t))
export function similarity(a: string, b: string): number {
  const A = new Set(tokens(a))
  const B = new Set(tokens(b))
  if (!A.size || !B.size) return 0
  let inter = 0
  for (const t of Array.from(A)) if (B.has(t)) inter += 1
  return inter / (A.size + B.size - inter)
}
export const median = (xs: number[]) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}
export const parsePrice = (s: string): number | null => {
  const m = /(\d{1,4}(?:\.\d{3})*|\d+)[,.](\d{2})\b/.exec(s.replace(/\s/g, ''))
  if (!m) return null
  const v = Number(`${m[1]!.replace(/\./g, '')}.${m[2]}`)
  return v > 0 && v < 5000 ? v : null
}
/** arredonda para o final ,90 mais próximo (sem passar de `ceil`) */
export const toNinety = (v: number) => Math.max(0.9, Math.round(v - 0.9) + 0.9)

// ---------------------------------------------------------------------------
// resultados da busca (DuckDuckGo HTML)
// ---------------------------------------------------------------------------
export function parseSearchResults(html: string): SearchHit[] {
  const out: SearchHit[] = []
  const re = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    let url = decodeEntities(m[1]!)
    const u = /[?&]uddg=([^&]+)/.exec(url)
    if (u) url = decodeURIComponent(u[1]!)
    if (url.startsWith('//')) url = `https:${url}`
    if (!/^https?:\/\//i.test(url)) continue
    const after = html.slice(m.index + m[0].length, m.index + m[0].length + 2500)
    const sn = /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div|td)>/i.exec(after)
    out.push({ title: stripTags(m[2]!).slice(0, 120), url, snippet: sn ? stripTags(sn[1]!).slice(0, 240) : '' })
  }
  const seen = new Set<string>()
  return out.filter((h) => (seen.has(h.url) ? false : (seen.add(h.url), true)))
}

const SKIP_HOSTS = /(^|\.)(facebook|instagram|youtube|tiktok|twitter|x|linkedin|pinterest|wikipedia|tripadvisor|google|bing|reclameaqui|mercadolivre|olx|amazon|shopee)\.com(\.br)?$/i
export function usableHit(h: SearchHit): boolean {
  try {
    const host = new URL(h.url).hostname
    return !SKIP_HOSTS.test(host)
  } catch {
    return false
  }
}
export const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

// ---------------------------------------------------------------------------
// itens e preços de uma página de cardápio
// ---------------------------------------------------------------------------
function walkLd(node: unknown, out: MenuLine[], depth = 0) {
  if (!node || depth > 8) return
  if (Array.isArray(node)) return node.forEach((n) => walkLd(n, out, depth + 1))
  if (typeof node !== 'object') return
  const o = node as Record<string, unknown>
  const t = String(o['@type'] ?? '')
  if (/MenuItem|Product|Offer/i.test(t) && typeof o.name === 'string') {
    const offers = Array.isArray(o.offers) ? o.offers[0] : o.offers
    const raw = (offers as Record<string, unknown> | undefined)?.price ?? o.price
    const price = typeof raw === 'number' ? raw : typeof raw === 'string' ? parsePrice(raw) ?? Number(raw.replace(',', '.')) : null
    if (price && Number.isFinite(price) && price > 0 && price < 5000) out.push({ name: o.name.slice(0, 80), price })
  }
  for (const v of Object.values(o)) walkLd(v, out, depth + 1)
}

export function extractMenuLines(html: string): MenuLine[] {
  const out: MenuLine[] = []
  for (const m of Array.from(html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi))) {
    try { walkLd(JSON.parse(m[1]!), out) } catch { /* JSON-LD inválido */ }
  }
  if (out.length < 3) {
    const text = decodeEntities(html.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ').replace(/<\/(p|div|li|tr|h[1-6]|span|td|a|br)>|<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, ' '))
    const lines = text.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean)
    for (let i = 0; i < lines.length; i += 1) {
      const l = lines[i]!
      const price = /R\$\s*\d/.test(l) ? parsePrice(l.slice(l.search(/R\$/))) : null
      if (price === null) continue
      let name = l.slice(0, l.search(/R\$/)).replace(/[-–—:·|]+\s*$/, '').trim()
      if (!name) {
        // nome na linha anterior (descrição pode estar no meio: pega a mais curta das 2 anteriores)
        const cand = [lines[i - 1], lines[i - 2]].filter((x): x is string => Boolean(x) && !/R\$/.test(x!))
        name = cand.sort((a, b) => a.length - b.length)[0] ?? ''
      }
      if (name.length >= 3 && name.length <= 70 && /[a-zà-ú]/i.test(name) && !/^(de|a partir|frete|taxa|pedido|total|subtotal)/i.test(name)) out.push({ name, price })
    }
  }
  const seen = new Set<string>()
  return out.filter((x) => { const k = `${normalizeName(x.name)}|${x.price}`; return seen.has(k) ? false : (seen.add(k), true) }).slice(0, 60)
}

export function titleToName(title: string, url: string): string {
  const t = title.split(/\s[-–|·]\s/)[0]!.replace(/\b(card[aá]pio|delivery|pedir online|online)\b/gi, '').replace(/\s+/g, ' ').trim()
  return (t.length >= 3 ? t : hostOf(url)).slice(0, 60)
}

export type PageResult = { hit: SearchHit; lines: MenuLine[] }

export function buildResearch(pages: PageResult[], opts: { niche: string; city: string }): CompetitorResearch | null {
  const competitors = pages.filter((p) => p.hit).slice(0, 5).map((p) => {
    const highlights: string[] = []
    const combos = p.lines.filter((l) => /combo|kit|fam[ií]lia|promo/i.test(l.name)).slice(0, 2)
    for (const c of combos) highlights.push(`Combo/promoção: ${c.name} por R$ ${c.price.toFixed(2).replace('.', ',')}`)
    if (p.hit.snippet) highlights.push(p.hit.snippet.slice(0, 160))
    const ninety = p.lines.length ? p.lines.filter((l) => Math.round((l.price % 1) * 100) === 90).length / p.lines.length : 0
    if (p.lines.length >= 5 && ninety >= 0.5) highlights.push('Usa preços terminados em ,90')
    return {
      name: titleToName(p.hit.title, p.hit.url),
      url: p.hit.url,
      highlights: highlights.slice(0, 3),
      examples: p.lines.filter((l) => !combos.includes(l)).slice(0, 4).map((l) => ({ name: l.name, price: l.price })),
      _lines: p.lines,
    }
  }).filter((c) => c.highlights.length || c.examples.length)
  if (!competitors.length) return null
  const all = competitors.flatMap((c) => c._lines)
  const insights: string[] = []
  const med = median(all.map((l) => l.price))
  if (all.length >= 5 && med !== null) insights.push(`Nas ${competitors.length} lojas públicas consultadas (${all.length} itens com preço), o preço mediano é R$ ${med.toFixed(2).replace('.', ',')}.`)
  const comboCount = all.filter((l) => /combo|kit|fam[ií]lia/i.test(l.name)).length
  if (comboCount) insights.push(`${comboCount} combos/kits encontrados nos concorrentes: o combo é um formato comum na região.`)
  const nin = all.length ? all.filter((l) => Math.round((l.price % 1) * 100) === 90).length / all.length : 0
  if (all.length >= 8 && nin >= 0.3) insights.push(`${Math.round(nin * 100)}% dos preços dos concorrentes terminam em ,90.`)
  insights.push('Pesquisa gratuita em fontes públicas (sem IA): preços e combos são leituras de páginas abertas e podem estar desatualizados.')
  const notes = [...insights.map((i) => `- ${i}`), ...competitors.map((c) => `- ${c.name}: ${c.highlights.join('; ')}`)].join('\n')
  return {
    notes,
    competitors: competitors.map(({ _lines: _l, ...c }) => c),
    insights,
    sources: pages.slice(0, 8).map((p) => ({ title: p.hit.title || hostOf(p.hit.url), url: p.hit.url })),
  }
}

// ---------------------------------------------------------------------------
// ideias por regras (sem IA)
// ---------------------------------------------------------------------------
const DRINK = /\b(refri|refrigerante|coca|guaran[aá]|pepsi|fanta|sprite|h2o|suco|[aá]gua|cerveja|heineken|brahma|skol|lata|ch[aá]|energ[eé]tico|1l|2l|600\s?ml|350\s?ml|500\s?ml)\b/i
const isDrink = (n: string) => DRINK.test(n)

export type FreeUpdate = { item_id: string; item_name: string; before: { name: string; description: string | null; price: number }; after: { price: number }; reason: string }
export type FreeCombo = { name: string; description: string; components: { component_id: string; name: string; quantity: number }[]; price: number; full_price: number; reason: string }

export function priceIdeas(items: FreeItem[], research: CompetitorResearch | null, maxPct: number): FreeUpdate[] {
  if (!research || maxPct <= 0) return []
  const comp = research.competitors.flatMap((c) => c.examples.filter((e) => e.price !== null).map((e) => ({ name: e.name, price: e.price as number, store: c.name })))
  const out: (FreeUpdate & { gap: number })[] = []
  for (const it of items) {
    if (!it.price || it.price <= 0 || isDrink(it.name)) continue
    const matches = comp.filter((c) => similarity(it.name, c.name) >= 0.6)
    if (!matches.length) continue
    const med = median(matches.map((m) => m.price))!
    const gap = (med - it.price) / it.price
    if (Math.abs(gap) < 0.06) continue
    const step = Math.min(Math.abs(gap) * 100, maxPct) / 100
    const target = toNinety(it.price * (1 + Math.sign(gap) * step))
    if (Math.abs(target - it.price) < 0.1 || Math.abs(target - it.price) / it.price > maxPct / 100 + 0.01) continue
    out.push({
      gap: Math.abs(gap),
      item_id: it.id,
      item_name: it.name,
      before: { name: it.name, description: it.description, price: it.price },
      after: { price: Number(target.toFixed(2)) },
      reason: `Concorrentes da região vendem item equivalente por cerca de R$ ${med.toFixed(2).replace('.', ',')} (${matches.length} referência${matches.length > 1 ? 's' : ''}); o seu está em R$ ${it.price.toFixed(2).replace('.', ',')}. ${gap > 0 ? 'Há espaço para subir sem sair da faixa da região.' : 'Aproximar do preço da região ajuda a destravar a venda.'}`,
    })
  }
  return out.sort((a, b) => b.gap - a.gap).slice(0, 12).map(({ gap: _g, ...u }) => u)
}

const SIDE = /\b(batata|fritas|onion|an[eé]is|por[cç][aã]o|nuggets?|mandioca|aipim|polenta|salada|acompanhamento)\b/i
const DESSERT = /\b(sobremesa|doce|pudim|brownie|sorvete|a[cç]a[ií]|mousse|torta|petit)\b/i
const BIG_DRINK = /\b(\d+([.,]\d+)?\s*(l|litros?|lts?))\b/i
const brl = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`
const sellable = (i: FreeItem) => Boolean(i.price && i.price > 0) && (i.kind ?? 'item') === 'item' && (i.status ?? 'active') === 'active' && !/combo/i.test(i.name)

/** desconto do combo cresce com o nº de itens (2 → 10%, 3 → 12%, 4+ → 15%) */
export function comboPrice(full: number, units: number, discountPct?: number): number {
  const d = (discountPct ?? (units >= 4 ? 15 : units === 3 ? 12 : 10)) / 100
  let price = toNinety(full * (1 - d))
  if (price >= full || price < full * 0.75) price = Math.floor(full * (1 - d) * 100) / 100
  return Number(price.toFixed(2))
}

type Part = { item: FreeItem; quantity: number }
function makeCombo(name: string, parts: Part[], reason: (full: number, price: number) => string, discountPct?: number): FreeCombo | null {
  const full = Number(parts.reduce((s, p) => s + (p.item.price ?? 0) * p.quantity, 0).toFixed(2))
  const units = parts.reduce((s, p) => s + p.quantity, 0)
  const price = comboPrice(full, units, discountPct)
  if (!(price > 0 && price < full)) return null
  return {
    name: name.slice(0, 80),
    description: parts.map((p) => `${p.quantity > 1 ? `${p.quantity}x ` : ''}${cleanName(p.item.name)}`).join(' + ').slice(0, 300),
    components: parts.map((p) => ({ component_id: p.item.id, name: p.item.name, quantity: p.quantity })),
    price,
    full_price: full,
    reason: reason(full, price).slice(0, 300),
  }
}
/** a extensão identifica combos pelo conjunto de itens: dois combos com os mesmos itens colidem */
const partsKey = (c: FreeCombo) => c.components.map((k) => k.component_id).sort().join('+')

export function comboIdeas(items: FreeItem[], research: CompetitorResearch | null, variant: number, discountPct = 10, rejected = ''): FreeCombo[] {
  const priced = items.filter(sellable)
  const mains = priced.filter((i) => !isDrink(i.name) && !DESSERT.test(i.name)).sort((a, b) => (b.price ?? 0) - (a.price ?? 0))
  const drinks = priced.filter((i) => isDrink(i.name)).sort((a, b) => (a.price ?? 0) - (b.price ?? 0))
  if (!mains.length || !drinks.length) return []
  const seenCombo = research?.insights.some((i) => /combo/i.test(i))
  const sides = mains.filter((i) => SIDE.test(i.name)).sort((a, b) => (a.price ?? 0) - (b.price ?? 0))
  const plates = mains.filter((i) => !SIDE.test(i.name))
  const base = plates.length ? plates : mains
  const out: FreeCombo[] = []
  const start = Math.max(0, variant - 1) * 3
  const tries = Math.max(mains.length, drinks.length) * 2
  const intro = seenCombo ? 'Combos já são comuns entre os concorrentes da região. ' : ''
  const cands: (FreeCombo | null)[] = []
  // 1º prato + bebida (inclui acompanhamentos, como antes); depois prato + acompanhamento + bebida
  for (let k = 0; k < tries; k += 1) {
    const main = mains[(start + k) % mains.length]!
    const drink = drinks[(start + k + Math.floor(k / mains.length)) % drinks.length]!
    cands.push(makeCombo(`Combo ${cleanName(main.name)} + ${cleanName(drink.name)}`, [{ item: main, quantity: 1 }, { item: drink, quantity: 1 }], (full, price) =>
      `${intro}Juntar prato e bebida: avulso ${brl(full)}, no combo ${brl(price)} (economia de ${brl(full - price)}). Aumenta o ticket médio e simplifica a escolha.`, discountPct))
  }
  for (let k = 0; sides.length && k < base.length; k += 1) {
    const main = base[(start + k) % base.length]!
    const side = sides[k % sides.length]!
    const drink = drinks[k % drinks.length]!
    if (main.id === side.id) continue
    cands.push(makeCombo(`Combo Completo ${cleanName(main.name)} + ${cleanName(side.name)} + ${cleanName(drink.name)}`, [{ item: main, quantity: 1 }, { item: side, quantity: 1 }, { item: drink, quantity: 1 }], (full, price) =>
      `${intro}Refeição completa (prato, acompanhamento e bebida): avulso ${brl(full)}, no combo ${brl(price)} (economia de ${brl(full - price)}). Sobe o ticket com um desconto que o cliente percebe.`))
  }
  for (const c of cands) {
    if (!c || isRejected(c.name, rejected) || out.some((o) => partsKey(o) === partsKey(c))) continue
    out.push(c)
    if (out.length >= 3) break
  }
  return out
}

/**
 * Combos que OBRIGATORIAMENTE incluem os itens pedidos pelo gestor ("combos com coca cola 2l").
 * Bebida grande (≥ 1 L) → combos para dividir (dupla/família); bebida pequena → prato + bebida;
 * prato/acompanhamento pedido → ele + bebida (+ acompanhamento).
 */
export function requiredComboIdeas(items: FreeItem[], required: FreeItem[], variant: number, rejected = '', max = 4): FreeCombo[] {
  const priced = items.filter(sellable)
  const req = new Set(required.map((r) => r.id))
  const mains = priced.filter((i) => !req.has(i.id) && !isDrink(i.name) && !SIDE.test(i.name) && !DESSERT.test(i.name)).sort((a, b) => (b.price ?? 0) - (a.price ?? 0))
  const sides = priced.filter((i) => !req.has(i.id) && SIDE.test(i.name)).sort((a, b) => (a.price ?? 0) - (b.price ?? 0))
  const drinks = priced.filter((i) => !req.has(i.id) && isDrink(i.name)).sort((a, b) => (a.price ?? 0) - (b.price ?? 0))
  const rot = <T,>(xs: T[], k: number) => (xs.length ? xs[(Math.max(0, variant - 1) + k) % xs.length]! : null)
  const cands: FreeCombo[] = []
  for (const r of required.filter((x) => x.price && x.price > 0)) {
    const R = cleanName(r.name)
    const asked = `Pedido do gestor: combo com ${R}.`
    if (isDrink(r.name)) {
      const big = BIG_DRINK.test(r.name)
      for (let k = 0; k < Math.max(1, mains.length); k += 1) {
        const m = rot(mains, k)
        const m2 = rot(mains, k + 1)
        const side = rot(sides, k)
        if (!m) break
        const why = (people: number) => (full: number, price: number) =>
          `${asked} Avulso ${brl(full)}, no combo ${brl(price)} (economia de ${brl(full - price)}${people > 1 ? `; ${brl(price / people)} por pessoa` : ''}). ${big ? 'A bebida de família puxa pedidos para dividir e sobe o ticket médio.' : 'Bebida junto do prato aumenta o ticket sem esforço do cliente.'}`
        if (big) {
          if (side) cands.push(makeCombo(`Combo Família ${cleanName(m.name)} + ${R}`, [{ item: m, quantity: 2 }, { item: side, quantity: 1 }, { item: r, quantity: 1 }], why(2))!)
          cands.push(makeCombo(`Combo Dupla ${cleanName(m.name)} + ${R}`, [{ item: m, quantity: 2 }, { item: r, quantity: 1 }], why(2))!)
          if (m2 && m2.id !== m.id) cands.push(makeCombo(`Combo Casal ${cleanName(m.name)} e ${cleanName(m2.name)} + ${R}`, [{ item: m, quantity: 1 }, { item: m2, quantity: 1 }, { item: r, quantity: 1 }], why(2))!)
        } else {
          cands.push(makeCombo(`Combo ${cleanName(m.name)} + ${R}`, [{ item: m, quantity: 1 }, { item: r, quantity: 1 }], why(1))!)
          if (side) cands.push(makeCombo(`Combo Completo ${cleanName(m.name)} + ${R}`, [{ item: m, quantity: 1 }, { item: side, quantity: 1 }, { item: r, quantity: 1 }], why(1))!)
        }
      }
    } else {
      for (let k = 0; k < Math.max(1, drinks.length); k += 1) {
        const d = rot(drinks, k)
        const side = SIDE.test(r.name) ? null : rot(sides, k)
        if (!d) break
        const why = (full: number, price: number) => `${asked} Avulso ${brl(full)}, no combo ${brl(price)} (economia de ${brl(full - price)}). Aumenta o ticket médio e destaca o produto pedido.`
        cands.push(makeCombo(`Combo ${R} + ${cleanName(d.name)}`, [{ item: r, quantity: 1 }, { item: d, quantity: 1 }], why)!)
        if (side) cands.push(makeCombo(`Combo Completo ${R} + ${cleanName(d.name)}`, [{ item: r, quantity: 1 }, { item: side, quantity: 1 }, { item: d, quantity: 1 }], why)!)
      }
    }
  }
  const out: FreeCombo[] = []
  for (const c of cands) {
    if (!c || isRejected(c.name, rejected) || out.some((o) => partsKey(o) === partsKey(c) || o.name === c.name)) continue
    out.push(c)
    if (out.length >= max) break
  }
  return out
}

export function freeSuggest(items: FreeItem[], research: CompetitorResearch | null, o: { maxPct: number; variant: number; notes?: string; strategy?: string }) {
  const req = parseRequest(o.notes, items.filter(sellable), o.strategy)
  const updates = priceIdeas(items, research, o.maxPct)
  const asked = req.required.length ? requiredComboIdeas(items, req.required, o.variant, req.rejected) : []
  const generic = comboIdeas(items, research, o.variant, 10, req.rejected).filter((g) => !asked.some((a) => partsKey(a) === partsKey(g)))
  const combos = [...asked, ...generic].slice(0, 4)
  const understood = requestNotices(req, asked.length)
  if (!combos.length && req.rejected) understood.push('As combinações possíveis com os produtos atuais já foram reprovadas. Peça um item específico (ex.: "combos com batata grande") ou cadastre novos produtos.')
  return {
    summary: `Modo gratuito (sem IA): ${updates.length} ajuste(s) de preço comparando com concorrentes públicos e ${combos.length} combo(s)${asked.length ? `, ${asked.length} com o que você pediu` : ''}.${research ? '' : ' Sem pesquisa de concorrentes nesta rodada.'}`,
    updates,
    combos,
    understood,
  }
}

/** frases curtas para a extensão mostrar o que o servidor entendeu do pedido */
export function requestNotices(req: ParsedRequest, askedCombos: number): string[] {
  const out: string[] = []
  if (req.required.length) out.push(`Entendi o pedido: combos com ${req.required.map((r) => `${cleanName(r.name)} (${brl(r.price ?? 0)})`).join(', ')}${askedCombos ? ` — ${askedCombos} combo(s) novo(s) com preço calculado.` : '.'}`)
  for (const s of req.substitutes) out.push(`Não achei “${s.asked}” exatamente no cardápio; usei “${cleanName(s.used.name)}”.`)
  for (const m of req.missing) out.push(`“${m}” não está no cardápio deste cliente. Cadastre o produto no iFood, sincronize e refaça a análise.`)
  if (req.requests.length && !req.required.length && !req.missing.length && req.wantsCombos) out.push('Gerei combos novos, diferentes dos que você reprovou.')
  return out
}
