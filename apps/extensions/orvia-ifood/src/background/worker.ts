/**
 * Service worker: único lugar que conhece a chave de API e fala com o Orvia.
 * Content script e página de opções conversam com ele por mensagens.
 */
import { HubClient, isHubOrigin, isValidApiKey, loginToHub, normalizeHubUrl, originMatchesPatterns, PRODUCTION_HUB, type HubConfig, type HubResult } from '../lib/hub'
import { snapshotToImport } from '../lib/bridge'
import { DEVICE_ID_KEY, HUB_CONFIG_KEY, type Msg, type Reply } from '../lib/messages'
import { listSnapshots, saveSnapshot } from '../storage/store'

const VERSION = chrome.runtime.getManifest().version
let handshakeDone = false
let lastHeartbeat = 0

async function deviceId(): Promise<string> {
  const stored = (await chrome.storage.local.get(DEVICE_ID_KEY))[DEVICE_ID_KEY] as string | undefined
  if (stored) return stored
  const id = crypto.randomUUID()
  await chrome.storage.local.set({ [DEVICE_ID_KEY]: id })
  return id
}

async function loadConfig(): Promise<HubConfig | null> {
  const stored = (await chrome.storage.local.get(HUB_CONFIG_KEY))[HUB_CONFIG_KEY] as Partial<HubConfig> | undefined
  if (!stored?.apiKey) return null
  return { hubUrl: stored.hubUrl || PRODUCTION_HUB, apiKey: stored.apiKey }
}

async function hub(): Promise<HubClient | string> {
  const cfg = await loadConfig()
  if (!cfg) return 'Extensão ainda não conectada ao Orvia. Abra as opções e cole a chave.'
  try {
    const client = new HubClient(cfg)
    if (!handshakeDone) {
      const hs = await client.handshake(VERSION)
      if (hs.ok) handshakeDone = true
    }
    return client
  } catch (error) {
    return error instanceof Error ? error.message : 'Configuração inválida.'
  }
}

function reply<T>(res: HubResult<T>): Reply<T> {
  if (res.ok) return { ok: true, data: res.data }
  if (res.status === 401) handshakeDone = false
  return { ok: false, error: res.message, code: res.code, details: res.details }
}

