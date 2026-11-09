# Kit de integração — Extensões ↔ Orvia Hub (iFood e Cardápio Web)

> **Para o Claude que mantém as extensões:** este arquivo é a especificação oficial do servidor
> (hub Orvia, versão de 2026-11-09). Siga o **prompt** abaixo, use o **contrato** como fonte da
> verdade e cole o **cliente** (seção 4) no projeto da extensão. Não invente rotas nem campos.

---

## 1. Prompt (copie e cole para o Claude da extensão)

```text
Adapte a extensão "<NOME DA EXTENSÃO>" (slug: <orvia-cardapioweb | orvia-ifood>) para ficar
sempre sincronizada com o servidor Orvia, seguindo o arquivo docs/integracao-extensoes-hub.md
(contrato + cliente prontos). Requisitos:

1. Substitua o cliente HTTP atual pelo `OrviaHub` da seção 4 do arquivo (service worker).
   Constante EXTENSION_SLUG = '<slug>' e MANIFEST_NAME = nome exato do manifest.json.
2. Login: o POST /api/v1/extension-auth/login DEVE mandar `extension: EXTENSION_SLUG`.
   Depois do login, chame GET /api/v1/me e confira `data.extension === EXTENSION_SLUG`;
   se vier diferente (chave antiga criada para outra extensão), apague a chave local e peça
   novo login.
3. Handshake: mande `manifest_name` = nome real desta extensão (hoje a de Cardápio Web manda
   "Orvia · Otimizador iFood" por engano).
4. Sincronização contínua: use chrome.alarms (permissão "alarms") a cada 1 min para
   (a) heartbeat (POST /extensions/handshake) e (b) reenviar a fila offline de otimizações.
   O painel considera a extensão "online" se o último contato tiver < 10 min.
5. Fila offline: se POST /optimizations falhar por rede/5xx/429, guarde o payload em
   chrome.storage.local (máx. 10 itens) e reenvie no próximo alarme. Nunca reenvie em 4xx de
   validação (mostre o erro).
6. Loja: POST /clients/ensure com { name, ifood_merchant_id: <id da loja NESTE canal> }.
   (O nome do campo é legado; para a extensão Cardápio Web o servidor grava no campo da loja
   do Cardápio Web — não misture com o iFood.)
7. Importação: GET /menu?client_id=… → guarde o header ETag → POST /menu/import com
   If-Match = esse ETag. Em 409/412, releia e tente 1×.
8. Prints: evidence = até 6 PNG (nome ^[A-Za-z0-9 ._()-]{1,76}\.png$, cada ≤ 2,5 MB, total do
   corpo ≤ 4,5 MB). Comprima/reduza antes se passar.
9. host_permissions: mantenha https://orvia-gestao.vercel.app/* e adicione
   https://www.orviahub.com.br/* (domínio oficial — o cliente tenta os dois, nessa ordem
   de preferência: o salvo pelo usuário → vercel → domínio oficial).
10. Nunca registre a chave/senha em console/log. Chave só em chrome.storage.local.
11. Atualize testes (vitest) do cliente: login com extension, /me com extensão errada → pede
    novo login, fila offline reenvia, 401 → limpa chave.
Ao final, gere o zip da extensão com a versão incrementada no manifest.
```

---

## 2. Contrato (servidor → extensão)

Base: `{HUB}/api/v1` · `HUB` = `https://orvia-gestao.vercel.app` (ou `https://www.orviahub.com.br` quando o DNS estiver ativo).
Todas as respostas: sucesso `{ "data": ... }` · erro `{ "error": { "code", "message", "details"? } }`.
Autenticação (exceto login): header `X-API-Key: ck_live_…`.

