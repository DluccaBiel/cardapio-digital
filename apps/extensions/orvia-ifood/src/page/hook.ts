/**
 * Roda no "MAIN world" do Portal do Parceiro iFood (document_start).
 * Somente LEITURA: observa respostas JSON de fetch/XHR que o próprio portal já
 * faz e, se parecerem cardápio, repassa o corpo ao content script via
 * window.postMessage (mesma origem). Não lê nem copia headers, cookies ou tokens,
 * não altera requisições e não faz chamadas próprias ao iFood.
 */
import { looksLikeMenuPayload, sanitizePath } from '../core/discovery'

const SOURCE = 'orvia-hook'
const MAX_CHARS = 6_000_000

function forward(url: string, text: string): void {
  if (!text || text.length > MAX_CHARS) return
  const first = text.trimStart()[0]
  if (first !== '{' && first !== '[') return
  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    return
  }
  if (!looksLikeMenuPayload(payload)) return
  window.postMessage({ source: SOURCE, path: sanitizePath(url), payload }, window.location.origin)
}

;(() => {
  const w = window as unknown as { __orviaHooked?: boolean }
  if (w.__orviaHooked) return
  w.__orviaHooked = true

  const originalFetch = window.fetch
  window.fetch = async function orviaFetch(...args: Parameters<typeof fetch>): Promise<Response> {
    const response = await originalFetch.apply(this, args)
    try {
      const type = response.headers.get('content-type') ?? ''
      if (type.includes('json')) {
        const url = typeof args[0] === 'string' ? args[0] : args[0] instanceof URL ? args[0].href : (args[0] as Request).url
        response
          .clone()
          .text()
          .then((text) => forward(url, text))
          .catch(() => undefined)
      }
    } catch {
      /* nunca interfere no portal */
    }
    return response
  }

  const originalOpen = XMLHttpRequest.prototype.open
  const originalSend = XMLHttpRequest.prototype.send
  XMLHttpRequest.prototype.open = function (this: XMLHttpRequest & { __orviaUrl?: string }, ...args: any[]) {
    this.__orviaUrl = String(args[1] ?? '')
    return (originalOpen as any).apply(this, args)
  } as typeof XMLHttpRequest.prototype.open
  XMLHttpRequest.prototype.send = function (this: XMLHttpRequest & { __orviaUrl?: string }, ...args: any[]) {
    this.addEventListener('load', () => {
      try {
        const type = this.getResponseHeader('content-type') ?? ''
        if (!type.includes('json')) return
        if (this.responseType === '' || this.responseType === 'text') forward(this.__orviaUrl ?? '', this.responseText)
        else if (this.responseType === 'json' && this.response) forward(this.__orviaUrl ?? '', JSON.stringify(this.response))
      } catch {
        /* ignora */
      }
    })
    return (originalSend as any).apply(this, args)
  } as typeof XMLHttpRequest.prototype.send
})()
