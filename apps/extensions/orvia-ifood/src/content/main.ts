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
import { comboComponentsFromIfood, filterSnapshot, findInSnapshot, guessClient, pendingChanges } from '../lib/bridge'
import type { HubCatalog, HubClientRow, HubPendingItem, ImportSummary } from '../lib/hub'
import { SELECTED_CLIENT_KEY, send } from '../lib/messages'
import { applyPending, applyRaw, coverage, desiredFromPending } from '../lib/executor'
import { FIELD_LABEL, learnFromWrite, type Field, type Observed, type Template } from '../lib/learn'
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
  templates: [] as Template[],
  autoMode: false,
  lastLearn: null as null | { ok: boolean; text: string },
  runLog: [] as { name: string; ok: boolean; text: string }[],
  undoAvailable: false,
}

const TEMPLATES_KEY = 'orvia.templates'
const AUTO_KEY = 'orvia.autoApply'
const UNDO_KEY = 'orvia.lastBatch'
const recentReads: Observed[] = []

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
function onMenuPayload(payload: unknown, path: string | null) {
  const normalized = normalizeMenuPayload(payload, { origin: 'passive', requestPath: path, domUrl: location.href })
  if (!normalized) return
  state.snapshot = mergeSnapshots(state.snapshot, finalizeSnapshot(normalized))
  window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    if (state.snapshot) void send({ type: 'snapshot:save', snapshot: state.snapshot })
  }, 1500)
  render()
}

/** Você editou um item no portal → aprende como o portal salva aquele campo. */
async function onPortalWrite(write: Observed) {
  if (!state.snapshot) return
  const items = new Map(state.snapshot.items.map((i) => [i.id, { price: i.price, status: i.status }]))
  const res = learnFromWrite(write, recentReads, items)
  if (!res.ok) {
    state.lastLearn = { ok: false, text: `Vi uma alteração no portal, mas não aprendi: ${res.reason}.` }
    return render()
  }
  const fields = new Set(res.templates.map((t) => t.field))
  state.templates = [...state.templates.filter((t) => !fields.has(t.field)), ...res.templates]
  await chrome.storage.local.set({ [TEMPLATES_KEY]: state.templates })
  state.lastLearn = { ok: true, text: `Aprendi como o iFood salva: ${res.templates.map((t) => FIELD_LABEL[t.field]).join(', ')}.` }
  render()
}

window.addEventListener('message', (event: MessageEvent) => {
  if (event.source !== window || event.origin !== window.location.origin) return
  const data = event.data as {
    source?: string
    kind?: string
    path?: string
    payload?: unknown
    method?: string
    url?: string
    status?: number
    json?: unknown
    body?: unknown
  } | null
  if (!data || data.source !== 'orvia-hook') return
  if (data.kind === 'menu') return onMenuPayload(data.payload, data.path ?? null)
  if (data.kind === 'read' && data.url) {
    recentReads.push({ method: 'GET', url: data.url, json: data.json, status: data.status, at: Date.now() })
    while (recentReads.length > 40) recentReads.shift()
  }
  if (data.kind === 'write' && data.url && data.method) {
    void onPortalWrite({ method: data.method, url: data.url, body: data.body, json: data.json, status: data.status, at: Date.now() })
  }
})

/** Requisição feita pela PRÓPRIA aba do portal (sessão do portal; nada sai da página). */
function portalRequest(method: string, url: string, body?: unknown): Promise<{ status: number; json: unknown }> {
  return pageExec({ method, url, body })
}

/** Pede algo ao script da página (mesma aba) e espera a resposta. */
function pageExec(payload: Record<string, unknown>, timeoutMs = 30_000): Promise<{ status: number; json: unknown }> {
  const id = `x${Date.now()}${Math.random().toString(16).slice(2)}`
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener('message', onReply)
      resolve({ status: 0, json: { error: 'tempo esgotado' } })
    }, timeoutMs)
    function onReply(event: MessageEvent) {
      const d = event.data as { source?: string; id?: string; status?: number; json?: unknown } | null
      if (event.source !== window || !d || d.source !== 'orvia-exec-result' || d.id !== id) return
      window.clearTimeout(timer)
      window.removeEventListener('message', onReply)
      resolve({ status: d.status ?? 0, json: d.json })
    }
    window.addEventListener('message', onReply)
    window.postMessage({ source: 'orvia-exec', id, ...payload }, window.location.origin)
  })
}

