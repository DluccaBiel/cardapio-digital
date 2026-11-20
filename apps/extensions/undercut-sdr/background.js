// Undercut · SDR WhatsApp — service worker.
// Guarda a chave da extensão (chrome.storage.local) e é o ÚNICO ponto que fala com o hub.
// O content script (WhatsApp Web) e o popup pedem tudo por mensagem: a chave nunca vai para a página.

const DEFAULT_HUB = 'https://orvia-gestao.vercel.app' // brand.extensionHubUrl (fixo em host_permissions)
const EXTENSION_SLUG = 'undercut-sdr'
const INBOX_ALARM = 'sdr-inbox'

async function getState() {
  const s = await chrome.storage.local.get(['hubUrl', 'apiKey', 'workspace', 'email', 'deviceId'])
  if (!s.deviceId) {
    s.deviceId = `sdr-${crypto.randomUUID().slice(0, 18)}`
    await chrome.storage.local.set({ deviceId: s.deviceId })
  }
  return { hubUrl: s.hubUrl || DEFAULT_HUB, apiKey: s.apiKey || null, workspace: s.workspace || null, email: s.email || null, deviceId: s.deviceId }
}

async function call(path, { method = 'GET', body, etag } = {}) {
  const st = await getState()
  if (!st.apiKey) return { status: 401, json: { error: { code: 'unauthorized', message: 'Entre na extensão (ícone do Undercut na barra do Chrome).' } } }
  const headers = { 'Content-Type': 'application/json', 'X-API-Key': st.apiKey }
  if (etag) headers['If-Match'] = etag
  let res
  try {
    res = await fetch(`${st.hubUrl}/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  } catch {
    return { status: 0, json: { error: { code: 'network', message: 'Sem conexão com o Undercut.' } } }
  }
  let json = null
  try {
    json = await res.json()
  } catch {
    json = null
  }
  if (res.status === 401) await chrome.storage.local.remove(['apiKey'])
  return { status: res.status, etag: res.headers.get('etag'), json }
}

async function login({ email, password, workspace_slug }) {
  const st = await getState()
  let res
  try {
    res = await fetch(`${st.hubUrl}/api/v1/extension-auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, workspace_slug: workspace_slug || undefined, device_id: st.deviceId, device_label: 'WhatsApp Web', extension: EXTENSION_SLUG }),
    })
  } catch {
    return { ok: false, error: 'Sem conexão com o Undercut.' }
  }
  const json = await res.json().catch(() => null)
  if (!res.ok) return { ok: false, error: json?.error?.message ?? `Erro ${res.status}` }
  if (json?.data?.needs_workspace) return { ok: false, needsWorkspace: true, workspaces: json.data.workspaces }
  if (json?.data?.extension !== EXTENSION_SLUG) return { ok: false, error: 'O servidor não reconheceu a extensão SDR (atualize o Undercut).' }
  await chrome.storage.local.set({ apiKey: json.data.key, workspace: json.data.workspace, email })
  await refreshInbox()
  return { ok: true, workspace: json.data.workspace }
}

async function refreshInbox() {
  const r = await call('/sdr/inbox')
  if (r.status !== 200) {
    await chrome.action.setBadgeText({ text: '' })
    return null
  }
  const d = r.json.data
  const total = d.needs_human.length + d.awaiting_approval.length + d.reminders.length
  await chrome.action.setBadgeBackgroundColor({ color: '#D7141F' })
  await chrome.action.setBadgeText({ text: total ? String(Math.min(total, 99)) : '' })
  await chrome.storage.local.set({ inbox: d, inboxAt: Date.now() })
  return d
}

chrome.runtime.onInstalled.addListener(() => chrome.alarms.create(INBOX_ALARM, { periodInMinutes: 1 }))
chrome.runtime.onStartup.addListener(() => chrome.alarms.create(INBOX_ALARM, { periodInMinutes: 1 }))
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === INBOX_ALARM) refreshInbox()
})

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  ;(async () => {
    switch (msg?.type) {
      case 'state': {
        const st = await getState()
        return { loggedIn: Boolean(st.apiKey), workspace: st.workspace, email: st.email, hubUrl: st.hubUrl }
      }
      case 'login':
        return login(msg)
      case 'logout':
        await chrome.storage.local.remove(['apiKey', 'workspace', 'email', 'inbox'])
        await chrome.action.setBadgeText({ text: '' })
        return { ok: true }
      case 'setHub': {
        const url = String(msg.hubUrl || '').replace(/\/+$/, '')
        if (!/^https:\/\/[a-z0-9.-]+\.vercel\.app$|^http:\/\/localhost(:\d+)?$/.test(url)) return { ok: false, error: 'Endereço inválido.' }
        await chrome.storage.local.set({ hubUrl: url })
        await chrome.storage.local.remove(['apiKey', 'workspace', 'inbox'])
        return { ok: true }
      }
      case 'inbox':
        return { ok: true, data: await refreshInbox() }
      case 'api': {
        // Só rotas do SDR: o content script não consegue usar a chave para outra coisa.
        if (!/^\/sdr\//.test(String(msg.path || ''))) return { status: 400, json: { error: { message: 'Rota não permitida.' } } }
        const r = await call(msg.path, { method: msg.method, body: msg.body, etag: msg.etag })
        if (msg.method && msg.method !== 'GET') refreshInbox()
        return r
      }
      default:
        return { ok: false, error: 'Mensagem desconhecida.' }
    }
  })().then(reply)
  return true // resposta assíncrona
})