| Rota | Escopo | Corpo / query | Resposta `data` |
|---|---|---|---|
| `POST /extension-auth/login` | — (e-mail+senha) | `{ email, password, workspace_slug?, device_id (8–64 [a-z0-9-]), device_label?, extension: "orvia-ifood" \| "orvia-cardapioweb" }` | `{ key, workspace{name,slug}, user{email}, extension, platform }` **ou** `{ needs_workspace: true, workspaces[{slug,name}] }` (repita com `workspace_slug`) |
| `GET /me` | qualquer | — | `{ workspace{id,name,slug}, scopes[], extension_id, extension, platform }` |
| `POST /extensions/handshake` | qualquer (chave de extensão) | `{ version, manifest_name }` | `{ id, version, status, last_seen_at }` |
| `GET /clients` | `clientes:ler` | — | `[{ id, name, ifood_merchant_id }]` — `ifood_merchant_id` = id da loja **no canal da chave** |
| `POST /clients/ensure` | `catalogo:escrever` | `{ name, ifood_merchant_id? }` | `{ id, name, ifood_merchant_id, created }` |
| `GET /menu?client_id=` | `catalogo:ler` | — | catálogo; header `ETag` |
| `POST /menu/import` | `catalogo:escrever` | snapshot (ver `lib/menu/import.ts`); header `If-Match` obrigatório | resumo; header `ETag` novo. `409 conflict` / `merchant_mismatch` |
| `GET /menu/pending?client_id=` | `catalogo:ler` | — | itens alterados no painel a aplicar no portal |
| `POST /menu/items/{id}/ifood-sync` | `catalogo:escrever` | `{ ifood_id? }`; `If-Match` | marca item aplicado |
| `POST /menu/combos` | `catalogo:escrever` | combo | combo criado |
| `POST /analysis` | `catalogo:ler` | `{ client_id, goal, niche?, city?, notes?, strategy?, strategy_brief?, competitors?, max_price_change_pct? }` | `{ summary, updates[], combos[], competitors[], insights[], sources[], competitors_status, ai_status, notices[] }` (até 120 s) |
| `POST /optimizations` | `catalogo:escrever` | `{ client_id, plan_hash, version, summary, aborted, approved[{id,kind,item_name,before,after,reason,source}], results[{action_id,status,message}], evidence[{name,content_base64}] ≤ 6 }` | `{ id, evidence }` (201). O **canal** (aba iFood/Cardápio Web no painel) vem da chave — não é campo do corpo. |
| `GET /optimizations?client_id=` | `catalogo:ler` | — | últimas 20 do canal da chave, prints com URL assinada (10 min) |

Códigos de erro relevantes: `401 unauthorized` (chave revogada/expirada → novo login) · `403 forbidden_scope` · `409 conflict` · `412/428` If-Match · `422 validation_failed` · `429 rate_limited` (header `Retry-After`) · `5xx`.

Como o servidor identifica a extensão (ordem): campo `extension` do login → `Origin: chrome-extension://<id>` (Cardápio Web 0.3.x = `onolpcebolaabfapfnmemokkinncppok`) → padrão iFood. **Mande sempre o campo**, não dependa do Origin.

---

## 3. Fluxo

```text
 [opções/popup]  e-mail+senha ──► login(extension) ──► key salva (storage.local)
                                         │
                                         ▼
                                 GET /me: extension confere? ── não ──► apaga key, pede login
                                         │ sim
                                         ▼
 chrome.alarms (1 min) ──► handshake (painel: "online")  +  flush da fila de otimizações
                                         │
 [portal aberto] ──► clients/ensure ──► GET /menu (ETag) ──► POST /menu/import (If-Match)
                 ──► POST /analysis ──► usuário aprova ──► aplica no portal
                 ──► POST /optimizations (+ prints) ──falha de rede──► fila ──► alarme reenvia
                                         │
                                         ▼
                 Painel /a/{ws}/extensoes → aba do canal → prints com "Baixar" / "Baixar todos"
```

---

## 4. Cliente pronto (`src/background/orvia-hub.ts`)

