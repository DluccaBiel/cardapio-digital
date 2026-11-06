/**
 * Content script (mundo isolado) no Portal do Parceiro iFood.
 *  - recebe payloads de cardápio do page hook e normaliza (MenuSnapshot)
 *  - injeta o botão + painel lateral Orvia (Shadow DOM, sem innerHTML com dados)
 *  - fala com o Orvia SOMENTE via service worker (a chave nunca chega aqui)
 *
 * Esta versão não escreve no iFood: a aplicação é ASSISTIDA (antes → depois,
 * copiar valores, confirmar). Escrita automática só depois de mapear os
 * endpoints oficiais do portal (ver README).
 */
import type { AnalysisContext, MenuSnapshot } from '../core/schema'
import { finalizeSnapshot, normalizeFromDom, normalizeMenuPayload } from '../core/normalize'
import { NICHES, runRules, suggestCombos } from '../core/rules'
import { comboComponentsFromIfood, findInSnapshot, guessClient, pendingChanges } from '../lib/bridge'
import type { HubCatalog, HubClientRow, HubPendingItem, ImportSummary } from '../lib/hub'
import { SELECTED_CLIENT_KEY, send } from '../lib/messages'
import { CSS } from './styles'

type Tab = 'cardapio' | 'pendencias' | 'analise'

const state = {
  snapshot: null as MenuSnapshot | null,
  tab: 'cardapio' as Tab,
  open: false,
  connected: null as null | { workspace: string } | { error: string },
  clients: [] as HubClientRow[],
  clientId: '' as string,
  pending: [] as HubPendingItem[],
  pendingLoaded: false,
  busy: false,
  notice: null as null | { kind: 'ok' | 'erro' | 'info'; text: string },
  importResult: null as ImportSummary | null,
  niche: 'hamburgueria',
  discount: 10,
  analysed: false,
}

// ---------------------------------------------------------------------------
// Captura passiva (page hook → aqui)
// ---------------------------------------------------------------------------
function mergeSnapshots(base: MenuSnapshot | null, next: MenuSnapshot): MenuSnapshot {
  if (!base || base.storeKey !== next.storeKey) return next
  const items = new Map(base.items.map((i) => [i.id, i]))
  for (const i of next.items) items.set(i.id, i)
  const cats = new Map(base.categories.map((c) => [c.id, c]))
  for (const c of next.categories) cats.set(c.id, c)
  return finalizeSnapshot({ ...next, merchant: next.merchant.id ? next.merchant : base.merchant, categories: [...cats.values()], items: [...items.values()] })
}

let saveTimer: number | undefined
window.addEventListener('message', (event: MessageEvent) => {
  if (event.source !== window || event.origin !== window.location.origin) return
  const data = event.data as { source?: string; path?: string; payload?: unknown } | null
  if (!data || data.source !== 'orvia-hook') return
  const normalized = normalizeMenuPayload(data.payload, { origin: 'passive', requestPath: data.path ?? null, domUrl: location.href })
  if (!normalized) return
  state.snapshot = mergeSnapshots(state.snapshot, finalizeSnapshot(normalized))
  window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    if (state.snapshot) void send({ type: 'snapshot:save', snapshot: state.snapshot })
  }, 1500)
  render()
})

// ---------------------------------------------------------------------------
// DOM helpers (textContent sempre — nada de innerHTML com dados do portal/API)
// ---------------------------------------------------------------------------
type Child = Node | string | null | undefined | false
function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, any> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue
    if (key === 'class') el.className = value
    else if (key.startsWith('on')) el.addEventListener(key.slice(2).toLowerCase(), value)
    else if (key in el) (el as any)[key] = value
    else el.setAttribute(key, String(value))
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue
    el.append(typeof child === 'string' ? document.createTextNode(child) : child)
  }
  return el
}

const brl = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `R$ ${v.toFixed(2).replace('.', ',')}`)

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    notify('info', 'Copiado.')
  } catch {
    notify('erro', 'Não foi possível copiar.')
  }
}

function notify(kind: 'ok' | 'erro' | 'info', text: string) {
  state.notice = { kind, text }
  render()
}

