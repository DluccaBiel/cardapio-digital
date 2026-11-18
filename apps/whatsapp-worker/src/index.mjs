// Robô de disparos WhatsApp (conexão NÃO oficial por QR, via Baileys) — roda no SEU computador.
//
// Fala só com o Supabase (saída HTTPS): lê o pedido de conexão e as campanhas, escreve o
// status (QR, vinculado, sincronização) e o resultado de cada envio. Nada fica exposto na
// internet. A sessão do WhatsApp fica em ./auth (gitignored) — apagar a pasta = desvincular.
//
// Variáveis (arquivo .env desta pasta, NUNCA commitado — ver .env.example):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, UNDERCUT_WORKSPACE (slug; opcional se houver 1 workspace)

import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as Baileys from '@whiskeysockets/baileys'
import { createClient } from '@supabase/supabase-js'
import pino from 'pino'
import QRCode from 'qrcode'
import { brVariants, canSendNow, isOptOut, nextDelayMs, renderMessage, spDayStartIso } from './schedule.mjs'
// Agente de prospecção compartilhado com o painel (TypeScript lido direto pelo Node ≥ 22.18).
import { normalizeBrPhone, searchFoodBusinesses } from '../../../lib/sdr/providers/osm.ts'

const makeWASocket = Baileys.makeWASocket ?? Baileys.default?.default ?? Baileys.default
const { useMultiFileAuthState, DisconnectReason, Browsers, fetchLatestBaileysVersion } = Baileys

const HERE = path.dirname(fileURLToPath(import.meta.url))
const log = (...a) => console.log(new Date().toLocaleTimeString('pt-BR'), '·', ...a)

// Tenta carregar variáveis de .env do worker, .env.local ou .env da raiz
function tryLoadEnv() {
  const candidates = [
    path.join(HERE, '..', '.env'),
    path.join(HERE, '..', '..', '..', '.env.local'),
    path.join(HERE, '..', '..', '..', '.env'),
  ]
  for (const f of candidates) {
    if (existsSync(f)) {
      try {
        if (typeof process.loadEnvFile === 'function') {
          process.loadEnvFile(f)
        } else {
          const content = readFileSync(f, 'utf8')
          for (const line of content.split('\n')) {
            const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)?\s*$/)
            if (m && !m[1].startsWith('#')) {
              const k = m[1]
              let v = (m[2] || '').trim()
              if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
                v = v.slice(1, -1)
              }
              if (!process.env[k]) process.env[k] = v
            }
          }
        }
      } catch {}
    }
  }
}
tryLoadEnv()

// Um robô por pasta/computador: dois processos disputariam a sessão do WhatsApp e
// poderiam enviar a mesma mensagem duas vezes. (Checado antes de qualquer rede.)
const LOCK = path.join(HERE, '..', 'auth', 'worker.lock')
function acquireLock() {
  mkdirSync(path.dirname(LOCK), { recursive: true })
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(LOCK, 'wx')
      writeSync(fd, String(process.pid))
      closeSync(fd)
      return
    } catch {
      const pid = Number(readFileSync(LOCK, 'utf8')) || 0
      let alive = false
      try {
        if (pid) {
          process.kill(pid, 0)
          alive = true
        }
      } catch {
        alive = false
      }
      if (alive) {
        console.error(`Já existe um robô rodando neste computador (processo ${pid}). Feche a outra janela antes de abrir de novo.`)
        process.exit(1)
      }
      unlinkSync(LOCK) // trava velha (robô fechado à força) — remove e tenta de novo
    }
  }
}
acquireLock()
const releaseLock = () => {
  try {
    if (Number(readFileSync(LOCK, 'utf8')) === process.pid) unlinkSync(LOCK)
  } catch {
    // já removida
  }
}
process.on('exit', releaseLock)