```ts
/**
 * Cliente Orvia Hub para extensões MV3 (service worker).
 * Requer no manifest: "permissions": ["storage", "alarms"] e host_permissions do hub.
 */

export const EXTENSION_SLUG = 'orvia-cardapioweb' as const // ou 'orvia-ifood'
export const MANIFEST_NAME = chrome.runtime.getManifest().name
export const HUBS = ['https://orvia-gestao.vercel.app', 'https://www.orviahub.com.br'] as const

const CFG_KEY = 'orvia.hub' // { hubUrl, apiKey, email?, workspace? }
const DEVICE_KEY = 'orvia.deviceId'
const QUEUE_KEY = 'orvia.outbox' // otimizações pendentes de envio
const ALARM = 'orvia-sync'
const MAX_QUEUE = 10

export type HubResult<T> = { ok: true; data: T; etag: string | null } | { ok: false; status: number; code: string; message: string; details?: unknown }
type Cfg = { hubUrl: string; apiKey: string; email?: string; workspace?: string }

const normalize = (u: string) => {
  try {
    const url = new URL(u.trim())
    if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') return null
    return url.origin
  } catch {
    return null
  }
}

async function getCfg(): Promise<Cfg | null> {
  const c = (await chrome.storage.local.get(CFG_KEY))[CFG_KEY] as Cfg | undefined
  return c?.apiKey && c.hubUrl ? c : null
}
export async function clearKey(): Promise<void> {
  const c = await getCfg()
  if (c) await chrome.storage.local.set({ [CFG_KEY]: { hubUrl: c.hubUrl } })
}
async function deviceId(): Promise<string> {
  const s = (await chrome.storage.local.get(DEVICE_KEY))[DEVICE_KEY] as string | undefined
  if (s) return s
  const id = crypto.randomUUID()
  await chrome.storage.local.set({ [DEVICE_KEY]: id })
  return id
}

async function call<T>(base: string, method: string, path: string, opts: { key?: string; body?: unknown; ifMatch?: string } = {}): Promise<HubResult<T>> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (opts.key) headers['X-API-Key'] = opts.key
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
  if (opts.ifMatch) headers['If-Match'] = opts.ifMatch
  let res: Response
  try {
    res = await fetch(`${base}/api/v1${path}`, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      credentials: 'omit',
      cache: 'no-store',
    })
  } catch {
    return { ok: false, status: 0, code: 'network', message: `Sem conexão com ${base}.` }
  }
  const json = (await res.json().catch(() => null)) as any
  if (!res.ok) {
    return { ok: false, status: res.status, code: json?.error?.code ?? `http_${res.status}`, message: json?.error?.message ?? `Erro ${res.status} no Orvia.`, details: json?.error?.details }
  }
  return { ok: true, data: json?.data as T, etag: res.headers.get('etag') }
}

/** Chamada autenticada; 401 → limpa a chave (a UI pede novo login). */
async function authed<T>(method: string, path: string, opts: { body?: unknown; ifMatch?: string } = {}): Promise<HubResult<T>> {
  const cfg = await getCfg()
  if (!cfg) return { ok: false, status: 401, code: 'not_logged_in', message: 'Faça login no Orvia pela extensão.' }
  const r = await call<T>(cfg.hubUrl, method, path, { ...opts, key: cfg.apiKey })
  if (!r.ok && r.status === 401) await clearKey()
  return r
}

export type LoginOk = { workspace: { name: string; slug: string }; user: { email: string } }
export type NeedsWorkspace = { needs_workspace: true; workspaces: { slug: string; name: string }[] }

/** Login: tenta o hub salvo e depois os conhecidos (só troca de hub em erro de REDE). */
export async function login(email: string, password: string, workspaceSlug?: string, preferredHub?: string): Promise<HubResult<LoginOk | NeedsWorkspace>> {
  const saved = (await chrome.storage.local.get(CFG_KEY))[CFG_KEY] as Partial<Cfg> | undefined
  const candidates = Array.from(new Set([preferredHub, saved?.hubUrl, ...HUBS].map((u) => (u ? normalize(u) : null)).filter(Boolean) as string[]))
  const body = {
    email,
    password,
    workspace_slug: workspaceSlug,
    device_id: await deviceId(),
    device_label: navigator.userAgent.includes('Edg/') ? 'Edge' : 'Chrome',
    extension: EXTENSION_SLUG,
  }
  let last: HubResult<any> = { ok: false, status: 0, code: 'network', message: 'Sem conexão com o Orvia.' }
  for (const base of candidates) {
    const r = await call<any>(base, 'POST', '/extension-auth/login', { body })
    if (!r.ok && r.code === 'network') {
      last = r
      continue
    }
    if (!r.ok) return r
    if (r.data?.needs_workspace) return r
    await chrome.storage.local.set({ [CFG_KEY]: { hubUrl: base, apiKey: r.data.key, email: r.data.user.email, workspace: r.data.workspace.name } })
    // Confere que a chave é DESTA extensão
    const me = await authed<{ extension: string | null }>('GET', '/me')
    if (!me.ok) return me
    if (me.data.extension !== EXTENSION_SLUG) {
      await clearKey()
      return { ok: false, status: 409, code: 'wrong_extension', message: 'O servidor ainda não reconhece esta extensão (atualização pendente no Orvia). Tente de novo em instantes.' }
    }
    await handshake()
    return { ok: true, data: { workspace: r.data.workspace, user: r.data.user }, etag: null }
  }
  return last
}

export const me = () => authed<{ workspace: { id: string; name: string; slug: string }; scopes: string[]; extension: string | null; platform: string | null }>('GET', '/me')
export const handshake = () => authed('POST', '/extensions/handshake', { body: { version: chrome.runtime.getManifest().version, manifest_name: MANIFEST_NAME } })
export const clients = () => authed<{ id: string; name: string; ifood_merchant_id: string | null }[]>('GET', '/clients')
/** storeId = id da loja NO CANAL desta extensão (campo com nome legado). */
export const ensureClient = (name: string, storeId: string | null) =>
  authed<{ id: string; name: string; ifood_merchant_id: string | null; created: boolean }>('POST', '/clients/ensure', { body: { name, ifood_merchant_id: storeId } })
export const menu = (clientId: string) => authed<any>('GET', `/menu?client_id=${encodeURIComponent(clientId)}`)
export const pending = (clientId: string) => authed<any>('GET', `/menu/pending?client_id=${encodeURIComponent(clientId)}`)
export const analyze = (body: Record<string, unknown>) => authed<any>('POST', '/analysis', { body })

/** Importa com If-Match; em conflito relê o ETag e tenta 1×. */
export async function importSnapshot(clientId: string, snapshot: Record<string, unknown>): Promise<HubResult<any>> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const cur = await menu(clientId)
    if (!cur.ok) return cur
    if (!cur.etag) return { ok: false, status: 0, code: 'no_etag', message: 'O Orvia não devolveu ETag.' }
    const r = await authed<any>('POST', '/menu/import', { body: { ...snapshot, client_id: clientId }, ifMatch: cur.etag })
    if (r.ok || (r.code !== 'conflict' && r.status !== 412)) return r
  }
  return { ok: false, status: 409, code: 'conflict', message: 'O cardápio mudou no Orvia durante a importação. Tente de novo.' }
}

export type Optimization = {
  client_id: string
  plan_hash: string
  version: number
  summary: string
  aborted: boolean
  approved: { id: string; kind: string; item_name: string; before: unknown; after: unknown; reason: string; source: string }[]
  results: { action_id: string; status: string; message: string }[]
  evidence: { name: string; content_base64: string }[] // PNG sem "data:" prefix
}

const retriable = (r: HubResult<unknown>) => !r.ok && (r.code === 'network' || r.status === 429 || r.status >= 500)

/** Envia o relatório; se a rede/servidor falhar, vai para a fila e o alarme reenvia. */
export async function saveOptimization(o: Optimization): Promise<HubResult<{ id: string; evidence: number }> & { queued?: boolean }> {
  const r = await authed<{ id: string; evidence: number }>('POST', '/optimizations', { body: o })
  if (retriable(r)) {
    const q = ((await chrome.storage.local.get(QUEUE_KEY))[QUEUE_KEY] as Optimization[] | undefined) ?? []
    if (!q.some((x) => x.plan_hash === o.plan_hash && x.client_id === o.client_id)) q.push(o)
    await chrome.storage.local.set({ [QUEUE_KEY]: q.slice(-MAX_QUEUE) })
    return { ...r, queued: true }
  }
  return r
}

async function flushQueue(): Promise<void> {
  const q = ((await chrome.storage.local.get(QUEUE_KEY))[QUEUE_KEY] as Optimization[] | undefined) ?? []
  if (!q.length) return
  const keep: Optimization[] = []
  for (const o of q) {
    const r = await authed('POST', '/optimizations', { body: o })
    if (retriable(r)) keep.push(o) // tenta no próximo alarme; 4xx = descarta (inválido)
  }
  await chrome.storage.local.set({ [QUEUE_KEY]: keep })
}

/** Chame UMA vez no topo do service worker. */
export function startSync(): void {
  chrome.alarms.create(ALARM, { periodInMinutes: 1 })
  chrome.alarms.onAlarm.addListener(async (a) => {
    if (a.name !== ALARM || !(await getCfg())) return
    await handshake()
    await flushQueue()
  })
  chrome.runtime.onStartup.addListener(() => void handshake())
}

/** Utilitário: dataURL PNG → base64 puro (≤ 2,5 MB). */
export function pngBase64(dataUrl: string): string | null {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/]+=*)$/.exec(dataUrl)
  if (!m) return null
  return m[1]!.length * 0.75 <= 2_500_000 ? m[1]! : null
}
```