// ---------------------------------------------------------------------------
// Ações
// ---------------------------------------------------------------------------
async function connect() {
  const status = await send<{ configured: boolean; workspace?: { name: string } }>({ type: 'hub:status' })
  if (!status.ok) state.connected = { error: status.error }
  else if (!status.data.configured) state.connected = { error: 'Não conectada. Abra as opções e cole a chave do Orvia.' }
  else {
    state.connected = { workspace: status.data.workspace?.name ?? '' }
    const clients = await send<HubClientRow[]>({ type: 'hub:clients' })
    if (clients.ok) {
      state.clients = clients.data
      const saved = (await chrome.storage.local.get(SELECTED_CLIENT_KEY))[SELECTED_CLIENT_KEY] as string | undefined
      const guess = guessClient(clients.data, state.snapshot)
      state.clientId = (saved && clients.data.some((c) => c.id === saved) ? saved : guess?.id) ?? clients.data[0]?.id ?? ''
    }
  }
  render()
}

async function selectClient(id: string) {
  state.clientId = id
  state.pending = []
  state.pendingLoaded = false
  state.importResult = null
  await chrome.storage.local.set({ [SELECTED_CLIENT_KEY]: id })
  render()
}

async function run<T>(fn: () => Promise<T>) {
  if (state.busy) return
  state.busy = true
  state.notice = null
  render()
  try {
    await fn()
  } finally {
    state.busy = false
    render()
  }
}

function importToOrvia() {
  return run(async () => {
    if (!state.snapshot || !state.clientId) return
    const client = state.clients.find((c) => c.id === state.clientId)
    const res = await send<ImportSummary>({ type: 'hub:import', clientId: state.clientId, snapshot: state.snapshot })
    if (!res.ok) {
      notify('erro', res.code === 'merchant_mismatch' ? `Loja diferente da vinculada a “${client?.name}”. Confira o cliente selecionado.` : res.error)
      return
    }
    state.importResult = res.data
    notify('ok', `Cardápio enviado para ${client?.name ?? 'o Orvia'}.`)
  })
}

function loadPending() {
  return run(async () => {
    if (!state.clientId) return
    const res = await send<{ pending: HubPendingItem[] }>({ type: 'hub:pending', clientId: state.clientId })
    if (!res.ok) return notify('erro', res.error)
    state.pending = res.data.pending
    state.pendingLoaded = true
  })
}

function confirmApplied(item: HubPendingItem, ifoodId: string) {
  return run(async () => {
    if (item.action === 'create' && !ifoodId.trim()) {
      // permitido, mas avisamos que o vínculo ajuda nas próximas sincronizações
      notify('info', 'Sem ID do iFood: o item fica vinculado na próxima importação pelo nome.')
    }
    const res = await send({ type: 'hub:sync', itemId: item.id, etag: item.etag, ifoodId: ifoodId.trim() || null })
    if (!res.ok) {
      notify('erro', res.code === 'conflict' ? 'O item mudou no Orvia depois da leitura. Atualizei a lista — confira de novo.' : res.error)
      if (res.code === 'conflict') {
        state.busy = false
        await loadPending()
      }
      return
    }
    state.pending = state.pending.filter((p) => p.id !== item.id)
    notify('ok', `“${item.name}” confirmado no iFood.`)
  })
}