const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms))

/** Aplica todas as pendências de ATUALIZAÇÃO cobertas pelos moldes. Para no 1º erro real. */
function applyAll(dryRun: boolean) {
  return run(async () => {
    state.runLog = []
    const undo: { ifoodId: string; rawBefore: Partial<Record<Field, unknown>> }[] = []
    const queue = state.pending.filter((p) => p.action === 'update')
    for (const item of queue) {
      const current = findInSnapshot(state.snapshot, item)
      const res = await applyPending(item, current, state.templates, portalRequest, { dryRun })
      if (!res.ok) {
        state.runLog.push({
          name: item.name,
          ok: false,
          text: res.missing.length ? `falta ensinar: ${res.missing.map((f) => FIELD_LABEL[f]).join(', ')}` : res.message,
        })
        if (!res.missing.length) break // erro real: para o lote
        continue
      }
      if (dryRun) {
        const parts = (res.dryRun ?? []).flatMap((d) => d.changes.map((c) => `${FIELD_LABEL[c.field]}: ${JSON.stringify(c.before)} → ${JSON.stringify(c.after)}`))
        state.runLog.push({ name: item.name, ok: true, text: parts.join(' · ') || 'já igual' })
        continue
      }
      if (Object.keys(res.rawBefore).length) undo.push({ ifoodId: item.ifood_id!, rawBefore: res.rawBefore })
      const synced = await send({ type: 'hub:sync', itemId: item.id, etag: item.etag, ifoodId: item.ifood_id })
      state.runLog.push({
        name: item.name,
        ok: synced.ok,
        text: synced.ok ? 'aplicado e conferido no iFood ✓' : `aplicado no iFood, mas o Orvia não confirmou: ${synced.ok ? '' : synced.error}`,
      })
      if (synced.ok) state.pending = state.pending.filter((p) => p.id !== item.id)
      render()
      await sleep(900) // ritmo humano entre escritas
    }
    if (!dryRun && undo.length) {
      await chrome.storage.local.set({ [UNDO_KEY]: undo })
      state.undoAvailable = true
    }
    const okCount = state.runLog.filter((l) => l.ok).length
    notify(okCount ? 'ok' : 'info', dryRun ? `Simulação: ${okCount} item(ns) prontos para aplicar.` : `${okCount} item(ns) aplicados no iFood.`)
  })
}