const url = process.env.SUPABASE_URL?.trim()
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
if (!url || !key) {
  console.error('Faltam SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no arquivo apps/whatsapp-worker/.env (veja .env.example).')
  process.exit(1)
}
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------
async function resolveWorkspace() {
  const slug = process.env.UNDERCUT_WORKSPACE?.trim()
  const q = db.from('workspaces').select('id, slug, name')
  const { data, error } = slug ? await q.eq('slug', slug) : await q
  if (error) throw new Error(`Supabase recusou a leitura (${error.code ?? error.message}). Confira a URL/chave e se a migration foi aplicada.`)
  if (!data || data.length === 0) throw new Error(slug ? `Workspace "${slug}" não encontrado.` : 'Nenhum workspace no banco.')
  if (data.length > 1 && !slug) {
    log(`Há ${data.length} workspaces — usando "${data[0].slug}" (${data[0].name}). Defina UNDERCUT_WORKSPACE no .env para selecionar outro.`)
  }
  return data[0]
}

const ws = await resolveWorkspace().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
const WS = ws.id
const AUTH_DIR = path.join(HERE, '..', 'auth', WS)
log(`Workspace: ${ws.name ?? ws.slug}`)


await db.from('whatsapp_sessions').upsert({ workspace_id: WS }, { onConflict: 'workspace_id', ignoreDuplicates: true })

async function setStatus(patch) {
  const { error } = await db.from('whatsapp_sessions').update(patch).eq('workspace_id', WS)
  if (error) log('falha ao gravar status:', error.code ?? error.message)
}

// ---------------------------------------------------------------------------
// Conexão
// ---------------------------------------------------------------------------
let sock = null
let starting = false
let status = 'disconnected'
let syncedChats = 0
let readyTimer = null
let lastSyncWrite = 0

function markReady() {
  if (status === 'ready') return
  status = 'ready'
  clearTimeout(readyTimer)
  setStatus({ status: 'ready', sync_progress: 100, sync_detail: syncedChats ? `${syncedChats} conversas sincronizadas` : 'Sincronizado', last_error: null })
  log('WhatsApp pronto para enviar.')
}

async function start() {
  if (sock || starting) return
  starting = true
  try {
    status = 'starting'
    await setStatus({ status: 'starting', last_error: null })
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR)
    const latest = await fetchLatestBaileysVersion().catch(() => null)
    sock = makeWASocket({
      auth: state,
      version: latest?.version,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      browser: Browsers.windows('Desktop'),
      markOnlineOnConnect: false,
      syncFullHistory: false,
    })
    const current = sock
    current.ev.on('creds.update', saveCreds)

    current.ev.on('connection.update', async (u) => {
      if (u.qr) {
        status = 'qr'
        const dataUrl = await QRCode.toDataURL(u.qr, { margin: 1, width: 300 })
        await setStatus({ status: 'qr', qr_data_url: dataUrl, qr_updated_at: new Date().toISOString() })
        try {
          const termQr = await QRCode.toString(u.qr, { type: 'terminal', small: true })
          console.log('\n================ QR CODE WHATSAPP ================')
          console.log(termQr)
          console.log('==================================================\n')
        } catch {}
        log('QR code novo gerado! Escaneie acima no terminal ou no painel (Disparos).')
      }
      if (u.connection === 'connecting' && status === 'qr') {
        status = 'connecting'
        await setStatus({ status: 'connecting' })
      }
      if (u.connection === 'open') {
        const id = current.user?.id ?? ''
        const phone = id.split(':')[0].split('@')[0] || null
        status = 'syncing'
        syncedChats = 0
        await setStatus({
          status: 'syncing',
          qr_data_url: null,
          phone,
          display_name: current.user?.name ?? current.user?.verifiedName ?? null,
          connected_at: new Date().toISOString(),
          sync_progress: 0,
          sync_detail: 'Vinculado — sincronizando conversas…',
          last_error: null,
        })
        log(`Vinculado (${phone}). Sincronizando…`)
        clearTimeout(readyTimer)
        readyTimer = setTimeout(markReady, 90_000) // fallback se o WhatsApp não avisar o fim
      }
      if (u.receivedPendingNotifications) markReady()
      if (u.connection === 'close') {
        const code = u.lastDisconnect?.error?.output?.statusCode
        if (sock === current) sock = null
        clearTimeout(readyTimer)
        if (code === DisconnectReason.loggedOut) {
          status = 'logged_out'
          await rm(AUTH_DIR, { recursive: true, force: true })
          await setStatus({ status: 'logged_out', desired_state: 'disconnected', qr_data_url: null, phone: null, display_name: null, sync_progress: null, sync_detail: null, last_error: 'Desvinculado pelo celular.' })
          log('Desvinculado pelo celular.')
        } else if (code === DisconnectReason.timedOut && status === 'qr') {
          status = 'disconnected'
          await setStatus({ status: 'disconnected', desired_state: 'disconnected', qr_data_url: null, last_error: 'O QR code expirou. Clique em conectar de novo.' })
          log('QR expirou sem leitura.')
        } else {
          status = 'connecting'
          await setStatus({ status: 'connecting', sync_detail: 'Reconectando…' })
          log(`Conexão caiu (código ${code ?? '?'}) — reconectando…`)
        }
      }
    })

    current.ev.on('messaging-history.set', ({ chats, progress, isLatest }) => {
      syncedChats += chats?.length ?? 0
      if (status === 'ready') return
      const now = Date.now()
      if (now - lastSyncWrite > 2000) {
        lastSyncWrite = now
        setStatus({ sync_progress: typeof progress === 'number' ? Math.min(99, Math.round(progress)) : null, sync_detail: `${syncedChats} conversas sincronizadas…` })
      }
      if (isLatest || progress === 100) markReady()
    })

    current.ev.on('messages.upsert', (ev) => handleIncoming(ev).catch((e) => log('erro ao ler mensagem:', e.message)))
  } catch (e) {
    sock = null
    status = 'error'
    await setStatus({ status: 'error', last_error: String(e.message ?? e).slice(0, 200) })
    log('Falha ao iniciar:', e.message)
  } finally {
    starting = false
  }
}

