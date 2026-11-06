/** Schemas versionados e utilitários de descoberta.
 * Estes módulos são apenas esqueleto tipado. O preenchimento real virá
 * da interceptação de fetch/XHR no portal do iFood (content script com
 * world "MAIN", document_start). Nunca chute endpoint, payload ou campo.
 */

export type StructureNode =
  | { type: 'object'; keys: Record<string, StructureNode> }
  | { type: 'array'; items: StructureNode | null }
  | { type: 'string'; redacted?: boolean; sample?: string }
  | { type: 'number'; sample?: number }
  | { type: 'boolean'; sample?: boolean }
  | { type: 'null' }
  | { type: 'unknown' }

/** Chaves sensiveis que NAO devem aparecer em amostras ou logs. */
export const SENSITIVE_KEYWORDS = new Set([
  'token',
  'authorization',
  'auth',
  'cookie',
  'password',
  'senha',
  'secret',
  'apikey',
  'session',
  'jwt',
  'bearer',
  'email',
  'phone',
  'telefone',
  'cpf',
  'cnpj',
  'documento',
  'document',
  'cardnumber',
  'cvv',
  'creditcard',
])

/** Verifica se uma palavra-chave e sensivel. */
function isSensitiveWord(word: string): boolean {
  return SENSITIVE_KEYWORDS.has(word.toLowerCase())
}

/** Simplificado: reduz amostras de strings para valores padrao. */
export function redactSample(value: string): string {
  let text = value.trim()
  if (text.length > 80) text = text.slice(0, 77) + '...'

  // replace emails
  text = text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')

  // replace phones (BR format simple check)
  text = text.replace(/\+\d{2}\s?\d{2}\s?\d{4,5}\s?\d{4}/g, '[telefone]')

  // replace documents (CPF/CNPJ simple check)
  text = text.replace(/\d{3}\.\d{3}\.\d{3}-\d{2}/g, '[documento]')
  text = text.replace(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/g, '[documento]')

  if (text.length >= 48 && !/\s/.test(text)) return '[valor]'
  return text
}

/** Tamanho maximo de recursao e chaves por objeto. */
const MAX_DEPTH = 6
const MAX_KEYS = 80

/** Descreve a estrutura de um valor, nunca o conteudo sensivel. */
export function describeBody(value: unknown, includeExamples: boolean, depth = 0): StructureNode {
  if (value === null || value === undefined) return { type: 'null' }
  if (depth >= MAX_DEPTH) return { type: 'unknown' }
  if (typeof value === 'string') {
    return includeExamples
      ? { type: 'string', sample: redactSample(value) }
      : { type: 'string' }
  }
  if (typeof value === 'number') {
    return includeExamples && Number.isFinite(value) ? { type: 'number', sample: value } : { type: 'number' }
  }
  if (typeof value === 'boolean') {
    return includeExamples ? { type: 'boolean', sample: value } : { type: 'boolean' }
  }
  if (Array.isArray(value)) {
    const items = value.length > 0 ? value.slice(0, 5).map((entry) => describeBody(entry, includeExamples, depth + 1)) : []
    return { type: 'array', items: mergeArrayNodes(items) }
  }
  if (typeof value === 'object') {
    const keys: Record<string, StructureNode> = {}
    let count = 0
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (count >= MAX_KEYS) break
      if (isSensitiveWord(key ?? '')) {
        keys[key] = { type: typeof entry === 'string' ? 'string' : 'unknown', redacted: true }
      } else {
        keys[key] = describeBody(entry, includeExamples, depth + 1)
      }
      count += 1
    }
    return { type: 'object', keys }
  }
  return { type: 'unknown' }
}

/** Merge array nodes com safe access. */
function mergeArrayNodes(nodes: StructureNode[]): StructureNode | null {
  if (nodes.length === 0) return { type: 'array', items: null }
  if (nodes.every((node) => node.type === 'array' && node.items !== null)) {
    return nodes[0]!
  }
  if (nodes.every((node) => node.type === 'object')) {
    const keys: Record<string, StructureNode> = {}
    for (const node of nodes) {
      if (node.type !== 'object') continue
      for (const [key, value] of Object.entries(node.keys)) {
        if (!keys[key]) keys[key] = value
      }
    }
    return { type: 'object', keys }
  }
  return nodes[0]!
}

