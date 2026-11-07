/**
 * Roda no "MAIN world" do Portal do Parceiro iFood (document_start).
 *
 * 1) LEITURA: observa respostas JSON que o próprio portal carrega. Cardápios vão
 *    para o normalizador; leituras/escritas de itens alimentam o aprendizado
 *    (o content script aprende o formato de escrita quando VOCÊ edita um item).
 * 2) EXECUÇÃO: quando o content script pede, repete o formato aprendido usando a
 *    sessão do próprio portal nesta aba (mesmos cabeçalhos que o portal usou por
 *    último para aquele host). Só hosts https *.ifood.com.br.
 *
 * Cabeçalhos/tokens ficam SOMENTE na memória desta página: nunca são enviados ao
 * content script, ao storage da extensão nem ao Orvia.
 */
import { looksLikeMenuPayload, sanitizePath } from '../core/discovery'

const SOURCE = 'orvia-hook'
const MAX_CHARS = 6_000_000
const SKIP_HEADERS = new Set(['cookie', 'content-length', 'host', 'content-type', 'accept-encoding', 'connection'])
const lastHeaders = new Map<string, Record<string, string>>()

function isIfoodApi(url: URL): boolean {
  return url.protocol === 'https:' && (url.hostname === 'ifood.com.br' || url.hostname.endsWith('.ifood.com.br'))
}

function absolute(raw: string): URL | null {
  try {
    return new URL(raw, window.location.href)
  } catch {
    return null
  }
}

function rememberHeaders(url: URL, headers: Record<string, string>) {
  const kept: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) if (!SKIP_HEADERS.has(k.toLowerCase())) kept[k] = v
  if (Object.keys(kept).length) lastHeaders.set(url.host, kept)
}

function headersToRecord(h: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!h) return out
  if (h instanceof Headers) h.forEach((v, k) => (out[k] = v))
  else if (Array.isArray(h)) for (const [k, v] of h) out[k] = v
  else Object.assign(out, h)
  return out
}

function parse(text: string | null | undefined): unknown {
  if (!text || text.length > MAX_CHARS) return undefined
  const first = text.trimStart()[0]
  if (first !== '{' && first !== '[') return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function observe(method: string, rawUrl: string, status: number, responseText: string | null, requestBody: unknown) {
  const url = absolute(rawUrl)
  if (!url) return
  const json = parse(responseText)
  const m = method.toUpperCase()
  if (m === 'GET' && json !== undefined && looksLikeMenuPayload(json)) {
    window.postMessage({ source: SOURCE, kind: 'menu', path: sanitizePath(url.href), payload: json }, window.location.origin)
  }
  if (!isIfoodApi(url) && url.origin !== window.location.origin) return
  if (m === 'GET' && json !== undefined) {
    window.postMessage({ source: SOURCE, kind: 'read', method: m, url: url.href, status, json }, window.location.origin)
  } else if (['PUT', 'PATCH', 'POST'].includes(m) && requestBody !== undefined) {
    window.postMessage({ source: SOURCE, kind: 'write', method: m, url: url.href, status, body: requestBody, json }, window.location.origin)
  }
}

function bodyOf(body: unknown): unknown {
  return typeof body === 'string' ? parse(body) : undefined
}

;(() => {
  const w = window as unknown as { __orviaHooked?: boolean }
  if (w.__orviaHooked) return
  w.__orviaHooked = true

  const originalFetch = window.fetch.bind(window)

  window.fetch = async function orviaFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const response = await originalFetch(input as any, init)
    try {
      const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
      const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
      const url = absolute(rawUrl)
      if (url && isIfoodApi(url)) rememberHeaders(url, { ...(input instanceof Request ? headersToRecord(input.headers) : {}), ...headersToRecord(init?.headers) })
      const type = response.headers.get('content-type') ?? ''
      const reqBody = bodyOf(init?.body)
      if (type.includes('json') || reqBody !== undefined) {
        response
          .clone()
          .text()
          .then((text) => observe(method, rawUrl, response.status, text, reqBody))
          .catch(() => undefined)
      }
    } catch {
      /* nunca interfere no portal */
    }
    return response
  }

  type X = XMLHttpRequest & { __orvia?: { method: string; url: string; headers: Record<string, string> } }
  const originalOpen = XMLHttpRequest.prototype.open
  const originalSend = XMLHttpRequest.prototype.send
  const originalSetHeader = XMLHttpRequest.prototype.setRequestHeader
  XMLHttpRequest.prototype.open = function (this: X, ...args: any[]) {
    this.__orvia = { method: String(args[0] ?? 'GET'), url: String(args[1] ?? ''), headers: {} }
    return (originalOpen as any).apply(this, args)
  } as typeof XMLHttpRequest.prototype.open
  XMLHttpRequest.prototype.setRequestHeader = function (this: X, name: string, value: string) {
    if (this.__orvia) this.__orvia.headers[name] = value
    return originalSetHeader.call(this, name, value)
  }
  XMLHttpRequest.prototype.send = function (this: X, body?: Document | XMLHttpRequestBodyInit | null) {
    const meta = this.__orvia
    if (meta) {
      const url = absolute(meta.url)
      if (url && isIfoodApi(url)) rememberHeaders(url, meta.headers)
      const reqBody = bodyOf(body)
      this.addEventListener('load', () => {
        try {
          const text = this.responseType === '' || this.responseType === 'text' ? this.responseText : this.responseType === 'json' ? JSON.stringify(this.response) : null
          observe(meta.method, meta.url, this.status, text, reqBody)
        } catch {
          /* ignora */
        }
      })
    }
    return originalSend.call(this, body as any)
  }

  // ---- Executor (pedido do content script) -------------------------------
  window.addEventListener('message', async (event: MessageEvent) => {
    if (event.source !== window || event.origin !== window.location.origin) return
    const data = event.data as { source?: string; id?: string; method?: string; url?: string; body?: unknown } | null
    if (!data || data.source !== 'orvia-exec' || !data.id || !data.url || !data.method) return
    const reply = (status: number, json: unknown) => window.postMessage({ source: 'orvia-exec-result', id: data.id, status, json }, window.location.origin)
    const url = absolute(data.url)
    const method = data.method.toUpperCase()
    if (!url || !isIfoodApi(url) || !['GET', 'PUT', 'PATCH', 'POST'].includes(method)) return reply(0, { error: 'destino não permitido' })
    try {
      const res = await originalFetch(url.href, {
        method,
        headers: { Accept: 'application/json', ...(lastHeaders.get(url.host) ?? {}), ...(data.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: data.body !== undefined ? JSON.stringify(data.body) : undefined,
        credentials: 'include',
      })
      const text = await res.text()
      reply(res.status, parse(text) ?? null)
    } catch {
      reply(0, { error: 'falha de rede' })
    }
  })
})()