async function stop() {
  const s = sock
  sock = null
  clearTimeout(readyTimer)
  if (s) {
    await s.logout().catch(() => {})
    s.end?.(undefined)
  }
  await rm(AUTH_DIR, { recursive: true, force: true })
  status = 'disconnected'
  await setStatus({ status: 'disconnected', qr_data_url: null, phone: null, display_name: null, sync_progress: null, sync_detail: null })
  log('Desconectado a pedido do painel.')
}

// ---------------------------------------------------------------------------
// Respostas: opt-out (LGPD) e "respondeu"
// ---------------------------------------------------------------------------
async function findLead(phone) {
  const { data } = await db.from('prospect_leads').select('id, status').eq('workspace_id', WS).in('phone', brVariants(phone)).limit(1)
  return data?.[0] ?? null
}

async function handleIncoming({ messages, type }) {
  if (type !== 'notify') return
  for (const m of messages) {
    const jid = m.key?.remoteJid ?? ''
    if (m.key?.fromMe || !jid.endsWith('@s.whatsapp.net')) continue
    const text = m.message?.conversation ?? m.message?.extendedTextMessage?.text ?? ''
    const lead = await findLead(jid.split('@')[0])
    if (!lead) continue
    if (isOptOut(text)) {
      await db.from('prospect_leads').update({ status: 'opt_out' }).eq('workspace_id', WS).eq('id', lead.id)
      await db.from('broadcast_recipients').update({ status: 'ignorado', error: 'pediu para sair' }).eq('workspace_id', WS).eq('lead_id', lead.id).eq('status', 'pendente')
      await sock?.sendMessage(jid, { text: 'Pronto! Você não receberá mais mensagens nossas. 👍' }).catch(() => {})
      log('Opt-out registrado.')
    } else if (lead.status === 'na_fila' || lead.status === 'contatado') {
      await db.from('prospect_leads').update({ status: 'respondeu' }).eq('workspace_id', WS).eq('id', lead.id)
    }
  }
}

// ---------------------------------------------------------------------------
// Envio agendado (1 mensagem por vez, intervalo aleatório, limite diário do número)
// ---------------------------------------------------------------------------
let nextGlobalAt = 0
let consecutiveErrors = 0
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function resolveJid(phone) {
  for (const v of brVariants(phone)) {
    const [r] = (await sock.onWhatsApp(v).catch(() => [])) ?? []
    if (r?.exists) return r.jid
  }
  return null
}

