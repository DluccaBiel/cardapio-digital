/**
 * Cliente da API do Orvia (/api/v1). Roda no service worker (host_permissions
 * do hub → sem CORS). A chave vai SOMENTE no header X-API-Key e nunca é logada.
 */

export const PRODUCTION_HUB = 'https://orvia-gestao.vercel.app'

/**
 * Origens canônicas do hub (aliases que servem o mesmo deployment na Vercel). A ponte
 * "conectar com um clique" aceita qualquer uma delas, para a experiência não depender do
 * alias antigo da extensão.
 */
export const HUB_ORIGINS: readonly string[] = [
  'https://orvia-gestao.vercel.app',
  'https://undercuthub.vercel.app',
  'https://orviahub.vercel.app',
  'https://nextjs-cardapio.vercel.app',
]

export function isHubOrigin(origin: string | null | undefined): boolean {
  if (!origin) return false
  try {
    const normalized = new URL(origin).origin
    return (HUB_ORIGINS as readonly string[]).includes(normalized)
  } catch {
    return false
  }
}

export interface HubConfig {
  hubUrl: string
  apiKey: string
}

export type HubResult<T> =
  | { ok: true; data: T; etag: string | null }
  | { ok: false; status: number; code: string; message: string; details?: Record<string, unknown> }

export interface HubClientRow {
  id: string
  name: string
  ifood_merchant_id: string | null
}

export interface HubMenuItem {
  id: string
  kind: 'item' | 'combo'
  name: string
  description: string | null
  price: number
  status: 'active' | 'inactive' | 'out_of_stock'
  ifood_id: string | null
  pending: boolean
  updated_at: string
}

export interface HubCatalog {
  client: HubClientRow
  items: HubMenuItem[]
  etag: string
}

export interface HubPendingItem {
  id: string
  etag: string
  kind: 'item' | 'combo'
  action: 'create' | 'update'
  ifood_id: string | null
  name: string
  description: string | null
  price: number
  status: 'active' | 'inactive' | 'out_of_stock'
  category: string | null
  addon_groups: string[]
  components: { id: string; ifood_id: string | null; name: string; price: number | null; quantity: number }[]
  combo_full_price: number | null
  updated_at: string
}

export interface ImportSummary {
  categories: { created: number; updated: number }
  items: { created: number; updated: number; unchanged: number; linked_by_name: number }
  groups: { created: number; options_created: number }
  kept_local: { id: string; name: string }[]
  skipped: { name: string; reason: string }[]
  missing_in_ifood: number
}

/** Aceita só https (ou http://localhost para desenvolvimento). Retorna a origem sem barra final. */
export function normalizeHubUrl(input: string): string | null {
  try {
    const url = new URL(input.trim())
    const local = url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
    if (url.protocol !== 'https:' && !local) return null
    return url.origin
  } catch {
    return null
  }
}