function undoLast() {
  return run(async () => {
    const batch = ((await chrome.storage.local.get(UNDO_KEY))[UNDO_KEY] ?? []) as { ifoodId: string; rawBefore: Partial<Record<Field, unknown>> }[]
    let okCount = 0
    for (const entry of batch) {
      const res = await applyRaw(entry.ifoodId, entry.rawBefore, state.templates, portalRequest)
      if (!res.ok) {
        notify('erro', `Desfazer parou em ${entry.ifoodId}: ${res.message}`)
        return
      }
      okCount += 1
      await sleep(900)
    }
    await chrome.storage.local.remove(UNDO_KEY)
    state.undoAvailable = false
    notify('ok', `${okCount} item(ns) voltaram ao valor anterior no iFood. No Orvia eles seguem com a versão nova (voltam para Pendências).`)
  })
}

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
  else if (!status.data.configured) state.connected = { error: 'Não conectada. Clique na engrenagem (⚙) e entre com seu e-mail e senha do Orvia.' }
  else {
    state.connected = { workspace: status.data.workspace?.name ?? '' }
    const clients = await send<HubClientRow[]>({ type: 'hub:clients' })
    if (clients.ok) {
      state.clients = clients.data
      const saved = (await chrome.storage.local.get(SELECTED_CLIENT_KEY))[SELECTED_CLIENT_KEY] as string | undefined
      const guess = guessClient(clients.data, state.snapshot)
      state.clientId = (saved && clients.data.some((c) => c.id === saved) ? saved : guess?.id) ?? clients.data[0]?.id ?? ''
      await loadOrviaIds()
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
  await loadOrviaIds()
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

/** Ids selecionados para envio; null = todos (padrão até o usuário mexer). */
let selected: Set<string> | null = null
let listFilter = ''
let orviaIfoodIds = new Set<string>()
let lastSync: { at: number; read: number } | null = null

function isSelected(id: string) {
  return selected === null || selected.has(id)
}
function toggle(ids: string[], on: boolean) {
  if (!state.snapshot) return
  if (selected === null) selected = new Set(state.snapshot.items.map((i) => i.id))
  for (const id of ids) on ? selected.add(id) : selected.delete(id)
  render()
}
function selectedIds(): Set<string> {
  return selected ?? new Set(state.snapshot?.items.map((i) => i.id) ?? [])
}

/** Quais produtos do iFood já existem no Orvia (para marcar "no Orvia" / "novo"). */
async function loadOrviaIds() {
  if (!state.clientId || !state.connected || 'error' in state.connected) return
  const menu = await send<HubCatalog>({ type: 'hub:menu', clientId: state.clientId })
  if (menu.ok) orviaIfoodIds = new Set(menu.data.items.map((i) => i.ifood_id).filter((x): x is string => Boolean(x)))
}

/** "Sincronizar": relê todo o cardápio da loja aberta no portal e lista os produtos. */
function syncMenu() {
  return run(async () => {
    const before = state.snapshot?.items.length ?? 0
    const res = await pageExec({ action: 'refetch-menu' })
    const info = (res.json ?? {}) as { known?: number; read?: number }
    await sleep(800) // dá tempo de as respostas serem normalizadas
    if (!info.known) {
      // portal ainda não carregou o cardápio nesta aba: tenta a tela (modo limitado)
      if (!state.snapshot) {
        const dom = normalizeFromDom(document, { domUrl: location.href, merchantName: null })
        if (dom) state.snapshot = finalizeSnapshot(dom)
      }
      if (!state.snapshot) return notify('erro', 'Abra a página Cardápio do portal (Menu → Cardápio) e clique em Sincronizar de novo.')
    }
    await loadOrviaIds()
    lastSync = { at: Date.now(), read: info.read ?? 0 }
    const total = state.snapshot?.items.length ?? 0
    notify('ok', `Cardápio sincronizado: ${total} produto(s)${total > before && before > 0 ? ` (+${total - before} novos)` : ''}. Selecione e envie para o Orvia.`)
  })
}

function importToOrvia() {
  return run(async () => {
    if (!state.snapshot || !state.clientId) return
    const ids = selectedIds()
    if (ids.size === 0) return notify('erro', 'Selecione pelo menos um produto.')
    const client = state.clients.find((c) => c.id === state.clientId)
    const payload = ids.size === state.snapshot.items.length ? state.snapshot : filterSnapshot(state.snapshot, ids)
    const res = await send<ImportSummary>({ type: 'hub:import', clientId: state.clientId, snapshot: payload })
    if (!res.ok) {
      notify('erro', res.code === 'merchant_mismatch' ? `Loja diferente da vinculada a “${client?.name}”. Confira o cliente selecionado.` : res.error)
      return
    }
    state.importResult = res.data
    await loadOrviaIds()
    notify('ok', `${ids.size} produto(s) enviados para ${client?.name ?? 'o Orvia'}.`)
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
  const connected = Boolean(state.connected && !('error' in state.connected))

  // Cabeçalho: loja + Sincronizar
  box.append(
    h('div', { class: 'card' },
      h('div', { class: 'row' },
        h('div', {},
          h('b', {}, s?.merchant.name ?? 'Cardápio do iFood'),
          h('p', { class: 'muted' }, s
            ? `${s.categories.length} categorias · ${s.items.length} produtos · ${s.items.filter((i) => i.status === 'paused').length} pausados`
            : 'Abra a página Cardápio do portal e clique em Sincronizar.'),
          lastSync ? h('p', { class: 'hint' }, `Sincronizado às ${new Date(lastSync.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`) : null,
        ),
        s ? h('span', { class: 'pill' }, s.origin === 'dom' ? 'tela' : 'portal') : null,
      ),
      h('button', { class: 'btn primary', disabled: state.busy, onclick: syncMenu }, state.busy ? 'Sincronizando…' : '⟳ Sincronizar'),
    ),
  )
  if (!s) return box

  // Cliente destino
  if (connected) box.append(clientSelect())
  else box.append(h('p', { class: 'warn' }, state.connected && 'error' in state.connected ? state.connected.error : 'Conectando ao Orvia…'))

  // Controles da lista
  const ids = selectedIds()
  const term = listFilter.trim().toLowerCase()
  const visible = s.items.filter((i) => !term || `${i.name} ${i.categoryName ?? ''}`.toLowerCase().includes(term))
  const search = h('input', {
    class: 'input',
    id: 'orvia-search',
    placeholder: 'Buscar produto…',
    value: listFilter,
    'aria-label': 'Buscar produto',
    oninput: (e: Event) => {
      listFilter = (e.target as HTMLInputElement).value
      render()
      const el = shadow.getElementById('orvia-search') as HTMLInputElement | null
      el?.focus()
      el?.setSelectionRange(listFilter.length, listFilter.length)
    },
  })
  const allVisibleOn = visible.length > 0 && visible.every((i) => ids.has(i.id))
  box.append(
    search,
    h('div', { class: 'row listbar' },
      h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: allVisibleOn, 'aria-label': 'Selecionar todos', onchange: (e: Event) => toggle(visible.map((i) => i.id), (e.target as HTMLInputElement).checked) }),
        ` Selecionar todos${term ? ' (filtrados)' : ''}`,
      ),
      h('span', { class: 'muted' }, `${ids.size} de ${s.items.length} selecionados`),
    ),
  )

  // Lista por categoria
  const list = h('div', { class: 'plist' })
  const byCat = new Map<string, typeof visible>()
  for (const item of visible) {
    const key = item.categoryName ?? 'Sem categoria'
    byCat.set(key, [...(byCat.get(key) ?? []), item])
  }
  for (const [cat, items] of byCat) {
    const catOn = items.every((i) => ids.has(i.id))
    list.append(
      h('label', { class: 'pcat' },
        h('input', { type: 'checkbox', checked: catOn, 'aria-label': `Selecionar categoria ${cat}`, onchange: (e: Event) => toggle(items.map((i) => i.id), (e.target as HTMLInputElement).checked) }),
        h('b', {}, cat),
        h('span', { class: 'muted' }, ` ${items.filter((i) => ids.has(i.id)).length}/${items.length}`),
      ),
    )
    for (const item of items) {
      const inOrvia = orviaIfoodIds.has(item.id)
      list.append(
        h('label', { class: isSelected(item.id) ? 'prow on' : 'prow' },
          h('input', { type: 'checkbox', checked: isSelected(item.id), 'aria-label': `Selecionar ${item.name}`, onchange: (e: Event) => toggle([item.id], (e.target as HTMLInputElement).checked) }),
          h('span', { class: 'pname' }, item.name, item.status === 'paused' ? h('span', { class: 'tag' }, 'pausado') : null),
          h('span', { class: inOrvia ? 'tag ok' : 'tag new' }, inOrvia ? 'no Orvia' : 'novo'),
          h('span', { class: 'pprice' }, brl(item.price)),
        ),
      )
    }
  }
  if (visible.length === 0) list.append(h('p', { class: 'muted' }, 'Nenhum produto com esse filtro.'))
  box.append(list)

  // Enviar
  box.append(
    h('button', { class: 'btn primary', disabled: !connected || !state.clientId || state.busy || ids.size === 0, onclick: importToOrvia },
      state.busy ? 'Enviando…' : `Enviar selecionados (${ids.size}) para o Orvia`),
    h('p', { class: 'hint' }, 'Nada é apagado no Orvia. Produtos editados no Orvia e ainda não aplicados no iFood são mantidos.'),
  )

  const r = state.importResult
  if (r) {
    box.append(
      h('div', { class: 'card ok' },
        h('b', {}, 'Resultado'),
        h('p', {}, `Produtos: ${r.items.created} novos · ${r.items.updated} atualizados · ${r.items.unchanged} iguais · ${r.items.linked_by_name} vinculados pelo nome`),
        h('p', {}, `Categorias: ${r.categories.created} novas · Complementos: ${r.groups.created} grupos, ${r.groups.options_created} opções`),
        r.kept_local.length ? h('p', { class: 'warn' }, `${r.kept_local.length} mantidos com a versão do Orvia (veja Pendências).`) : null,
        r.skipped.length ? h('p', { class: 'warn' }, `${r.skipped.length} ignorados: ${r.skipped.slice(0, 4).map((x) => `${x.name} (${x.reason})`).join(', ')}`) : null,
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
  box.append(automationCard())
  if (state.pendingLoaded && state.pending.length === 0) box.append(h('div', { class: 'card ok' }, 'Tudo em dia: Orvia e iFood iguais.'))
  for (const item of state.pending) box.append(pendingCard(item))
  return box
}

function automationCard() {
  const fields: Field[] = ['price', 'status', 'name', 'description']
  const learned = new Set(state.templates.map((t) => t.field))
  const updates = state.pending.filter((p) => p.action === 'update')
  const ready = updates.filter((p) => coverage(desiredFromPending(p, findInSnapshot(state.snapshot, p)), state.templates).missing.length === 0)
  const auto = h('input', {
    type: 'checkbox',
    checked: state.autoMode,
    onchange: async (e: Event) => {
      state.autoMode = (e.target as HTMLInputElement).checked
      await chrome.storage.local.set({ [AUTO_KEY]: state.autoMode })
      render()
    },
  })
  return h('div', { class: 'card' },
    h('b', {}, 'Aplicação automática no iFood'),
    h('p', { class: 'muted' }, 'A extensão aprende vendo VOCÊ editar 1 produto no portal (ex.: mude um preço e salve). Depois ela repete sozinha para os outros, conferindo antes e depois.'),
    h('div', { class: 'chips' }, ...fields.map((f) => h('span', { class: learned.has(f) ? 'pill ok' : 'pill' }, `${learned.has(f) ? '✓' : '○'} ${FIELD_LABEL[f]}`))),
    state.lastLearn ? h('p', { class: state.lastLearn.ok ? 'okText' : 'warn' }, state.lastLearn.text) : null,
    h('div', { class: 'grid2' },
      h('button', { class: 'btn', disabled: state.busy || ready.length === 0, onclick: () => applyAll(true) }, `Simular (${ready.length})`),
      h('button', { class: 'btn primary', disabled: state.busy || ready.length === 0, onclick: () => applyAll(false) }, `Aplicar automaticamente (${ready.length})`),
    ),
    updates.length > ready.length ? h('p', { class: 'hint' }, `${updates.length - ready.length} item(ns) precisam de um campo ainda não ensinado.`) : null,
    state.undoAvailable ? h('button', { class: 'btn', disabled: state.busy, onclick: undoLast }, 'Desfazer último lote no iFood') : null,
    h('label', { class: 'check' }, auto, ' Aplicar sozinho ao abrir o portal (itens já ensinados)'),
    state.runLog.length ? h('div', { class: 'log' }, ...state.runLog.map((l) => h('p', { class: l.ok ? 'okText' : 'warn' }, `${l.ok ? '✓' : '✗'} ${l.name}: ${l.text}`))) : null,
  )
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
  const stored = await chrome.storage.local.get([TEMPLATES_KEY, AUTO_KEY, UNDO_KEY])
  state.templates = (stored[TEMPLATES_KEY] as Template[] | undefined) ?? []
  state.autoMode = Boolean(stored[AUTO_KEY])
  state.undoAvailable = Array.isArray(stored[UNDO_KEY]) && (stored[UNDO_KEY] as unknown[]).length > 0
  const latest = await send<MenuSnapshot | null>({ type: 'snapshot:latest' })
  if (latest.ok && latest.data && !state.snapshot) state.snapshot = latest.data
  render()
  await connect()
  const beat = () => {
    if (document.visibilityState === 'visible') void send({ type: 'hub:heartbeat' })
  }
  beat()
  window.setInterval(beat, 120_000)
  // Modo automático: espera o cardápio ser lido e aplica o que já foi ensinado
  if (state.autoMode && state.clientId) {
    for (let i = 0; i < 30 && !state.snapshot; i += 1) await sleep(1000)
    await loadPending()
    if (state.pending.some((p) => p.action === 'update')) await applyAll(false)
  }
}

void boot()
