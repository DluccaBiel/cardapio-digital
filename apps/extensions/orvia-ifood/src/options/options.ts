import { isValidApiKey, normalizeHubUrl, PRODUCTION_HUB } from '../lib/hub'
import { HUB_CONFIG_KEY, send } from '../lib/messages'

type StoredConfig = { hubUrl?: string; apiKey?: string; email?: string; workspace?: string }

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const hubInput = $<HTMLInputElement>('hubUrl')
const keyInput = $<HTMLInputElement>('apiKey')
const emailInput = $<HTMLInputElement>('email')
const passInput = $<HTMLInputElement>('password')
const wsWrap = $<HTMLDivElement>('wsWrap')
const wsSelect = $<HTMLSelectElement>('workspace')
const loginBtn = $<HTMLButtonElement>('loginBtn')

function show(el: HTMLElement, kind: 'ok' | 'err', text: string) {
  el.className = `status ${kind}`
  el.textContent = text
}

async function stored(): Promise<StoredConfig | undefined> {
  return (await chrome.storage.local.get(HUB_CONFIG_KEY))[HUB_CONFIG_KEY] as StoredConfig | undefined
}

function hubOrigin(): string {
  return normalizeHubUrl(hubInput.value || PRODUCTION_HUB) ?? PRODUCTION_HUB
}

async function render() {
  const cfg = await stored()
  hubInput.value = cfg?.hubUrl ?? PRODUCTION_HUB
  const connected = Boolean(cfg?.apiKey)
  $('connected').style.display = connected ? 'block' : 'none'
  $('loginCard').style.display = connected ? 'none' : 'block'
  $('who').textContent = connected
    ? `${cfg?.email ?? 'Conectada por chave'}${cfg?.workspace ? ` · workspace “${cfg.workspace}”` : ''}`
    : ''
}

/** Endereços fora do domínio de produção exigem permissão opcional (pedida com gesto do usuário). */
async function ensurePermission(origin: string): Promise<boolean> {
  if (origin === PRODUCTION_HUB) return true
  const pattern = origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1') ? 'http://localhost/*' : `${origin}/*`
  try {
    if (await chrome.permissions.contains({ origins: [pattern] })) return true
    return await chrome.permissions.request({ origins: [pattern] })
  } catch {
    return false
  }
}

$('loginForm').addEventListener('submit', async (event) => {
  event.preventDefault()
  const status = $('loginStatus')
  const origin = hubOrigin()
  if (!(await ensurePermission(origin))) return show(status, 'err', 'Permissão de acesso ao endereço negada pelo Chrome.')
  loginBtn.disabled = true
  show(status, 'ok', 'Entrando…')
  const res = await send<{ needs_workspace?: true; workspaces?: { slug: string; name: string }[]; workspace?: { name: string } }>({
    type: 'hub:login',
    hubUrl: origin,
    email: emailInput.value.trim(),
    password: passInput.value,
    workspaceSlug: wsWrap.style.display === 'none' ? undefined : wsSelect.value,
  })
  loginBtn.disabled = false
  if (!res.ok) return show(status, 'err', res.error)
  if (res.data.needs_workspace && res.data.workspaces) {
    wsSelect.replaceChildren(...res.data.workspaces.map((w) => Object.assign(document.createElement('option'), { value: w.slug, textContent: w.name })))
    wsWrap.style.display = 'block'
    return show(status, 'ok', 'Você tem mais de um workspace: escolha qual conectar e clique em “Entrar e conectar” de novo.')
  }
  passInput.value = ''
  show(status, 'ok', `Conectado ao workspace “${res.data.workspace?.name ?? ''}”.`)
  await render()
})

$('logout').addEventListener('click', async () => {
  await chrome.storage.local.remove(HUB_CONFIG_KEY)
  await render()
  show($('loginStatus'), 'ok', 'Desconectado deste navegador. Para revogar o acesso no servidor, use Extensões no Orvia.')
})

$('form').addEventListener('submit', async (event) => {
  event.preventDefault()
  const status = $('status')
  const origin = hubOrigin()
  const apiKey = keyInput.value.trim()
  if (!isValidApiKey(apiKey)) return show(status, 'err', 'Chave inválida. Ela começa com ck_live_ e tem 51 caracteres.')
  if (!(await ensurePermission(origin))) return show(status, 'err', 'Permissão de acesso ao endereço negada pelo Chrome.')
  show(status, 'ok', 'Testando…')
  const res = await send<{ workspace: { name: string } }>({ type: 'hub:test', hubUrl: origin, apiKey })
  if (!res.ok) return show(status, 'err', `Falhou: ${res.error}`)
  await chrome.storage.local.set({ [HUB_CONFIG_KEY]: { hubUrl: origin, apiKey, workspace: res.data.workspace.name } })
  keyInput.value = ''
  show(status, 'ok', `Conectado ao workspace “${res.data.workspace.name}”.`)
  await render()
})

$('auto').addEventListener('click', async () => {
  const origin = hubOrigin()
  if (!(await ensurePermission(origin))) return show($('status'), 'err', 'Permissão de acesso ao endereço negada pelo Chrome.')
  await chrome.tabs.create({ url: `${origin}/conectar-extensao` })
})

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[HUB_CONFIG_KEY]) void render()
})

void render()