async function handle(msg: Msg): Promise<Reply<unknown>> {
  switch (msg.type) {
    case 'snapshot:save': {
      const res = await saveSnapshot(msg.snapshot)
      return { ok: true, data: { saved: res.saved } }
    }
    case 'snapshot:latest': {
      const list = await listSnapshots()
      return { ok: true, data: list[0] ?? null }
    }
    case 'options:open': {
      await chrome.runtime.openOptionsPage()
      return { ok: true, data: null }
    }
    case 'hub:test': {
      const base = normalizeHubUrl(msg.hubUrl)
      if (!base) return { ok: false, error: 'Endereço inválido: use https:// (ou http://localhost em desenvolvimento).' }
      try {
        const client = new HubClient({ hubUrl: base, apiKey: msg.apiKey })
        const me = await client.me()
        if (!me.ok) return reply(me)
        const hs = await client.handshake(VERSION)
        handshakeDone = hs.ok
        return { ok: true, data: { ...me.data, handshake: hs.ok ? 'ok' : hs.message } }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'Falha no teste.' }
      }
    }
    case 'hub:pair': {
      // Conexão automática: a chave veio da página do Orvia (origem verificada no listener).
      const base = normalizeHubUrl(msg.hubUrl)
      if (!base || !isValidApiKey(msg.apiKey)) return { ok: false, error: 'Dados de conexão inválidos.' }
      try {
        const client = new HubClient({ hubUrl: base, apiKey: msg.apiKey })
        const me = await client.me()
        if (!me.ok) return reply(me)
        await chrome.storage.local.set({ [HUB_CONFIG_KEY]: { hubUrl: base, apiKey: msg.apiKey } })
        const hs = await client.handshake(VERSION)
        handshakeDone = hs.ok
        return { ok: true, data: { workspace: me.data.workspace } }
      } catch {
        return { ok: false, error: 'Falha ao conectar.' }
      }
    }
    case 'hub:login': {
      // Senha só trafega nesta chamada (HTTPS) — nunca é guardada.
      const res = await loginToHub(msg.hubUrl, {
        email: msg.email,
        password: msg.password,
        workspace_slug: msg.workspaceSlug,
        device_id: await deviceId(),
        device_label: navigator.userAgent.includes('Edg/') ? 'Edge' : 'Chrome',
      })
      if (!res.ok) return { ok: false, error: res.message, code: res.code }
      if ('needs_workspace' in res.data) return { ok: true, data: res.data }
      const base = normalizeHubUrl(msg.hubUrl)!
      await chrome.storage.local.set({ [HUB_CONFIG_KEY]: { hubUrl: base, apiKey: res.data.key, email: res.data.user.email, workspace: res.data.workspace.name } })
      handshakeDone = false
      const client = new HubClient({ hubUrl: base, apiKey: res.data.key })
      const hs = await client.handshake(VERSION)
      handshakeDone = hs.ok
      lastHeartbeat = Date.now()
      return { ok: true, data: { workspace: res.data.workspace, user: res.data.user } }
    }
    case 'hub:heartbeat': {
      // Mantém o "Conectada agora" no painel enquanto o portal iFood está aberto (no máx. 1×/min).
      const cfg = await loadConfig()
      if (!cfg) return { ok: true, data: { configured: false } }
      if (Date.now() - lastHeartbeat < 60_000) return { ok: true, data: { skipped: true } }
      lastHeartbeat = Date.now()
      try {
        const hs = await new HubClient(cfg).handshake(VERSION)
        return hs.ok ? { ok: true, data: { ok: true } } : reply(hs)
      } catch {
        return { ok: false, error: 'Configuração inválida.' }
      }
    }
    case 'hub:status': {
      const cfg = await loadConfig()
      if (!cfg) return { ok: true, data: { configured: false } }
      const client = await hub()
      if (typeof client === 'string') return { ok: false, error: client }
      const me = await client.me()
      if (!me.ok) return reply(me)
      return { ok: true, data: { configured: true, hubUrl: normalizeHubUrl(cfg.hubUrl), workspace: me.data.workspace, scopes: me.data.scopes } }
    }
    default:
      break
  }

  const client = await hub()
  if (typeof client === 'string') return { ok: false, error: client, code: 'not_configured' }

  switch (msg.type) {
    case 'hub:clients':
      return reply(await client.clients())
    case 'hub:menu':
      return reply(await client.menu(msg.clientId))
    case 'hub:pending':
      return reply(await client.pending(msg.clientId))
    case 'hub:sync':
      return reply(await client.markSynced(msg.itemId, msg.etag, msg.ifoodId ?? null))
    case 'hub:createCombo':
      return reply(await client.createCombo(msg.body))
    case 'hub:import': {
      // Conferência antes de aplicar: lê o ETag atual e envia com If-Match.
      const menu = await client.menu(msg.clientId)
      if (!menu.ok) return reply(menu)
      const etag = menu.etag ?? menu.data.etag
      return reply(await client.importSnapshot(etag, snapshotToImport(msg.snapshot, msg.clientId)))
    }
    default:
      return { ok: false, error: 'Mensagem desconhecida.' }
  }
}

chrome.runtime.onMessage.addListener((msg: Msg, sender, sendResponse) => {
  // Só aceita mensagens da própria extensão (content script no portal iFood ou páginas da extensão).
  if (sender.id !== chrome.runtime.id) return false
  const fromPortal = sender.url?.startsWith('https://portal.ifood.com.br/')
  const fromExtension = sender.url?.startsWith(`chrome-extension://${chrome.runtime.id}/`)
  // Página do Orvia (ponte hub-bridge): só pode pedir 'hub:pair' (com a origem confere) ou 'hub:status'.
  const senderOrigin = sender.url ? normalizeHubUrl(sender.url) : null
  const bridgePatterns = (chrome.runtime.getManifest().content_scripts ?? [])
    .filter((cs) => cs.js?.includes('dist/hub-bridge.js'))
    .flatMap((cs) => cs.matches ?? [])
  const fromHub = Boolean(senderOrigin && (isHubOrigin(senderOrigin) || originMatchesPatterns(senderOrigin, bridgePatterns)))
  if (fromHub) {
    if (msg.type === 'hub:pair') {
      if (normalizeHubUrl(msg.hubUrl) !== senderOrigin) return false
    } else if (msg.type !== 'hub:status') {
      return false
    }
  } else if (!fromPortal && !fromExtension) return false
  handle(msg)
    .then(sendResponse)
    .catch(() => sendResponse({ ok: false, error: 'Erro inesperado na extensão.' }))
  return true
})

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install' && !(await loadConfig())) await chrome.runtime.openOptionsPage()
})

chrome.action?.onClicked.addListener(() => {
  void chrome.runtime.openOptionsPage()
})
