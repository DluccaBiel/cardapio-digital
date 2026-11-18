/**
 * Agente de prospecção por dados abertos (OpenStreetMap) — SOMENTE servidor.
 *
 * Sem chave de API: Nominatim (geocodificação da cidade) + Overpass (estabelecimentos
 * de alimentação com telefone). Dados © colaboradores do OpenStreetMap (ODbL).
 * Políticas de uso: no máx. 1 requisição/s ao Nominatim e User-Agent identificando o app
 * (genérico — nunca dados do usuário).
 */

const UA = 'UndercutHub/1.0 (+https://undercuthub.vercel.app)'
const NOMINATIM = 'https://nominatim.openstreetmap.org/search'
// Espelhos públicos do Overpass (o principal às vezes recusa redes inteiras com 406).
const OVERPASS = [
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export type FoodLead = {
  external_id: string
  name: string
  phone: string // só dígitos com DDI 55
  category: string
  address: string | null
  website: string | null
}

const CATEGORY: Record<string, string> = {
  restaurant: 'Restaurante',
  fast_food: 'Lanchonete / fast food',
  cafe: 'Café',
  bar: 'Bar',
  pub: 'Bar',
  ice_cream: 'Sorveteria',
  food_court: 'Praça de alimentação',
  bakery: 'Padaria',
  confectionery: 'Doceria',
  pastry: 'Confeitaria',
  butcher: 'Açougue',
  deli: 'Delicatessen',
}

export class ProspectError extends Error {}

/**
 * Normaliza telefone brasileiro para dígitos com DDI (55 + DDD + número).
 * Aceita "+55 19 99999-0000", "(19) 3333-0000", "019 99999 0000", "0xx19...". Devolve null se inválido.
 */
export function normalizeBrPhone(raw: string | undefined | null): string | null {
  if (!raw) return null
  for (const part of raw.split(/[;,/]| ou /)) {
    let d = part.replace(/\D/g, '')
    if (!d) continue
    if (d.startsWith('0055')) d = d.slice(2)
    if (d.startsWith('55') && (d.length === 12 || d.length === 13)) d = d.slice(2)
    else if (d.startsWith('0')) {
      d = d.replace(/^0+/, '')
      // 0 + operadora (2 dígitos) + DDD + número → remove a operadora
      if (d.length === 12 || d.length === 13) d = d.slice(2)
    }
    if (d.length !== 10 && d.length !== 11) continue
    const ddd = Number(d.slice(0, 2))
    if (ddd < 11 || ddd > 99) continue
    if (d.length === 11 && d[2] !== '9') continue
    return `55${d}`
  }
  return null
}

function pickPhone(tags: Record<string, string>): string | null {
  for (const k of ['contact:whatsapp', 'whatsapp', 'contact:mobile', 'mobile', 'phone', 'contact:phone']) {
    const p = normalizeBrPhone(tags[k])
    if (p) return p
  }
  return null
}

function address(tags: Record<string, string>): string | null {
  const street = [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(', ')
  const s = [street, tags['addr:suburb']].filter(Boolean).join(' — ')
  return s ? s.slice(0, 200) : null
}

function website(tags: Record<string, string>): string | null {
  const w = tags.website || tags['contact:website'] || tags['contact:instagram'] || null
  return w && /^https?:\/\//i.test(w) ? w.slice(0, 300) : null
}

/** Converte a resposta do Overpass em leads (só com nome + telefone válido; sem duplicar telefone). */
export function parseOverpass(json: { elements?: { type: string; id: number; tags?: Record<string, string> }[] }): FoodLead[] {
  const out = new Map<string, FoodLead>()
  for (const el of json.elements ?? []) {
    const tags = el.tags ?? {}
    const name = tags.name?.trim()
    if (!name) continue
    const phone = pickPhone(tags)
    if (!phone || out.has(phone)) continue
    const kind = tags.amenity || tags.shop || ''
    out.set(phone, {
      external_id: `${el.type}/${el.id}`,
      name: name.slice(0, 200),
      phone,
      category: CATEGORY[kind] ?? 'Alimentação',
      address: address(tags),
      website: website(tags),
    })
  }
  return Array.from(out.values())
}

async function fetchJson(url: string, init: RequestInit, timeoutMs: number): Promise<any> {
  const res = await fetch(url, { ...init, cache: 'no-store', signal: AbortSignal.timeout(timeoutMs), headers: { 'User-Agent': UA, ...(init.headers ?? {}) } })
  if (!res.ok) throw new ProspectError(`HTTP ${res.status}`)
  return res.json()
}

export type CityArea = { areaId: number; label: string; viewbox: string }

/** Cidade → id de área do Overpass (3600000000 + id da relação OSM) + retângulo (viewbox do Nominatim). */
export async function geocodeCity(city: string, uf?: string): Promise<CityArea> {
  const qs = new URLSearchParams({ format: 'jsonv2', countrycodes: 'br', city, limit: '5', addressdetails: '0' })
  if (uf) qs.set('state', uf)
  let rows: { osm_type: string; osm_id: number; display_name: string; boundingbox?: string[] }[]
  try {
    rows = await fetchJson(`${NOMINATIM}?${qs}`, {}, 15_000)
  } catch {
    throw new ProspectError('Não consegui localizar a cidade agora (serviço de mapas indisponível). Tente de novo em instantes.')
  }
  const hit = rows.find((r) => r.osm_type === 'relation')
  if (!hit) throw new ProspectError(`Cidade não encontrada: "${city}${uf ? `/${uf}` : ''}". Confira o nome e a UF.`)
  const [south, north, west, east] = hit.boundingbox ?? []
  return {
    areaId: 3_600_000_000 + Number(hit.osm_id),
    label: hit.display_name.split(',').slice(0, 3).join(',').trim(),
    viewbox: [west, north, east, south].join(','),
  }
}

export function foodQuery(areaId: number, limit = 400, timeoutSeconds = 60): string {
  // Filtros de chave explícitos (um por chave de telefone) são bem mais leves que regex de chave.
  const kinds = ['["amenity"~"^(restaurant|fast_food|cafe|bar|pub|ice_cream|food_court)$"]', '["shop"~"^(bakery|confectionery|pastry|butcher|deli)$"]']
  const phones = ['phone', 'contact:phone', 'mobile', 'contact:mobile', 'contact:whatsapp']
  const lines = kinds.flatMap((k) => phones.map((p) => `  nwr${k}["${p}"]["name"](area.a);`))
  return `[out:json][timeout:${timeoutSeconds}];
area(id:${areaId})->.a;
(
${lines.join('\n')}
);
out tags ${limit};`
}

// ---------------------------------------------------------------------------
// Plano B: busca por tipo de estabelecimento no Nominatim (mais estável que o Overpass,
// porém mais lenta: no máx. 1 requisição/s, 50 resultados por página).
// ---------------------------------------------------------------------------

/** Frases especiais do Nominatim (tipo de estabelecimento) → todas do nicho food. */
export const NOMINATIM_FOOD_PHRASES = ['restaurants', 'fast food', 'bakeries', 'cafes', 'bars', 'pubs', 'ice cream', 'confectionery shops', 'pastry shops', 'food courts']
const NOMINATIM_MAX_PAGES = 8

type NominatimPlace = {
  place_id: number
  osm_type: string
  osm_id: number
  category?: string
  type?: string
  name?: string
  display_name?: string
  extratags?: Record<string, string> | null
  address?: Record<string, string>
}

/** Converte resultados do Nominatim no mesmo formato do Overpass (reaproveita parseOverpass). */
export function nominatimToElements(rows: NominatimPlace[]): { type: string; id: number; tags: Record<string, string> }[] {
  return rows.map((x) => {
    const tags: Record<string, string> = { ...(x.extratags ?? {}) }
    if (x.name) tags.name = x.name
    if (x.category && x.type) tags[x.category] = x.type
    const a = x.address ?? {}
    if (a.road) tags['addr:street'] = a.road
    if (a.house_number) tags['addr:housenumber'] = a.house_number
    if (a.suburb) tags['addr:suburb'] = a.suburb
    return { type: x.osm_type, id: x.osm_id, tags }
  })
}

async function searchViaNominatim(city: string, area: CityArea, onProgress?: (detail: string) => void): Promise<FoodLead[]> {
  const rows: NominatimPlace[] = []
  for (let i = 0; i < NOMINATIM_FOOD_PHRASES.length; i += 1) {
    const phrase = NOMINATIM_FOOD_PHRASES[i]!
    const exclude: number[] = []
    for (let page = 0; page < NOMINATIM_MAX_PAGES; page += 1) {
      await sleep(1100) // política de uso: no máx. 1 requisição/s
      const qs = new URLSearchParams({
        q: `${phrase} in ${city}`,
        format: 'jsonv2',
        countrycodes: 'br',
        limit: '50',
        extratags: '1',
        addressdetails: '1',
        viewbox: area.viewbox,
        bounded: '1',
      })
      if (exclude.length) qs.set('exclude_place_ids', exclude.join(','))
      let batch: NominatimPlace[]
      try {
        batch = await fetchJson(`${NOMINATIM}?${qs}`, {}, 30_000)
      } catch {
        break // segue para o próximo tipo
      }
      if (!Array.isArray(batch) || batch.length === 0) break
      rows.push(...batch)
      exclude.push(...batch.map((b) => b.place_id))
      if (batch.length < 50) break
    }
    onProgress?.(`Varrendo tipos de estabelecimento (${i + 1}/${NOMINATIM_FOOD_PHRASES.length})…`)
  }
  return parseOverpass({ elements: nominatimToElements(rows) })
}

/**
 * Estabelecimentos food com telefone na cidade (roda no robô local, sem limite de tempo).
 * 1) Overpass (mais completo) — uma rodada rápida pelos espelhos públicos, que oscilam muito;
 * 2) se nenhum responder, plano B pelo Nominatim (estável, ~1–2 min).
 */
export async function searchFoodBusinesses(
  city: string,
  uf?: string,
  opts: { overpassBudgetMs?: number; onProgress?: (detail: string) => void } = {},
): Promise<{ label: string; leads: FoodLead[]; source: 'overpass' | 'nominatim' }> {
  const area = await geocodeCity(city, uf)
  const deadline = Date.now() + (opts.overpassBudgetMs ?? 45_000)
  const body = new URLSearchParams({ data: foodQuery(area.areaId) })
  for (const url of OVERPASS) {
    const left = deadline - Date.now()
    if (left < 5000) break
    opts.onProgress?.(`Consultando a base de mapas (${new URL(url).host})…`)
    try {
      const json = await fetchJson(url, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }, Math.min(left, 40_000))
      if (Array.isArray(json?.elements)) return { label: area.label, leads: parseOverpass(json), source: 'overpass' }
    } catch {
      // tenta o próximo espelho
    }
  }
  opts.onProgress?.('Base principal ocupada — usando a busca por tipo de estabelecimento…')
  const leads = await searchViaNominatim(city, area, opts.onProgress)
  return { label: area.label, leads, source: 'nominatim' }
}