function createComboInOrvia(suggestion: ReturnType<typeof suggestCombos>[number]) {
  return run(async () => {
    const menu = await send<HubCatalog>({ type: 'hub:menu', clientId: state.clientId })
    if (!menu.ok) return notify('erro', menu.error)
    const components = comboComponentsFromIfood(suggestion.componentIds, suggestion.componentQuantities, menu.data)
    if (!components) return notify('erro', 'Envie o cardápio para o Orvia antes (os itens do combo ainda não estão lá).')
    const res = await send({
      type: 'hub:createCombo',
      body: { client_id: state.clientId, name: suggestion.name, description: suggestion.componentNames.join(' + '), price: suggestion.price, components },
    })
    if (!res.ok) return notify('erro', res.error)
    notify('ok', `Combo “${suggestion.name}” criado no Orvia (pausado). Revise no painel e aplique pela aba Pendências.`)
  })
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------
// Shadow DOM FECHADO em produção: o JS do portal não consegue ler o painel
// (nomes de clientes do workspace, pendências). Build de teste E2E usa 'open'.
declare const __ORVIA_SHADOW__: 'open' | 'closed'
const host = document.createElement('div')
host.id = 'orvia-ifood-root'
const shadow = host.attachShadow({ mode: typeof __ORVIA_SHADOW__ === 'string' ? __ORVIA_SHADOW__ : 'closed' })
const style = document.createElement('style')
style.textContent = CSS
const mount = document.createElement('div')
shadow.append(style, mount)

function clientSelect() {
  if (state.clients.length === 0) return h('p', { class: 'muted' }, 'Nenhum cliente no Orvia. Crie o cliente no painel (Cardápio → + Cliente).')
  const select = h(
    'select',
    { class: 'input', 'aria-label': 'Cliente no Orvia', onchange: (e: Event) => selectClient((e.target as HTMLSelectElement).value) },
    ...state.clients.map((c) => h('option', { value: c.id, selected: c.id === state.clientId }, c.name)),
  )
  return h('label', { class: 'field' }, h('span', { class: 'label' }, 'Cliente no Orvia'), select)
}

function tabCardapio() {
  const s = state.snapshot
  const box = h('div', {})
  if (!s) {
    box.append(
      h('div', { class: 'card' },
        h('b', {}, 'Nenhum cardápio lido ainda'),
        h('p', { class: 'muted' }, 'Abra a página Cardápio do portal e role pelas categorias — a leitura é automática.'),
        h('button', {
          class: 'btn',
          onclick: () => {
            const dom = normalizeFromDom(document, { domUrl: location.href, merchantName: null })
            if (dom) {
              state.snapshot = finalizeSnapshot(dom)
              notify('info', 'Lido da tela (modo limitado: sem categorias/complementos e sem IDs do iFood).')
            } else notify('erro', 'Não encontrei produtos na tela.')
          },
        }, 'Ler da tela (modo limitado)'),
      ),
    )
  } else {
    const withPrice = s.items.filter((i) => i.price !== null).length
    box.append(
      h('div', { class: 'card' },
        h('div', { class: 'row' }, h('b', {}, s.merchant.name ?? 'Loja sem nome'), h('span', { class: 'pill' }, s.origin === 'dom' ? 'tela' : 'portal')),
        h('p', { class: 'muted' }, `${s.categories.length} categorias · ${s.items.length} produtos (${withPrice} com preço) · ${s.items.filter((i) => i.status === 'paused').length} pausados`),
        s.merchant.id ? h('p', { class: 'muted mono' }, `Loja iFood: ${s.merchant.id}`) : null,
      ),
    )
  }

  box.append(h('h3', {}, 'Enviar para o Orvia'))
  if (!state.connected || 'error' in state.connected) {
    box.append(h('p', { class: 'muted' }, state.connected && 'error' in state.connected ? state.connected.error : 'Conectando…'))
  } else {
    box.append(clientSelect())
    box.append(
      h('button', { class: 'btn primary', disabled: !s || !state.clientId || state.busy, onclick: importToOrvia }, state.busy ? 'Enviando…' : 'Enviar cardápio para o Orvia'),
      h('p', { class: 'hint' }, 'Nada é apagado no Orvia. Itens editados no Orvia e ainda não aplicados no iFood são mantidos.'),
    )
  }
  const r = state.importResult
  if (r) {
    box.append(
      h('div', { class: 'card ok' },
        h('b', {}, 'Resultado'),
        h('p', {}, `Produtos: ${r.items.created} novos · ${r.items.updated} atualizados · ${r.items.unchanged} iguais · ${r.items.linked_by_name} vinculados pelo nome`),
        h('p', {}, `Categorias: ${r.categories.created} novas · Complementos: ${r.groups.created} grupos, ${r.groups.options_created} opções`),
        r.kept_local.length ? h('p', { class: 'warn' }, `${r.kept_local.length} mantidos com a versão do Orvia (veja Pendências).`) : null,
        r.skipped.length ? h('p', { class: 'warn' }, `${r.skipped.length} ignorados: ${r.skipped.slice(0, 4).map((x) => `${x.name} (${x.reason})`).join(', ')}`) : null,
        r.missing_in_ifood ? h('p', { class: 'muted' }, `${r.missing_in_ifood} produto(s) do Orvia não apareceram nesta leitura.`) : null,
      ),
    )
  }
  return box
}

function pendingCard(item: HubPendingItem) {
  const current = findInSnapshot(state.snapshot, item)
  const changes = pendingChanges(item, current)
  const idInput = h('input', { class: 'input', placeholder: 'ID do item no iFood (opcional)', 'aria-label': 'ID no iFood' }) as HTMLInputElement
  const title = item.action === 'create' ? (item.kind === 'combo' ? 'Criar combo no iFood' : 'Criar produto no iFood') : 'Atualizar no iFood'
  return h('div', { class: 'card' },
    h('div', { class: 'row' }, h('b', {}, item.name), h('span', { class: `pill ${item.action}` }, title)),
    item.category ? h('p', { class: 'muted' }, `Categoria: ${item.category}`) : null,
    item.action === 'update' && !current ? h('p', { class: 'warn' }, 'Item não está na leitura atual — abra a categoria dele no portal.') : null,
    h('table', { class: 'diff' },
      h('tbody', {},
        ...changes.map((c) =>
          h('tr', {},
            h('th', {}, c.field),
            h('td', { class: 'before' }, c.before),
            h('td', { class: 'after' }, c.after, ' ', h('button', { class: 'link', title: 'Copiar', onclick: () => copy(c.after.replace(/^R\$ /, '')) }, 'copiar')),
          ),
        ),
      ),
    ),
    changes.length === 0 ? h('p', { class: 'muted' }, 'O iFood já está igual ao Orvia — só confirme.') : null,
    item.kind === 'combo'
      ? h('div', { class: 'combo' },
          h('span', { class: 'label' }, `Itens do combo (separados: ${brl(item.combo_full_price)})`),
          ...item.components.map((c) => h('p', {}, `${c.quantity}× ${c.name} — ${brl(c.price)}`)),
        )
      : null,
    item.addon_groups.length ? h('p', { class: 'muted' }, `Complementos: ${item.addon_groups.join(', ')}`) : null,
    item.action === 'create' ? idInput : null,
    h('button', { class: 'btn primary', disabled: state.busy, onclick: () => confirmApplied(item, idInput.value) }, 'Apliquei no iFood ✓'),
  )
}

function tabPendencias() {
  const box = h('div', {})
  if (!state.connected || 'error' in state.connected) {
    box.append(h('p', { class: 'muted' }, state.connected && 'error' in state.connected ? state.connected.error : 'Conectando…'))
    return box
  }
  box.append(
    clientSelect(),
    h('p', { class: 'hint' }, 'Alterações feitas no Orvia que ainda não estão no iFood. Aplique no portal e confirme aqui — se o item mudar no Orvia no meio do caminho, a confirmação é recusada.'),
    h('button', { class: 'btn', disabled: state.busy || !state.clientId, onclick: loadPending }, state.pendingLoaded ? 'Atualizar lista' : 'Carregar pendências'),
  )
  if (state.pendingLoaded && state.pending.length === 0) box.append(h('div', { class: 'card ok' }, 'Tudo em dia: Orvia e iFood iguais.'))
  for (const item of state.pending) box.append(pendingCard(item))
  return box
}

function tabAnalise() {
  const box = h('div', {})
  const s = state.snapshot
  if (!s) return h('p', { class: 'muted' }, 'Leia o cardápio primeiro (aba Cardápio).')
  const niche = h('select', { class: 'input', 'aria-label': 'Nicho', onchange: (e: Event) => (state.niche = (e.target as HTMLSelectElement).value) },
    ...NICHES.map((n) => h('option', { value: n.value, selected: n.value === state.niche }, n.label)))
  const discount = h('input', { class: 'input', type: 'number', min: '0', max: '50', value: String(state.discount), 'aria-label': 'Desconto do combo %', oninput: (e: Event) => (state.discount = Number((e.target as HTMLInputElement).value) || 0) })
  box.append(
    h('div', { class: 'grid2' }, h('label', { class: 'field' }, h('span', { class: 'label' }, 'Nicho'), niche), h('label', { class: 'field' }, h('span', { class: 'label' }, 'Desconto combo %'), discount)),
    h('button', { class: 'btn', onclick: () => { state.analysed = true; render() } }, 'Analisar cardápio'),
  )
  if (!state.analysed) return box
  const context: AnalysisContext = {
    niche: state.niche, nicheOther: '', goal: 'ticket', targetMarginPercent: null, declaredCosts: '',
    minPrice: null, maxPrice: null, comboDiscountPercent: state.discount, doNotTouchPrices: false, doNotTouchItemIds: [],
  }
  const combos = suggestCombos(s, context)
  const findings = runRules(s, context)
  box.append(h('h3', {}, `Combos sugeridos (${combos.length})`))
  for (const c of combos.slice(0, 6)) {
    box.append(h('div', { class: 'card' },
      h('div', { class: 'row' }, h('b', {}, c.name), h('span', { class: 'pill' }, `−${c.discountPercent}%`)),
      h('p', { class: 'muted' }, c.componentNames.join(' + ')),
      h('p', {}, `${brl(c.componentsTotal)} → `, h('b', {}, brl(c.price))),
      h('p', { class: 'hint' }, c.explanation),
      state.connected && !('error' in state.connected) && state.clientId
        ? h('button', { class: 'btn', disabled: state.busy, onclick: () => createComboInOrvia(c) }, 'Criar no Orvia (pausado)')
        : null,
    ))
  }
  box.append(h('h3', {}, `Pontos de atenção (${findings.length})`))
  for (const f of findings.slice(0, 15)) {
    box.append(h('div', { class: `card sev-${f.severidade}` }, h('b', {}, f.titulo), h('p', { class: 'muted' }, f.evidencia), h('p', {}, f.sugestao)))
  }
  return box
}

function render() {
  mount.replaceChildren()
  const button = h('button', { class: 'fab', 'aria-label': 'Abrir Orvia', title: 'Orvia · iFood', onclick: () => { state.open = !state.open; render() } }, 'O')
  if (state.snapshot) button.append(h('span', { class: 'dot' }))
  mount.append(button)
  if (!state.open) return

  const tabs: [Tab, string][] = [['cardapio', 'Cardápio'], ['pendencias', 'Pendências'], ['analise', 'Análise']]
  const conn = state.connected
  const panel = h('aside', { class: 'panel', role: 'dialog', 'aria-label': 'Orvia · iFood' },
    h('header', {},
      h('div', {}, h('b', {}, 'Orvia · iFood'), h('span', { class: 'sub' }, conn && 'workspace' in conn ? `conectado: ${conn.workspace}` : 'não conectado')),
      h('div', {},
        h('button', { class: 'icon', title: 'Opções', onclick: () => void send({ type: 'options:open' }) }, '⚙'),
        h('button', { class: 'icon', title: 'Fechar', onclick: () => { state.open = false; render() } }, '×'),
      ),
    ),
    h('nav', {}, ...tabs.map(([key, label]) =>
      h('button', {
        class: state.tab === key ? 'tab active' : 'tab',
        onclick: () => {
          state.tab = key
          state.notice = null
          if (key === 'pendencias' && !state.pendingLoaded && state.clientId) void loadPending()
          render()
        },
      }, label))),
    state.notice ? h('div', { class: `notice ${state.notice.kind}` }, state.notice.text) : null,
    h('section', { class: 'body' }, state.tab === 'cardapio' ? tabCardapio() : state.tab === 'pendencias' ? tabPendencias() : tabAnalise()),
  )
  mount.append(panel)
}

async function boot() {
  document.documentElement.append(host)
  const latest = await send<MenuSnapshot | null>({ type: 'snapshot:latest' })
  if (latest.ok && latest.data && !state.snapshot) state.snapshot = latest.data
  render()
  await connect()
}

void boot()