async function sendTick() {
  if (!sock || status !== 'ready' || Date.now() < nextGlobalAt) return
  const now = new Date()
  const { data: campaigns } = await db
    .from('broadcast_campaigns')
    .select('*')
    .eq('workspace_id', WS)
    .in('status', ['agendada', 'enviando'])
    .order('created_at')
  for (const c of campaigns ?? []) {
    if (!canSendNow(c, now)) continue

    const { count: sentToday } = await db
      .from('broadcast_recipients')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', WS)
      .eq('status', 'enviado')
      .gte('sent_at', spDayStartIso(now))
    if ((sentToday ?? 0) >= c.daily_limit) continue

    const { data: queue } = await db
      .from('broadcast_recipients')
      .select('id, lead_id, name, phone')
      .eq('campaign_id', c.id)
      .eq('status', 'pendente')
      .order('created_at')
      .limit(1)
    const rec = queue?.[0]
    if (!rec) {
      await db.from('broadcast_campaigns').update({ status: 'concluida', next_send_at: null }).eq('id', c.id)
      log(`Disparo "${c.name}" concluído.`)
      continue
    }
    if (c.status === 'agendada') await db.from('broadcast_campaigns').update({ status: 'enviando' }).eq('id', c.id)

    const delay = nextDelayMs(c.interval_min_seconds, c.interval_max_seconds)
    const nextAt = new Date(Date.now() + delay).toISOString()
    try {
      const jid = await resolveJid(rec.phone)
      if (!jid) {
        await db.from('broadcast_recipients').update({ status: 'falhou', error: 'número sem WhatsApp' }).eq('id', rec.id)
        await db.from('broadcast_campaigns').update({ failed_count: c.failed_count + 1 }).eq('id', c.id)
        if (rec.lead_id) await db.from('prospect_leads').update({ status: 'invalido' }).eq('id', rec.lead_id)
        nextGlobalAt = Date.now() + 5000
        return
      }
      await sock.presenceSubscribe(jid).catch(() => {})
      await sock.sendPresenceUpdate('composing', jid).catch(() => {})
      await sleep(2000 + Math.random() * 3000) // "digitando…"
      await sock.sendPresenceUpdate('paused', jid).catch(() => {})
      await sock.sendMessage(jid, { text: renderMessage(c.message, rec.name) })

      const sentAt = new Date().toISOString()
      await db.from('broadcast_recipients').update({ status: 'enviado', sent_at: sentAt, error: null }).eq('id', rec.id)
      await db.from('broadcast_campaigns').update({ sent_count: c.sent_count + 1, next_send_at: nextAt, last_error: null }).eq('id', c.id)
      if (rec.lead_id) await db.from('prospect_leads').update({ status: 'contatado', last_contacted_at: sentAt }).eq('id', rec.lead_id).in('status', ['novo', 'na_fila'])
      consecutiveErrors = 0
      log(`Enviado (${c.sent_count + 1}/${c.total}) — próximo em ${Math.round(delay / 1000)} s.`)
    } catch (e) {
      consecutiveErrors += 1
      const msg = String(e?.message ?? e).slice(0, 200)
      await db.from('broadcast_recipients').update({ status: 'falhou', error: msg }).eq('id', rec.id)
      const pause = consecutiveErrors >= 5
      await db
        .from('broadcast_campaigns')
        .update({ failed_count: c.failed_count + 1, next_send_at: nextAt, last_error: msg, ...(pause ? { status: 'pausada' } : {}) })
        .eq('id', c.id)
      log(`Falha no envio: ${msg}${pause ? ' — disparo PAUSADO após 5 falhas seguidas.' : ''}`)
      if (pause) consecutiveErrors = 0
    }
    nextGlobalAt = Date.now() + delay
    return // 1 envio por ciclo
  }
}

// ---------------------------------------------------------------------------
// Pesquisas do agente de prospecção (fila prospect_searches)
// ---------------------------------------------------------------------------
let searching = false

// Pesquisa que ficou "buscando" há mais de 15 min (robô fechado no meio) volta para a fila.
await db
  .from('prospect_searches')
  .update({ status: 'pendente', detail: null })
  .eq('workspace_id', WS)
  .eq('status', 'buscando')
  .lt('started_at', new Date(Date.now() - 15 * 60_000).toISOString())

