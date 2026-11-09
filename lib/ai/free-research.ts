/**
 * Pesquisa de concorrentes GRATUITA: DuckDuckGo (HTML) + leitura das páginas públicas.
 * Sem chave de API e sem token. Falha nunca derruba a análise (devolve null).
 */
import { buildResearch, extractMenuLines, hostOf, parseSearchResults, usableHit, type PageResult, type SearchHit } from './free-core'
import type { CompetitorResearch } from './competitors'

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const MAX_BYTES = 600_000

/** Só http(s) para sites públicos: nada de localhost, IP literal ou rede interna (evita SSRF). */
export function isPublicUrl(raw: string): boolean {
  try {
    const u = new URL(raw)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
    const h = u.hostname.toLowerCase()
    if (u.username || u.password) return false
    if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || !h.includes('.')) return false
    if (h === 'metadata.google.internal' || h.endsWith('.vercel.internal')) return false
    if (/^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(':')) return false
    return true
  } catch {
    return false
  }
}

async function getText(url: string, init: RequestInit = {}, ms = 7000): Promise<string | null> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try {
    // Redirecionamento MANUAL: cada salto é revalidado (um site público não pode nos mandar para rede interna)
    let current = url
    let res: Response | null = null
    for (let hop = 0; hop <= 3; hop += 1) {
      if (!isPublicUrl(current)) return null
      res = await fetch(current, { ...init, signal: ctrl.signal, redirect: 'manual', headers: { 'user-agent': UA, 'accept-language': 'pt-BR,pt;q=0.9', accept: 'text/html,*/*', ...(init.headers ?? {}) } })
      const loc = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null
      if (!loc) break
      current = new URL(loc, current).toString()
      init = { ...init, method: 'GET', body: undefined } // redirect de POST vira GET
      res = null
    }
    if (!res || !res.ok) return null
    const type = res.headers.get('content-type') ?? ''
    if (type && !/text\/html|application\/xhtml|text\/plain/i.test(type)) return null
    const reader = res.body?.getReader()
    if (!reader) return (await res.text()).slice(0, MAX_BYTES)
    const dec = new TextDecoder('utf-8')
    let out = ''
    let n = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      n += value.byteLength
      out += dec.decode(value, { stream: true })
      if (n > MAX_BYTES) { await reader.cancel().catch(() => undefined); break }
    }
    return out
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

export async function searchWeb(query: string): Promise<SearchHit[]> {
  const body = new URLSearchParams({ q: query, kl: 'br-pt' }).toString()
  const html = await getText('https://html.duckduckgo.com/html/', { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' } })
  if (html && /result__a/.test(html)) return parseSearchResults(html)
  const lite = await getText(`https://duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=br-pt`)
  return lite ? parseSearchResults(lite) : []
}

export async function researchFree(opts: { niche: string; city: string }): Promise<CompetitorResearch | null> {
  try {
    const niche = opts.niche.slice(0, 60) || 'restaurante'
    const city = opts.city.slice(0, 80)
    const queries = [`cardápio ${niche} ${city} delivery preços`, `${niche} ${city} combo cardápio online`]
    const lists = await Promise.all(queries.map((q) => searchWeb(q)))
    const seen = new Set<string>()
    const hits = lists.flat().filter((h) => usableHit(h) && isPublicUrl(h.url) && (seen.has(hostOf(h.url)) ? false : (seen.add(hostOf(h.url)), true))).slice(0, 6)
    if (!hits.length) return null
    const pages: PageResult[] = await Promise.all(hits.map(async (hit) => {
      const html = await getText(hit.url)
      return { hit, lines: html ? extractMenuLines(html) : [] }
    }))
    return buildResearch(pages, { niche, city })
  } catch {
    return null
  }
}