/** Looks for a menu-like payload shape. Used by the discovery interceptor. */
export function looksLikeMenuPayload(payload: unknown): boolean {
  let found = false
  const visit = (value: unknown, depth: number): void => {
    if (found || depth > 6) return
    if (Array.isArray(value)) {
      if (value.length >= 2) {
        const menuish = value.filter(
          (entry) =>
            typeof entry === 'object' &&
            entry !== null &&
            !Array.isArray(entry) &&
            (('name' in entry || 'title' in entry) && ('price' in entry || 'description' in entry || 'items' in entry || 'products' in entry)),
        )
        if (menuish.length >= 2) {
          found = true
          return
        }
      }
      value.slice(0, 20).forEach((entry) => visit(entry, depth + 1))
      return
    }
    if (typeof value === 'object' && value !== null) {
      for (const [, entry] of Object.entries(value as Record<string, unknown>)) {
        visit(entry, depth + 1)
        if (found) return
      }
    }
  }
  visit(payload, 0)
  return found
}

/** Sequencial interno para IDs de entrada de descoberta. */
let sequence = 0

/** Construi uma DiscoveryEntry com metadados SANITIZADOS apenas.
 *  Nunca armazena token, cookie, cabecalho ou valor sensivel.
 *  O campo req/res contem apenas a estrutura tipada (keys/types), nao valores.
 */
export function buildDiscoveryEntry({
  method,
  url,
  status,
  requestBody,
  responseBody,
  includeExamples = false,
  ts,
}: {
  method: string
  url: string
  status: number
  requestBody?: unknown
  responseBody?: unknown
  includeExamples?: boolean
  ts?: number
}): DiscoveryEntry {
  sequence += 1
  return {
    id: `net_${ts ?? Date.now()}_${sequence}`,
    ts: new Date(ts ?? Date.now()).toISOString(),
    method: method.toUpperCase(),
    path: sanitizePath(url),
    status,
    req: requestBody !== undefined ? describeBody(requestBody, includeExamples) : null,
    res: responseBody !== undefined ? describeBody(responseBody, includeExamples) : null,
    menuLike: responseBody !== undefined && looksLikeMenuPayload(responseBody),
  }
}