async function searchTick() {
  if (searching) return
  const { data } = await db
    .from('prospect_searches')
    .select('id, city, uf, niche')
    .eq('workspace_id', WS)
    .eq('status', 'pendente')
    .order('created_at')
    .limit(1)
  const job = data?.[0]
  if (!job) return
  // Reserva atômica: só segue se ESTE robô mudou pendente → buscando.
  const { data: claimed } = await db
    .from('prospect_searches')
    .update({ status: 'buscando', started_at: new Date().toISOString(), detail: 'Localizando a cidade…' })
    .eq('id', job.id)
    .eq('status', 'pendente')
    .select('id')
  if (!claimed?.length) return
  searching = true
  runSearch(job)
    .catch((e) => log('erro na pesquisa:', e.message))
    .finally(() => {
      searching = false
    })
}

async function runSearch(job) {
  const upd = (patch) => db.from('prospect_searches').update(patch).eq('id', job.id)
  log(`Pesquisando empresas food em ${job.city}${job.uf ? `/${job.uf}` : ''}…`)
  try {
    const r = await searchFoodBusinesses(job.city, job.uf ?? undefined, {
      onProgress: (detail) => {
        upd({ detail }).then(() => {})
      },
    })
    await upd({ detail: `${r.leads.length} empresas encontradas — separando as novas…`, label: r.label })

    // Quem já é cliente da assessoria não entra como lead.
    const { data: clients } = await db.from('clients').select('phone, whatsapp').eq('workspace_id', WS)
    const known = new Set()
    for (const c of clients ?? []) for (const p of [c.phone, c.whatsapp]) {
      const n = normalizeBrPhone(p)
      if (n) known.add(n)
    }
    const candidates = r.leads.filter((l) => !known.has(l.phone))

    let created = 0
    for (let i = 0; i < candidates.length; i += 200) {
      const { data, error } = await db
        .from('prospect_leads')
        .upsert(
          candidates.slice(i, i + 200).map((l) => ({
            workspace_id: WS,
            source: 'osm',
            external_id: l.external_id,
            name: l.name,
            phone: l.phone,
            niche: 'food',
            category: l.category,
            city: job.city,
            uf: job.uf,
            address: l.address,
            website: l.website,
            search_id: job.id,
          })),
          { onConflict: 'workspace_id,phone', ignoreDuplicates: true },
        )
        .select('id')
      if (error) throw new Error(`não consegui salvar os leads (${error.code ?? error.message})`)
      created += data?.length ?? 0
    }
    await upd({ status: 'concluida', found: r.leads.length, created_count: created, label: r.label, detail: null, finished_at: new Date().toISOString() })
    log(`Pesquisa concluída (${r.source}): ${r.leads.length} encontradas, ${created} novas.`)
  } catch (e) {
    await upd({ status: 'erro', detail: String(e.message ?? e).slice(0, 300), finished_at: new Date().toISOString() })
    log('Pesquisa falhou:', e.message)
  }
}

// ---------------------------------------------------------------------------
// Laço principal
// ---------------------------------------------------------------------------
let busy = false
async function loop() {
  if (busy) return
  busy = true
  try {
    const { data } = await db.from('whatsapp_sessions').select('desired_state').eq('workspace_id', WS).maybeSingle()
    await setStatus({ worker_seen_at: new Date().toISOString() })
    if (data?.desired_state === 'connected' && !sock) await start()
    else if (data?.desired_state === 'disconnected' && (sock || status !== 'disconnected')) {
      if (status !== 'logged_out' || sock) await stop()
    }
    await searchTick()
    await sendTick()
  } catch (e) {
    log('erro no ciclo:', e.message)
  } finally {
    busy = false
  }
}

// Bate ponto inicial imediatamente
await setStatus({ worker_seen_at: new Date().toISOString() })

// Se o usuário iniciou o robô pelo terminal, inicia a conexão do WhatsApp automaticamente
const { data: initSession } = await db.from('whatsapp_sessions').select('desired_state').eq('workspace_id', WS).maybeSingle()
if (initSession?.desired_state !== 'connected') {
  log('Iniciando conexão com WhatsApp...')
  await setStatus({ desired_state: 'connected' })
}
start().catch((e) => log('erro ao iniciar conexão:', e.message))

setInterval(loop, 4000)
loop()
log('Robô de disparos rodando. Deixe esta janela aberta (Ctrl+C para parar).')

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    log('Encerrando… (a sessão continua salva; ao abrir de novo reconecta sem QR)')
    sock?.end?.(undefined)
    process.exit(0)
  })
}
