// SDR no WhatsApp — parte do robô local (executa o que o menu SDR/extensão decidem).
//
//   inbound   mensagem de um LEAD → histórico, para a cadência ("respondeu"), opt-out, gatilho da IA
//   echo      mensagem que VOCÊ mandou pelo celular/WhatsApp Web para um lead → histórico + IA pausa
//   cadência  passos vencidos viram tarefas (só dentro da janela de envio)
//   fila      envia sdr_tasks: respostas a qualquer hora; o que NÓS iniciamos só na janela,
//             com intervalo aleatório e limite diário de novos contatos
//   prospecção contínua: pesquisa cidades em rodízio, confere o WhatsApp e inscreve no 1º contato
//
// Só fala com números que são leads do SDR. Grupos, status e contatos pessoais são ignorados.

import { advanceCadence, brVariants, inOutreachWindow, isOptOut, messageText, nextDelayMs, renderMessage, spDayStartIso, typingMs } from './schedule.mjs'

const REPLY_GAP_MS = 4000 // respiro mínimo entre duas respostas
const PROSPECT_CHECK_MS = 10 * 60_000
const NUMBER_CHECKS_PER_TICK = 3

export function createSdr({ db, WS, log, getSock, isReady, resolveJid, pace, onInboundForAi }) {
  let settings = null
  let settingsAt = 0
  let lastReplyAt = 0
  let lastProspectCheck = 0
  const sentByRobot = new Set() // ids de mensagens que o robô enviou (para não confundir com "você mandou")

  async function getSettings() {
    if (settings && Date.now() - settingsAt < 60_000) return settings
    const { data } = await db.from('sdr_settings').select('*').eq('workspace_id', WS).maybeSingle()
    settings = data
    settingsAt = Date.now()
    return settings
  }

  async function findLead(phone) {
    const { data } = await db
      .from('prospect_leads')
      .select('id, name, phone, status, stage, ai_paused')
      .eq('workspace_id', WS)
      .in('phone', brVariants(phone))
      .limit(1)
    return data?.[0] ?? null
  }

  /** Para a cadência ativa e cancela os envios dela que ainda não saíram. */
  async function stopEnrollment(leadId, reason) {
    const { data: stopped } = await db
      .from('sdr_enrollments')
      .update({ status: 'parada', stop_reason: reason.slice(0, 120), next_run_at: null })
      .eq('workspace_id', WS)
      .eq('lead_id', leadId)
      .eq('status', 'ativa')
      .select('id')
    const ids = (stopped ?? []).map((e) => e.id)
    if (ids.length) {
      await db
        .from('sdr_tasks')
        .update({ status: 'cancelada', error: `cadência parada: ${reason}`.slice(0, 200) })
        .eq('workspace_id', WS)
        .in('enrollment_id', ids)
        .in('status', ['pendente', 'aguardando_aprovacao'])
    }
  }

  async function enrollFirstContact(leadId) {
    const s = await getSettings()
    let q = db.from('sdr_cadences').select('id, steps').eq('workspace_id', WS).eq('active', true)
    q = s?.first_contact_cadence_id ? q.eq('id', s.first_contact_cadence_id) : q.eq('stage', 'novo').order('created_at').limit(1)
    const { data } = await q.maybeSingle()
    if (!data || !Array.isArray(data.steps) || !data.steps.length) return false
    const wait = Math.max(0, Number(data.steps[0]?.wait_hours) || 0)
    const { error } = await db.from('sdr_enrollments').insert({
      workspace_id: WS,
      lead_id: leadId,
      cadence_id: data.id,
      step_index: 0,
      next_run_at: new Date(Date.now() + wait * 3_600_000).toISOString(),
    })
    return !error
  }

  // -------------------------------------------------------------------------
  // Mensagens recebidas / enviadas por você
  // -------------------------------------------------------------------------
  async function handleUpsert({ messages, type }) {
    for (const m of messages ?? []) {
      const jid = m.key?.remoteJid ?? ''
      if (!jid.endsWith('@s.whatsapp.net')) continue // grupos, status, broadcast: nunca
      const waId = m.key?.id ?? null
      const text = messageText(m.message).trim()
      if (!text) continue
      const lead = await findLead(jid.split('@')[0])
      if (!lead) continue // só leads do SDR

      if (m.key?.fromMe) {
        if (waId && sentByRobot.has(waId)) continue // já registrada no envio
        // Você respondeu pelo celular/WhatsApp Web: registra e a IA sai de cena neste lead.
        const { error } = await db.from('sdr_messages').upsert(
          { workspace_id: WS, lead_id: lead.id, direction: 'out', body: text.slice(0, 4000), sent_by: 'human', wa_message_id: waId },
          { onConflict: 'workspace_id,wa_message_id', ignoreDuplicates: true },
        )
        if (!error) {
          await db.from('prospect_leads').update({ last_outbound_at: new Date().toISOString(), ai_paused: true, needs_human: false }).eq('id', lead.id)
          await stopEnrollment(lead.id, 'você assumiu a conversa')
        }
        continue
      }
      if (type !== 'notify') continue

      await db.from('sdr_messages').upsert(
        { workspace_id: WS, lead_id: lead.id, direction: 'in', body: text.slice(0, 4000), sent_by: 'lead', wa_message_id: waId },
        { onConflict: 'workspace_id,wa_message_id', ignoreDuplicates: true },
      )

      if (isOptOut(text)) {
        await db.from('prospect_leads').update({ status: 'opt_out', needs_human: false, last_inbound_at: new Date().toISOString() }).eq('id', lead.id)
        await stopEnrollment(lead.id, 'opt-out')
        await db.from('sdr_tasks').update({ status: 'cancelada', error: 'opt-out' }).eq('workspace_id', WS).eq('lead_id', lead.id).in('status', ['pendente', 'aguardando_aprovacao'])
        continue // a confirmação de saída já é enviada pelo tratamento dos Disparos
      }

      const patch = { last_inbound_at: new Date().toISOString() }
      if (['novo', 'na_fila', 'contatado'].includes(lead.status)) patch.status = 'respondeu'
      if (['novo', 'contatado'].includes(lead.stage)) patch.stage = 'respondeu'
      await db.from('prospect_leads').update(patch).eq('id', lead.id)
      await stopEnrollment(lead.id, 'lead respondeu')
      log(`SDR: ${lead.name} respondeu.`)
      if (onInboundForAi) onInboundForAi(lead).catch((e) => log('IA: falhou ao pedir resposta:', e.message))
    }
  }

  // -------------------------------------------------------------------------
  // Cadências → tarefas
  // -------------------------------------------------------------------------
  async function cadenceTick() {
    const s = await getSettings()
    if (!s) return
    const nowIso = new Date().toISOString()
    const { data: due } = await db
      .from('sdr_enrollments')
      .select('id, lead_id, step_index, cadence_id, sdr_cadences ( stage, steps, active ), prospect_leads ( name, status, stage, wa_exists )')
      .eq('workspace_id', WS)
      .eq('status', 'ativa')
      .lte('next_run_at', nowIso)
      .order('next_run_at')
      .limit(20)
    if (!due?.length) return

    // Quantos 1º contatos ainda cabem hoje (enviados + na fila)
    const [{ count: sentToday }, { count: queued }] = await Promise.all([
      db.from('sdr_tasks').select('id', { count: 'exact', head: true }).eq('workspace_id', WS).eq('kind', 'first_contact').eq('status', 'enviada').gte('sent_at', spDayStartIso()),
      db.from('sdr_tasks').select('id', { count: 'exact', head: true }).eq('workspace_id', WS).eq('kind', 'first_contact').in('status', ['pendente', 'enviando']),
    ])
    let firstRoom = Math.max(0, s.daily_new_contacts - (sentToday ?? 0) - (queued ?? 0))

    for (const e of due) {
      const cad = Array.isArray(e.sdr_cadences) ? e.sdr_cadences[0] : e.sdr_cadences
      const lead = Array.isArray(e.prospect_leads) ? e.prospect_leads[0] : e.prospect_leads
      if (!cad?.active || !lead || ['opt_out', 'invalido'].includes(lead.status) || lead.wa_exists === false || ['cliente', 'perdido'].includes(lead.stage)) {
        await db.from('sdr_enrollments').update({ status: 'parada', stop_reason: 'lead/cadência indisponível', next_run_at: null }).eq('id', e.id)
        continue
      }
      const steps = Array.isArray(cad.steps) ? cad.steps : []
      const step = steps[e.step_index]
      if (!step) {
        await db.from('sdr_enrollments').update({ status: 'concluida', next_run_at: null }).eq('id', e.id)
        continue
      }
      const kind = cad.stage === 'novo' && e.step_index === 0 ? 'first_contact' : 'follow_up'
      if (kind === 'first_contact') {
        if (firstRoom <= 0) continue // limite do dia: fica para amanhã
        firstRoom -= 1
      }
      const { error } = await db.from('sdr_tasks').insert({
        workspace_id: WS,
        lead_id: e.lead_id,
        kind,
        body: renderMessage(step.body, lead.name).slice(0, 4000),
        respects_window: true,
        enrollment_id: e.id,
      })
      if (!error) await db.from('sdr_enrollments').update({ next_run_at: null }).eq('id', e.id) // aguarda o envio
    }
  }

  // -------------------------------------------------------------------------
  // Fila de envio
  // -------------------------------------------------------------------------
  async function claimNext(windowOpen) {
    const nowIso = new Date().toISOString()
    // 1) Respostas (a qualquer hora)
    let { data } = await db
      .from('sdr_tasks')
      .select('id, lead_id, kind, body, enrollment_id, respects_window')
      .eq('workspace_id', WS)
      .eq('status', 'pendente')
      .eq('respects_window', false)
      .lte('scheduled_at', nowIso)
      .order('scheduled_at')
      .limit(1)
    let task = data?.[0]
    if (!task && windowOpen && Date.now() >= pace.nextAt) {
      ;({ data } = await db
        .from('sdr_tasks')
        .select('id, lead_id, kind, body, enrollment_id, respects_window')
        .eq('workspace_id', WS)
        .eq('status', 'pendente')
        .eq('respects_window', true)
        .lte('scheduled_at', nowIso)
        .order('scheduled_at')
        .limit(1))
      task = data?.[0]
    }
    if (!task) return null
    const { data: claimed } = await db.from('sdr_tasks').update({ status: 'enviando', attempts: 1 }).eq('id', task.id).eq('status', 'pendente').select('id')
    return claimed?.length ? task : null
  }

  async function sendTick() {
    const sock = getSock()
    if (!sock || !isReady()) return
    if (Date.now() - lastReplyAt < REPLY_GAP_MS) return
    const s = await getSettings()
    if (!s) return
    const windowOpen = inOutreachWindow(s)
    const task = await claimNext(windowOpen)
    if (!task) return

    const { data: lead } = await db.from('prospect_leads').select('id, name, phone, status, stage').eq('id', task.lead_id).maybeSingle()
    const fail = async (msg, extra = {}) => {
      await db.from('sdr_tasks').update({ status: 'falhou', error: msg.slice(0, 200), ...extra }).eq('id', task.id)
    }
    if (!lead || lead.status === 'opt_out') return fail('lead indisponível ou opt-out')

    try {
      const jid = await resolveJid(lead.phone)
      if (!jid) {
        await fail('número sem WhatsApp')
        await db.from('prospect_leads').update({ status: 'invalido', wa_exists: false, wa_checked_at: new Date().toISOString() }).eq('id', lead.id)
        if (task.enrollment_id) await db.from('sdr_enrollments').update({ status: 'parada', stop_reason: 'sem WhatsApp', next_run_at: null }).eq('id', task.enrollment_id)
        return
      }
      await sock.presenceSubscribe(jid).catch(() => {})
      await sock.sendPresenceUpdate('composing', jid).catch(() => {})
      await new Promise((r) => setTimeout(r, typingMs(task.body)))
      await sock.sendPresenceUpdate('paused', jid).catch(() => {})
      const sent = await sock.sendMessage(jid, { text: task.body })
      const waId = sent?.key?.id ?? null
      if (waId) sentByRobot.add(waId)
      if (sentByRobot.size > 5000) sentByRobot.clear()

      const sentAt = new Date().toISOString()
      const by = task.kind === 'ai_reply' ? 'ai' : task.kind === 'manual' ? 'human' : task.kind === 'away' ? 'system' : 'cadence'
      await db.from('sdr_tasks').update({ status: 'enviada', sent_at: sentAt, error: null }).eq('id', task.id)
      await db.from('sdr_messages').upsert(
        { workspace_id: WS, lead_id: lead.id, direction: 'out', body: task.body, sent_by: by, wa_message_id: waId, task_id: task.id },
        { onConflict: 'workspace_id,wa_message_id', ignoreDuplicates: true },
      )
      const leadPatch = { last_outbound_at: sentAt, wa_exists: true }
      if (task.kind === 'first_contact') {
        if (['novo', 'na_fila'].includes(lead.status)) leadPatch.status = 'contatado'
        if (lead.stage === 'novo') leadPatch.stage = 'contatado'
      }
      await db.from('prospect_leads').update(leadPatch).eq('id', lead.id)

      if (task.enrollment_id) {
        const { data: enr } = await db.from('sdr_enrollments').select('id, step_index, status, sdr_cadences ( steps )').eq('id', task.enrollment_id).maybeSingle()
        if (enr?.status === 'ativa') {
          const cad = Array.isArray(enr.sdr_cadences) ? enr.sdr_cadences[0] : enr.sdr_cadences
          const adv = advanceCadence(cad?.steps ?? [], enr.step_index)
          await db
            .from('sdr_enrollments')
            .update(adv.done ? { status: 'concluida', step_index: adv.stepIndex, next_run_at: null } : { step_index: adv.stepIndex, next_run_at: adv.nextRunAt })
            .eq('id', enr.id)
        }
      }

      if (task.respects_window) pace.nextAt = Date.now() + nextDelayMs(s.interval_min_seconds, s.interval_max_seconds)
      lastReplyAt = Date.now()
      log(`SDR: enviado (${task.kind}) para ${lead.name}.`)
    } catch (e) {
      const msg = String(e?.message ?? e)
      await fail(msg)
      log('SDR: falha no envio:', msg)
    }
  }

  // -------------------------------------------------------------------------
  // Prospecção contínua + conferência de número
  // -------------------------------------------------------------------------
  async function prospectTick() {
    if (Date.now() - lastProspectCheck < PROSPECT_CHECK_MS) return
    lastProspectCheck = Date.now()
    const s = await getSettings()
    const cities = Array.isArray(s?.prospect_cities) ? s.prospect_cities.filter((c) => c?.city) : []
    if (!s?.prospect_enabled || !cities.length) return

    // Pesquisas do próprio robô (created_by nulo): no máx. 1 a cada prospect_every_hours
    const { data: recent } = await db
      .from('prospect_searches')
      .select('city, uf, status, created_at')
      .eq('workspace_id', WS)
      .is('created_by', null)
      .order('created_at', { ascending: false })
      .limit(200)
    if (recent?.some((r) => ['pendente', 'buscando'].includes(r.status))) return
    const last = recent?.[0]
    if (last && Date.now() - Date.parse(last.created_at) < s.prospect_every_hours * 3_600_000) return

    const key = (c) => `${String(c.city).trim().toLowerCase()}|${String(c.uf ?? '').toUpperCase()}`
    const lastByCity = new Map()
    for (const r of recent ?? []) if (!lastByCity.has(key(r))) lastByCity.set(key(r), Date.parse(r.created_at))
    const next = [...cities].sort((a, b) => (lastByCity.get(key(a)) ?? 0) - (lastByCity.get(key(b)) ?? 0))[0]
    await db.from('prospect_searches').insert({ workspace_id: WS, niche: 'food', city: String(next.city).slice(0, 80), uf: next.uf ? String(next.uf).toUpperCase().slice(0, 2) : null })
    log(`SDR: prospecção contínua → ${next.city}${next.uf ? `/${next.uf}` : ''}.`)
  }

  /** Leads novos das pesquisas do robô: confere se o número tem WhatsApp e inscreve no 1º contato. */
  async function numberCheckTick() {
    const sock = getSock()
    if (!sock || !isReady()) return
    const s = await getSettings()
    if (!s?.prospect_enabled) return
    const { data: searches } = await db
      .from('prospect_searches')
      .select('id')
      .eq('workspace_id', WS)
      .is('created_by', null)
      .eq('status', 'concluida')
      .gte('created_at', new Date(Date.now() - 30 * 86_400_000).toISOString())
    const ids = (searches ?? []).map((x) => x.id)
    if (!ids.length) return
    const { data: leads } = await db
      .from('prospect_leads')
      .select('id, phone')
      .eq('workspace_id', WS)
      .in('search_id', ids)
      .is('wa_checked_at', null)
      .eq('status', 'novo')
      .eq('stage', 'novo')
      .limit(NUMBER_CHECKS_PER_TICK)
    for (const l of leads ?? []) {
      const jid = await resolveJid(l.phone).catch(() => null)
      const checkedAt = new Date().toISOString()
      if (!jid) {
        await db.from('prospect_leads').update({ wa_exists: false, wa_checked_at: checkedAt, status: 'invalido' }).eq('id', l.id)
        continue
      }
      await db.from('prospect_leads').update({ wa_exists: true, wa_checked_at: checkedAt }).eq('id', l.id)
      await enrollFirstContact(l.id)
      await new Promise((r) => setTimeout(r, 1200)) // não martela a checagem
    }
  }

  async function tick() {
    try {
      await prospectTick()
      await numberCheckTick()
      await cadenceTick()
      await sendTick()
    } catch (e) {
      log('SDR: erro no ciclo:', e.message)
    }
  }

  return { handleUpsert, tick, getSettings }
}