/** Path do portal: remove protocolo, www, query string e redige valores sensiveis. */
export function sanitizePath(rawUrl: string, base = 'https://portal.ifood.com.br'): string {
  let url: URL
  try {
    url = new URL(rawUrl, base)
  } catch {
    return rawUrl.replace(/[?#].*$/, '')
  }
  const segments = url.pathname.split('/').map((segment) => {
    if (!segment) return segment
    if (/^\d+$/.test(segment)) return '{id}'
    if (/^[0-9a-f]{8}-[0-9a-f-]{20,}$/i.test(segment)) return '{id}'
    if (/^[0-9a-f]{16,}$/i.test(segment)) return '{id}'
    if (/^[A-Za-z0-9_-]{16,}$/.test(segment) && /\d/.test(segment) && /[A-Za-z]/.test(segment)) return '{id}'
    return segment
  })
  const query: string[] = []
  url.searchParams.forEach((_value, key) => {
    if (isSensitiveWord(key)) return
    query.push(`${encodeURIComponent(key)}={valor}`)
  })
  return segments.join('/') + (query.length > 0 ? `?${query.join('&')}` : '')
}

/** Exportacao sanitizada (sem dados brutos). */
export interface SanitizedDiscoveryExport {
  schemaVersion: 1
  generatedAt: string
  generatedBy: string
  note: string
  entries: DiscoveryEntry[]
}

/** Funcao principal: injeta o botao flutuante Orvia na pagina do iFood.
 *  Appear automaticamente ao carregar o site https://portal.ifood.com.br/menu/list
 *  Tamanho medio, cor azul #2F6BFF, posicao fixed bottom-right
 *  Abre painel lateral com abas: Cardapio, Analise, Plano, Execucao, Descoberta, Configuracoes
 */
export function injectFloatButton(): void {
  // identifiers
  const BTN_ID = 'orvia-float-btn'
  const PANEL_ID = 'orvia-float-panel'
  const OVERLAY_ID = 'orvia-float-overlay'

  // verify already injected
  const existing = document.getElementById(BTN_ID)
  if (existing && existing.isConnected) return

  // create button - medium size, blue color, fixed position
  const btn = document.createElement('button')
  btn.id = BTN_ID
  btn.setAttribute('aria-label', 'Orvia Abrir painel de otimizacao')
  // styles as direct assignment - medium button, blue #2F6BFF
  ;(btn.style as any).cssText = [
    'position:fixed;',
    'right:20px;',
    'bottom:20px;',
    'z-index:2147483647;',
    'width:48px;',
    'height:48px;',
    'border-radius:50%;',
    'background:#2F6BFF;',
    'border:none;',
    'cursor:pointer;',
    'box-shadow:0 4px 12px rgba(47,107,255,0.35);',
    'transition:transform 0.2s,background 0.2s;',
    'flex-shrink:0;',
  ].join('')
  ;(btn.style as any).flexShrink = '0'

  // SVG icon inline (fill #E6ECFA, medium complexity)
  btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="#E6ECFA" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-12S17.52 2 12 2zm5.5 13c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM15.5 9.5c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v1c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5v-1zm9.5 4h-1v6h1v-6zm0 4h-1v10h1V15z" fill="#E6ECFA"/></svg>'

  document.body.appendChild(btn)

  // create overlay
  const overlay = document.createElement('div')
  overlay.id = OVERLAY_ID
  ;(overlay.style as any).cssText = [
    'position:fixed;',
    'inset:0;',
    'z-index:2147483646;',
    'background:rgba(0,0,0,0.45);',
    'opacity:0;',
    'visibility:hidden;',
    'transition:opacity 0.3s,visibility 0.3s;',
  ].join('')
  document.body.appendChild(overlay)

  // create panel (side panel) - compact but functional
  const panel = document.createElement('div')
  panel.id = PANEL_ID
  ;(panel.style as any).cssText = [
    'position:fixed;',
    'right:0;',
    'top:0;',
    'bottom:0;',
    'width:360px;',
    'z-index:2147483647;',
    'background:#0B1220;',
    'box-shadow:-4px 0 20px rgba(0,0,0,0.5);',
    'transform:translateX(360px);',
    'transition:transform 0.3s ease-out;',
    'border-left:4px solid #2F6BFF;',
    'display:flex;',
    'flex-direction:column;',
    'overflow-y:auto;',
    'font-size:13px;',
  ].join('')
  // header
  const header = document.createElement('div')
  ;(header.style as any).cssText = [
    'display:flex;',
    'align-items:center;',
    'justify-content:space-between;',
    'padding:12px 16px;',
    'border-bottom:1px solid #1E2532;',
    'color:#E6ECFA;',
    'font-weight:600;',
    'font-size:13px;',
  ].join('')
  const title = document.createElement('span')
  title.textContent = 'Orvia Otimizador iFood'
  const closeBtn = document.createElement('button')
  ;(closeBtn.style as any).cssText = ['background:none;border:none;color:#8FA0C4;font-size:18px;cursor:pointer;padding:2px;'].join('')
  closeBtn.textContent = '×'
  closeBtn.addEventListener('click', () => {
    panel.style.transform = 'translateX(360px)'
    overlay.style.display = 'none'
    overlay.style.visibility = 'hidden'
    overlay.style.opacity = '0'
  })
  header.appendChild(title)
  header.appendChild(closeBtn)
  // tab bar - simplified
  const tabBar = document.createElement('div')
  ;(tabBar.style as any).cssText = ['display:flex;padding:0 16px;background:#111A2E;border-bottom:1px solid #1E2532;'].join('')
  const tabNames = ['cardapio', 'analise', 'plano', 'execucao', 'descoberta', 'config']
  tabNames.forEach((title, i) => {
    const tab = document.createElement('div')
    ;(tab.style as any).cssText = ['flex:1;padding:8px 4px;color:#8FA0C4;font-size:11px;font-weight:500;text-align:center;cursor:pointer;border-radius:5px 5px 0 0;margin:0 1px;background:#1E2532;'].join('')
    tab.textContent = title.charAt(0).toUpperCase() + title.slice(1)
    tab.dataset.tab = title
    tab.addEventListener('click', () => {
      ;([...document.querySelectorAll('.orvia-tab')] as HTMLElement[]).forEach((t: HTMLElement) => { t.style.background = ''; t.classList.remove('orvia-tab-active') })
      tab.style.background = '#2F6BFF'
      tab.classList.add('orvia-tab-active')
      ;([...document.querySelectorAll('.orvia-panel-content')] as HTMLElement[]).forEach((c: HTMLElement) => c.style.display = 'none')
      ;(document.getElementById('orvia-panel-' + tab.dataset.tab) as HTMLElement).style.display = 'block'
    })
    tabBar.appendChild(tab)
  })
  // panel contents - simplified
  const contents: HTMLElement[] = []
  tabNames.forEach((name, i) => {
    const content = document.createElement('div')
    ;(content.style as any).cssText = ['padding:12px;flex:1;overflow-y:auto;color:#E6ECFA;display:none;font-size:12px;'].join('')
    content.id = 'orvia-panel-' + name
    content.classList.add('orvia-panel-content')
    const secTitle = document.createElement('div')
    ;(secTitle.style as any).cssText = ['font-size:12px;font-weight:600;margin-bottom:8px;color:#C9D3E3;'].join('')
    secTitle.textContent = 'Carregando...'
    content.appendChild(secTitle)
    contents.push(content)
  })
  ;([...tabBar.children] as HTMLElement[]).forEach((t: HTMLElement, i: number) => {
    t.addEventListener('click', () => {
      ;([...document.querySelectorAll('.orvia-tab')] as HTMLElement[]).forEach((t2: HTMLElement) => { t2.style.background = ''; t2.classList.remove('orvia-tab-active') })
      t.style.background = '#2F6BFF'
      t.classList.add('orvia-tab-active')
      ;(contents as HTMLElement[]).forEach((c: HTMLElement) => c.style.display = 'none')
      ;(contents[i] as HTMLElement).style.display = 'block'
    })
  })
  panel.appendChild(header)
  panel.appendChild(tabBar)
  contents.forEach((c) => panel.appendChild(c))
  document.body.appendChild(panel)

  // show/hide logic
  btn.addEventListener('click', () => {
    const open = panel.style.transform !== 'translateX(0)'
    panel.style.transform = open ? 'translateX(360px)' : 'translateX(0)'
    overlay.style.display = open ? 'none' : 'block'
    overlay.style.visibility = open ? 'hidden' : 'visible'
    overlay.style.opacity = open ? '0' : '1'
  })
  overlay.addEventListener('click', () => {
    panel.style.transform = 'translateX(360px)'
    overlay.style.display = 'none'
    overlay.style.visibility = 'hidden'
    overlay.style.opacity = '0'
  })

  // mutate observer to clean up on navigation - simplified
  // Just re-inject on body mutation if button removed
  const observer = new MutationObserver(() => {
    const b = document.getElementById(BTN_ID) as HTMLButtonElement | null
    if (b && !b.isConnected) {
      try {
        ;(document.getElementById(PANEL_ID) as HTMLElement)?.remove()
        ;(document.getElementById(OVERLAY_ID) as HTMLElement)?.remove()
        ;(document.getElementById(BTN_ID) as HTMLButtonElement)?.remove()
      } catch {}
      injectFloatButton()
    }
  })
  observer.observe(document.body, { childList: true, subtree: true })
}

/** Estruturas para exportacao estruturada. */
export interface DiscoveryEntry {
  id: string
  ts: string
  method: string
  path: string
  status: number
  req: StructureNode | null
  res: StructureNode | null
  menuLike: boolean
}

export interface SanitizedDiscoveryExport {
  schemaVersion: 1
  generatedAt: string
  generatedBy: string
  note: string
  entries: DiscoveryEntry[]
}