### Uso no service worker

```ts
import { startSync, login, ensureClient, importSnapshot, analyze, saveOptimization, pngBase64 } from './orvia-hub'

startSync()

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  ;(async () => {
    switch (msg.type) {
      case 'hub:login':        return reply(await login(msg.email, msg.password, msg.workspaceSlug, msg.hubUrl))
      case 'hub:ensure-client':return reply(await ensureClient(msg.name, msg.storeId ?? null))
      case 'hub:import':       return reply(await importSnapshot(msg.clientId, msg.snapshot))
      case 'hub:analyze':      return reply(await analyze(msg.body))
      case 'hub:evidence':     return reply(await saveOptimization({ ...msg.body, evidence: msg.prints.map((p: { name: string; dataUrl: string }) => ({ name: p.name, content_base64: pngBase64(p.dataUrl) })).filter((e: { content_base64: string | null }) => e.content_base64) }))
    }
  })()
  return true
})
```

---

## 5. Checklist de aceite (o que o painel deve mostrar)

- [ ] Após login na extensão Cardápio Web, em **Extensões** o card "Orvia · Otimizador Cardápio Web" fica **verde** (contato < 10 min) e o do iFood não muda.
- [ ] A chave aparece como `Extensão Cardápio Web · e-mail · Chrome · xxxxxxxx`.
- [ ] Uma otimização enviada aparece na aba **Cardápio Web** do relatório, com prints que abrem e baixam (individual e "Baixar todos").
- [ ] Cliente que vende nos dois canais **não** é duplicado (cada canal tem sua trava de loja).
- [ ] Derrubar a internet ao enviar → relatório entra na fila e chega sozinho em ≤ 1 min após voltar.
