// Ponte robô → IA do Undercut. A IA roda no servidor (chave da Anthropic e Google Agenda ficam
// na Vercel); o robô só avisa "este lead escreveu" e depois envia a resposta que cair na fila.
//
// Autenticação: ao ligar, o robô cria a PRÓPRIA chave de API (escopos sdr:ler/sdr:escrever,
// 30 dias), revoga as chaves antigas do robô e guarda a nova só em memória (nunca em disco).

import { createHash, randomBytes } from 'node:crypto'
import os from 'node:os'

const NAME_PREFIX = 'Robô local (SDR)'
const DEBOUNCE_MS = 20_000 // lead costuma mandar várias mensagens seguidas
const SWEEP_MS = 2 * 60_000
const RETRY_MS = 5 * 60_000

export async function createAiBridge({ db, WS, log, hubUrl }) {
  const base = String(hubUrl || 'https://undercuthub.vercel.app').replace(/\/+$/, '')
  if (!/^https:\/\/[a-z0-9.-]+$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)) throw new Error(`HUB_URL inválida: ${base}`)

  const { data: ext } = await db.from('extensions').select('id').eq('slug', 'undercut-sdr').maybeSingle()
  if (!ext) {
    log('IA: extensão undercut-sdr não registrada no banco (migration do SDR pendente) — respostas da IA desligadas.')
    return { onInbound: async () => {}, tick: async () => {} }
  }
  await db.from('api_keys').update({ revoked_at: new Date().toISOString() }).eq('workspace_id', WS).like('name', `${NAME_PREFIX}%`).is('revoked_at', null)
  const key = `ck_live_${randomBytes(32).toString('base64url')}`
  const { error } = await db.from('api_keys').insert({
    workspace_id: WS,
    extension_id: ext.id,
    name: `${NAME_PREFIX} · ${os.hostname().slice(0, 40)}`,
    key_hash: createHash('sha256').update(key, 'utf8').digest('hex'),
    key_prefix: key.slice(0, 12),
    scopes: ['sdr:ler', 'sdr:escrever'],
    rate_limit_per_minute: 120,
    expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
  })
  if (error) {
    log('IA: não consegui criar a chave do robô —', error.code ?? error.message)
    return { onInbound: async () => {}, tick: async () => {} }
  }

  const timers = new Map()
  const lastAsked = new Map()
  let lastSweep = 0

  async function aiEnabled() {
    const { data } = await db.from('sdr_settings').select('ai_enabled').eq('workspace_id', WS).maybeSingle()
    return Boolean(data?.ai_enabled)
  }

  async function ask(leadId) {
    lastAsked.set(leadId, Date.now())
    try {
      const res = await fetch(`${base}/api/v1/sdr/ai/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': key },
        body: JSON.stringify({ lead_id: leadId }),
        signal: AbortSignal.timeout(130_000),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) log(`IA: o Undercut respondeu ${res.status} — ${json?.error?.message ?? ''}`)
      else if (json?.data?.action === 'reply') log('IA: resposta na fila.')
      else if (json?.data?.action === 'handoff') log(`IA: passou para você (${json.data.reason}).`)
    } catch (e) {
      log('IA: sem conexão com o Undercut —', e.message)
    }
  }

  /** Lead escreveu: espera ele terminar de digitar e pede a resposta. */
  async function onInbound(lead) {
    if (lead.ai_paused) return
    clearTimeout(timers.get(lead.id))
    timers.set(
      lead.id,
      setTimeout(async () => {
        timers.delete(lead.id)
        if (await aiEnabled()) await ask(lead.id)
      }, DEBOUNCE_MS),
    )
  }

  /** Varredura: leads que escreveram e ficaram sem resposta (robô reiniciou, falha de rede…). */
  async function tick() {
    if (Date.now() - lastSweep < SWEEP_MS) return
    lastSweep = Date.now()
    if (!(await aiEnabled())) return
    const since = new Date(Date.now() - 24 * 3_600_000).toISOString()
    const { data } = await db
      .from('prospect_leads')
      .select('id, last_inbound_at, last_outbound_at')
      .eq('workspace_id', WS)
      .eq('ai_paused', false)
      .eq('needs_human', false)
      .not('status', 'in', '(opt_out,invalido)')
      .gte('last_inbound_at', since)
      .limit(50)
    for (const l of data ?? []) {
      const unanswered = !l.last_outbound_at || Date.parse(l.last_inbound_at) > Date.parse(l.last_outbound_at)
      if (!unanswered || timers.has(l.id)) continue
      if (Date.now() - (lastAsked.get(l.id) ?? 0) < RETRY_MS) continue
      if (Date.now() - Date.parse(l.last_inbound_at) < DEBOUNCE_MS) continue
      await ask(l.id)
    }
  }

  log(`IA: conectada ao Undercut (${base}).`)
  return { onInbound, tick }
}