export function isValidApiKey(key: string): boolean {
  return /^ck_live_[A-Za-z0-9_-]{43}$/.test(key.trim())
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export class HubClient {
  private readonly base: string

  constructor(
    private readonly cfg: HubConfig,
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
  ) {
    const base = normalizeHubUrl(cfg.hubUrl)
    if (!base) throw new Error('Endereço do Orvia inválido (use https://…).')
    this.base = `${base}/api/v1`
  }

  private async call<T>(method: string, path: string, opts: { body?: unknown; ifMatch?: string } = {}): Promise<HubResult<T>> {
    const headers: Record<string, string> = { 'X-API-Key': this.cfg.apiKey.trim(), Accept: 'application/json' }
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
    if (opts.ifMatch) headers['If-Match'] = opts.ifMatch
    let res: Response
    try {
      res = await this.fetchImpl(`${this.base}${path}`, {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        credentials: 'omit',
        cache: 'no-store',
      })
    } catch {
      return { ok: false, status: 0, code: 'network', message: 'Sem conexão com o Orvia. Confira o endereço e a internet.' }
    }
    let json: any = null
    try {
      json = await res.json()
    } catch {
      json = null
    }
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        code: json?.error?.code ?? `http_${res.status}`,
        message: json?.error?.message ?? `Erro ${res.status} no Orvia.`,
        details: json?.error?.details,
      }
    }
    return { ok: true, data: json?.data as T, etag: res.headers.get('etag') }
  }

  me() {
    return this.call<{ workspace: { id: string; name: string; slug: string }; scopes: string[]; extension_id: string | null }>('GET', '/me')
  }
  handshake(version: string) {
    return this.call<{ version: string; last_seen_at: string }>('POST', '/extensions/handshake', { body: { version, manifest_name: 'Orvia · Otimizador iFood' } })
  }
  clients() {
    return this.call<HubClientRow[]>('GET', '/clients')
  }
  menu(clientId: string) {
    return this.call<HubCatalog>('GET', `/menu?client_id=${encodeURIComponent(clientId)}`)
  }
  importSnapshot(etag: string, body: unknown) {
    return this.call<ImportSummary>('POST', '/menu/import', { body, ifMatch: etag })
  }
  pending(clientId: string) {
    return this.call<{ client: HubClientRow; pending: HubPendingItem[] }>('GET', `/menu/pending?client_id=${encodeURIComponent(clientId)}`)
  }
  markSynced(itemId: string, etag: string, ifoodId?: string | null) {
    return this.call<{ id: string; updated_at: string; ifood_id: string | null }>('POST', `/menu/items/${encodeURIComponent(itemId)}/ifood-sync`, {
      body: ifoodId ? { ifood_id: ifoodId } : {},
      ifMatch: etag,
    })
  }
  createCombo(body: { client_id: string; name: string; description: string; price: number; components: { component_id: string; quantity: number }[] }) {
    return this.call<{ id: string; updated_at: string }>('POST', '/menu/combos', { body })
  }
}

/**
 * A origem `origin` (ex.: http://localhost:3100) é coberta por algum match pattern
 * do Chrome (ex.: http://localhost/a/*)? Padrões não têm porta: compara esquema + host.
 */
export function originMatchesPatterns(origin: string, patterns: string[]): boolean {
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return false
  }
  return patterns.some((pattern) => {
    const m = /^(https?):\/\/([^/]+)\//.exec(pattern)
    if (!m) return false
    const [, scheme, host] = m
    if (`${scheme}:` !== url.protocol) return false
    if (host === url.hostname) return true
    return host!.startsWith('*.') && url.hostname.endsWith(host!.slice(1))
  })
}

export type LoginResult =
  | { needs_workspace: true; workspaces: { slug: string; name: string }[] }
  | { key: string; workspace: { name: string; slug: string }; user: { email: string } }

/** Login do usuário (e-mail/senha do Orvia) → o servidor devolve a chave da extensão. Sem chave prévia. */
export async function loginToHub(
  hubUrl: string,
  input: { email: string; password: string; workspace_slug?: string; device_id: string; device_label?: string },
  fetchImpl: (input: string, init?: RequestInit) => Promise<Response> = (i, init) => fetch(i, init),
): Promise<HubResult<LoginResult>> {
  const base = normalizeHubUrl(hubUrl)
  if (!base) return { ok: false, status: 0, code: 'invalid_url', message: 'Endereço do Orvia inválido.' }
  let res: Response
  try {
    res = await fetchImpl(`${base}/api/v1/extension-auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(input),
      credentials: 'omit',
      cache: 'no-store',
    })
  } catch {
    return { ok: false, status: 0, code: 'network', message: 'Sem conexão com o Orvia.' }
  }
  const json: any = await res.json().catch(() => null)
  if (!res.ok) return { ok: false, status: res.status, code: json?.error?.code ?? `http_${res.status}`, message: json?.error?.message ?? `Erro ${res.status}` }
  return { ok: true, data: json?.data as LoginResult, etag: null }
}
