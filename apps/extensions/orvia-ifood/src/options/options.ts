import { isValidApiKey, normalizeHubUrl, PRODUCTION_HUB } from '../lib/hub'
import { HUB_CONFIG_KEY, send } from '../lib/messages'

const form = document.getElementById('form') as HTMLFormElement
const hubInput = document.getElementById('hubUrl') as HTMLInputElement
const keyInput = document.getElementById('apiKey') as HTMLInputElement
const status = document.getElementById('status') as HTMLDivElement
const saveBtn = document.getElementById('save') as HTMLButtonElement

function show(kind: 'ok' | 'err', text: string) {
  status.className = kind
  status.textContent = text
}

async function load() {
  const stored = (await chrome.storage.local.get(HUB_CONFIG_KEY))[HUB_CONFIG_KEY] as { hubUrl?: string; apiKey?: string } | undefined
  hubInput.value = stored?.hubUrl ?? PRODUCTION_HUB
  if (stored?.apiKey) keyInput.placeholder = `${stored.apiKey.slice(0, 12)}… (salva — cole outra para trocar)`
}

/** Endereços fora do domínio de produção exigem permissão opcional (pedida aqui, com gesto do usuário). */
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

form.addEventListener('submit', async (event) => {
  event.preventDefault()
  const origin = normalizeHubUrl(hubInput.value)
  if (!origin) return show('err', 'Endereço inválido. Use https:// (ou http://localhost em desenvolvimento).')
  const stored = (await chrome.storage.local.get(HUB_CONFIG_KEY))[HUB_CONFIG_KEY] as { apiKey?: string } | undefined
  const apiKey = keyInput.value.trim() || stored?.apiKey || ''
  if (!isValidApiKey(apiKey)) return show('err', 'Chave inválida. Ela começa com ck_live_ e tem 51 caracteres.')
  if (!(await ensurePermission(origin))) return show('err', 'Permissão de acesso ao endereço negada pelo Chrome.')

  saveBtn.disabled = true
  show('ok', 'Testando…')
  const res = await send<{ workspace: { name: string }; scopes: string[]; handshake: string }>({ type: 'hub:test', hubUrl: origin, apiKey })
  saveBtn.disabled = false
  if (!res.ok) return show('err', `Falhou: ${res.error}`)
  await chrome.storage.local.set({ [HUB_CONFIG_KEY]: { hubUrl: origin, apiKey } })
  keyInput.value = ''
  keyInput.placeholder = `${apiKey.slice(0, 12)}… (salva)`
  const missing = ['clientes:ler', 'catalogo:ler', 'catalogo:escrever'].filter((s) => !res.data.scopes.includes(s))
  show(
    missing.length ? 'err' : 'ok',
    `Conectado ao workspace “${res.data.workspace.name}”.` + (missing.length ? ` Atenção: faltam escopos ${missing.join(', ')}.` : ' Abra o Portal do Parceiro iFood e clique no botão azul “O”.'),
  )
})

document.getElementById('clear')?.addEventListener('click', async () => {
  await chrome.storage.local.remove(HUB_CONFIG_KEY)
  keyInput.value = ''
  keyInput.placeholder = 'ck_live_…'
  show('ok', 'Desconectado. A chave foi removida deste navegador.')
})

void load()

document.getElementById('auto')?.addEventListener('click', async () => {
  const origin = normalizeHubUrl(hubInput.value) ?? PRODUCTION_HUB
  if (!(await ensurePermission(origin))) return show('err', 'Permissão de acesso ao endereço negada pelo Chrome.')
  await chrome.tabs.create({ url: `${origin}/conectar-extensao` })
})

// Atualiza o status quando a conexão automática terminar em outra aba
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[HUB_CONFIG_KEY]?.newValue) {
    const cfg = changes[HUB_CONFIG_KEY].newValue as { hubUrl: string; apiKey: string }
    hubInput.value = cfg.hubUrl
    keyInput.placeholder = `${cfg.apiKey.slice(0, 12)}… (salva)`
    show('ok', 'Conectado automaticamente. Abra o Portal do Parceiro iFood e clique no botão azul “O”.')
  }
})
