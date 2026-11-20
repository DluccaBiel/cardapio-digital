// ============================================================================
// worker_sdr.mjs — Teste do módulo SDR do robô (apps/whatsapp-worker/src/sdr.mjs)
// contra o Supabase LOCAL, com um WhatsApp SIMULADO (nenhuma mensagem real sai).
//   LOCAL_API_URL=... LOCAL_SERVICE_ROLE_KEY=... node supabase/tests/worker_sdr.mjs
// Cria dados descartáveis no workspace demo e apaga tudo ao final.
// ============================================================================
import { createClient } from '@supabase/supabase-js'
import { createSdr } from '../../apps/whatsapp-worker/src/sdr.mjs'

const SB = process.env.LOCAL_API_URL
const SR = process.env.LOCAL_SERVICE_ROLE_KEY
if (!/^http:\/\/(localhost|127\.0\.0\.1)/.test(SB ?? '') || !SR) {
  console.error('Somente Supabase LOCAL (LOCAL_API_URL / LOCAL_SERVICE_ROLE_KEY).')
  process.exit(2)
}
const db = createClient(SB, SR, { auth: { persistSession: false } })
const WS = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const results = []
const check = (name, cond, detail = '') => {
  results.push(Boolean(cond))
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  → ${detail}` : ''}`)
}

// ---- WhatsApp simulado ---------------------------------------------------------
const NO_WA = '5519900000003'
const sent = []
let seq = 0
const sock = {
  onWhatsApp: async (n) => [{ exists: n !== NO_WA && n !== NO_WA.slice(0, 4) + NO_WA.slice(5), jid: `${n}@s.whatsapp.net` }],
  presenceSubscribe: async () => {},
  sendPresenceUpdate: async () => {},
  sendMessage: async (jid, { text }) => {
    const id = `ROBOT${++seq}`
    sent.push({ jid, text, id })
    return { key: { id } }
  },
}
const resolveJid = async (phone) => {
  const [r] = await sock.onWhatsApp(phone)
  return r?.exists ? r.jid : null
}
const pace = { nextAt: 0 }
const logs = []
const sdr = createSdr({ db, WS, log: (...a) => logs.push(a.join(' ')), getSock: () => sock, isReady: () => true, resolveJid, pace, onInboundForAi: null })
const settle = async (n = 1) => {
  for (let i = 0; i < n; i++) {
    pace.nextAt = 0 // o teste não espera o intervalo real entre envios
    await sdr.tick()
    await new Promise((r) => setTimeout(r, 4100)) // respiro mínimo entre envios do robô
  }
}
const lead = async (id) => (await db.from('prospect_leads').select('*').eq('id', id).single()).data

const createdLeads = []
let cadenceId = null
try {
  // ---- Preparação -------------------------------------------------------------------
  await db.from('sdr_settings').delete().eq('workspace_id', WS)
  const { data: cad } = await db
    .from('sdr_cadences')
    .insert({ workspace_id: WS, name: 'Teste 1º contato', stage: 'novo', steps: [{ wait_hours: 0, body: 'Olá, {nome}!' }, { wait_hours: 24, body: 'Follow {nome}' }] })
    .select('id')
    .single()
  cadenceId = cad.id
  await db.from('sdr_settings').insert({
    workspace_id: WS,
    outreach_days: [0, 1, 2, 3, 4, 5, 6],
    outreach_start: '00:00',
    outreach_end: '23:59',
    daily_new_contacts: 2,
    first_contact_cadence_id: cadenceId,
  })
  const phones = ['5519900000001', '5519900000002', NO_WA]
  for (const [i, phone] of phones.entries()) {
    const { data } = await db.from('prospect_leads').insert({ workspace_id: WS, name: `Lead SDR ${i + 1}`, phone, source: 'manual', status: 'novo', stage: 'novo' }).select('id').single()
    createdLeads.push(data.id)
    await db.from('sdr_enrollments').insert({ workspace_id: WS, lead_id: data.id, cadence_id: cadenceId, step_index: 0, next_run_at: new Date(Date.now() - 1000 * (10 - i)).toISOString() })
  }
  const [L1, L2, L3] = createdLeads

  // ---- 1) Cadência → tarefas, respeitando o limite diário de novos contatos ---------------
  await settle(4)
  const { data: tasks1 } = await db.from('sdr_tasks').select('lead_id, kind, status, body').in('lead_id', createdLeads)
  check('limite diário: só 2 primeiros contatos viram tarefa (3º fica para amanhã)', tasks1.filter((t) => t.kind === 'first_contact').length === 2, JSON.stringify(tasks1))
  check('primeiros contatos enviados pelo robô com {nome}', sent.some((m) => m.text === 'Olá, Lead SDR 1!') && sent.some((m) => m.text === 'Olá, Lead SDR 2!'), JSON.stringify(sent))
  const l1 = await lead(L1)
  check('após o envio: lead vai para "contatado" e last_outbound_at preenchido', l1.stage === 'contatado' && l1.status === 'contatado' && !!l1.last_outbound_at)
  const { data: e1 } = await db.from('sdr_enrollments').select('step_index, next_run_at, status').eq('lead_id', L1).single()
  const hours = (Date.parse(e1.next_run_at) - Date.now()) / 3_600_000
  check('cadência avança para o passo 2, agendado ~24 h depois do envio', e1.step_index === 1 && e1.status === 'ativa' && hours > 23.5 && hours < 24.5, JSON.stringify(e1))
  const { data: m1 } = await db.from('sdr_messages').select('direction, sent_by, body').eq('lead_id', L1)
  check('histórico registra a mensagem enviada (cadência)', m1.length === 1 && m1[0].direction === 'out' && m1[0].sent_by === 'cadence')

  // ---- 2) Lead responde → para a cadência ---------------------------------------------------
  await sdr.handleUpsert({ type: 'notify', messages: [{ key: { remoteJid: `${l1.phone}@s.whatsapp.net`, id: 'IN1', fromMe: false }, message: { conversation: 'Oi, quero saber mais' } }] })
  const l1b = await lead(L1)
  const { data: e1b } = await db.from('sdr_enrollments').select('status, stop_reason').eq('lead_id', L1).single()
  check('resposta do lead: etapa "respondeu", cadência parada', l1b.stage === 'respondeu' && e1b.status === 'parada' && /respondeu/.test(e1b.stop_reason), JSON.stringify({ stage: l1b.stage, e1b }))
  const { count: inCount } = await db.from('sdr_messages').select('id', { count: 'exact', head: true }).eq('lead_id', L1).eq('direction', 'in')
  check('mensagem recebida entra no histórico', inCount === 1)
  await sdr.handleUpsert({ type: 'notify', messages: [{ key: { remoteJid: `${l1.phone}@s.whatsapp.net`, id: 'IN1', fromMe: false }, message: { conversation: 'Oi, quero saber mais' } }] })
  const { count: inCount2 } = await db.from('sdr_messages').select('id', { count: 'exact', head: true }).eq('lead_id', L1).eq('direction', 'in')
  check('mesma mensagem 2× não duplica (id do WhatsApp)', inCount2 === 1)

  // ---- 3) Você responde pelo celular → IA pausa no lead ---------------------------------------
  await sdr.handleUpsert({ type: 'append', messages: [{ key: { remoteJid: `${l1.phone}@s.whatsapp.net`, id: 'ME1', fromMe: true }, message: { conversation: 'Claro! Te ligo já.' } }] })
  const l1c = await lead(L1)
  check('mensagem sua (fora do robô) = histórico "human" + IA pausada', l1c.ai_paused === true)
  const robotEcho = sent[0].id
  await sdr.handleUpsert({ type: 'append', messages: [{ key: { remoteJid: sent[0].jid, id: robotEcho, fromMe: true }, message: { conversation: sent[0].text } }] })
  const { count: outCount } = await db.from('sdr_messages').select('id', { count: 'exact', head: true }).eq('wa_message_id', robotEcho)
  check('eco da mensagem que o próprio robô mandou não duplica', outCount === 1)

  // ---- 4) Grupos e desconhecidos ignorados -------------------------------------------------------
  const before = (await db.from('sdr_messages').select('id', { count: 'exact', head: true }).eq('workspace_id', WS)).count
  await sdr.handleUpsert({ type: 'notify', messages: [
    { key: { remoteJid: '120363000000000000@g.us', id: 'G1', fromMe: false, participant: `${l1.phone}@s.whatsapp.net` }, message: { conversation: 'msg no grupo' } },
    { key: { remoteJid: '5511977776666@s.whatsapp.net', id: 'X1', fromMe: false }, message: { conversation: 'oi, sou contato pessoal' } },
  ] })
  const after = (await db.from('sdr_messages').select('id', { count: 'exact', head: true }).eq('workspace_id', WS)).count
  check('grupos e contatos que não são leads não entram no SDR', before === after)

  // ---- 5) Opt-out ---------------------------------------------------------------------------------
  const l2 = await lead(L2)
  await db.from('sdr_tasks').insert({ workspace_id: WS, lead_id: L2, kind: 'follow_up', body: 'x', status: 'pendente', scheduled_at: new Date(Date.now() + 3_600_000).toISOString() })
  await sdr.handleUpsert({ type: 'notify', messages: [{ key: { remoteJid: `${l2.phone}@s.whatsapp.net`, id: 'IN2', fromMe: false }, message: { conversation: 'SAIR' } }] })
  const l2b = await lead(L2)
  const { data: t2 } = await db.from('sdr_tasks').select('status').eq('lead_id', L2).eq('kind', 'follow_up')
  check('"SAIR": opt-out, cadência parada e envios futuros cancelados', l2b.status === 'opt_out' && t2.every((t) => t.status === 'cancelada'))

  // ---- 6) Janela fechada: follow-up espera; resposta sai na hora ------------------------------------
  const nowSp = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date())
  const closedStart = nowSp >= '12:00' ? '00:00' : '13:00'
  const closedEnd = nowSp >= '12:00' ? '00:30' : '13:30'
  const outside = !(nowSp >= closedStart && nowSp < closedEnd)
  await db.from('sdr_settings').update({ outreach_start: closedStart, outreach_end: closedEnd }).eq('workspace_id', WS)
  await new Promise((r) => setTimeout(r, 100))
  const sdr2 = createSdr({ db, WS, log: () => {}, getSock: () => sock, isReady: () => true, resolveJid, pace, onInboundForAi: null })
  await db.from('prospect_leads').update({ status: 'respondeu', ai_paused: false }).eq('id', L1)
  const { data: fu } = await db.from('sdr_tasks').insert({ workspace_id: WS, lead_id: L1, kind: 'follow_up', body: 'follow fora da janela', respects_window: true }).select('id').single()
  const { data: rp } = await db.from('sdr_tasks').insert({ workspace_id: WS, lead_id: L1, kind: 'manual', body: 'resposta 24h', respects_window: false }).select('id').single()
  pace.nextAt = 0
  await sdr2.tick()
  await new Promise((r) => setTimeout(r, 4100))
  pace.nextAt = 0
  await sdr2.tick()
  const { data: fuS } = await db.from('sdr_tasks').select('status').eq('id', fu.id).single()
  const { data: rpS } = await db.from('sdr_tasks').select('status').eq('id', rp.id).single()
  check('fora da janela: resposta sai (24h) e follow-up fica esperando', outside && rpS.status === 'enviada' && fuS.status === 'pendente', JSON.stringify({ nowSp, fuS, rpS }))
  await db.from('sdr_tasks').update({ status: 'cancelada' }).eq('id', fu.id)

  // ---- 7) Número sem WhatsApp --------------------------------------------------------------------------
  await db.from('sdr_settings').update({ outreach_start: '00:00', outreach_end: '23:59', daily_new_contacts: 10 }).eq('workspace_id', WS)
  const sdr3 = createSdr({ db, WS, log: () => {}, getSock: () => sock, isReady: () => true, resolveJid, pace, onInboundForAi: null })
  pace.nextAt = 0
  await sdr3.tick()
  await new Promise((r) => setTimeout(r, 4100))
  pace.nextAt = 0
  await sdr3.tick()
  const l3 = await lead(L3)
  const { data: t3 } = await db.from('sdr_tasks').select('status, error').eq('lead_id', L3)
  check('número sem WhatsApp: tarefa falha, lead "invalido", cadência parada', l3.status === 'invalido' && t3.some((t) => t.status === 'falhou' && /sem WhatsApp/.test(t.error)), JSON.stringify({ st: l3.status, t3 }))

  // ---- 8) Prospecção contínua: confere número e inscreve no 1º contato ---------------------------------
  await db.from('prospect_searches').delete().eq('workspace_id', WS).is('created_by', null)
  await db.from('sdr_settings').update({ prospect_enabled: true, prospect_cities: [{ city: 'Valinhos', uf: 'SP' }, { city: 'Campinas', uf: 'SP' }] }).eq('workspace_id', WS)
  const sdrP = createSdr({ db, WS, log: () => {}, getSock: () => sock, isReady: () => false, resolveJid, pace, onInboundForAi: null })
  await sdrP.tick()
  const { data: auto } = await db.from('prospect_searches').select('id, city, uf, status').eq('workspace_id', WS).is('created_by', null)
  check('prospecção contínua: sem pesquisa recente, o robô agenda a próxima cidade do rodízio', auto.length === 1 && auto[0].status === 'pendente', JSON.stringify(auto))
  await db.from('prospect_searches').update({ status: 'concluida' }).eq('id', auto[0].id)
  const sdrP2 = createSdr({ db, WS, log: () => {}, getSock: () => sock, isReady: () => false, resolveJid, pace, onInboundForAi: null })
  await sdrP2.tick()
  const { count: autoCount } = await db.from('prospect_searches').select('id', { count: 'exact', head: true }).eq('workspace_id', WS).is('created_by', null)
  check('prospecção contínua: não repete antes do intervalo configurado', autoCount === 1)
  await db.from('prospect_searches').delete().eq('id', auto[0].id)

  const { data: search } = await db.from('prospect_searches').insert({ workspace_id: WS, city: 'Campinas', uf: 'SP', status: 'concluida' }).select('id').single()
  const { data: pl } = await db.from('prospect_leads').insert({ workspace_id: WS, name: 'Lead prospectado', phone: '5519900000004', source: 'osm', search_id: search.id }).select('id').single()
  createdLeads.push(pl.id)
  const sdr4 = createSdr({ db, WS, log: () => {}, getSock: () => sock, isReady: () => true, resolveJid, pace, onInboundForAi: null })
  await sdr4.tick()
  const pl2 = await lead(pl.id)
  const { data: plE } = await db.from('sdr_enrollments').select('status').eq('lead_id', pl.id)
  check('prospecção: número conferido (tem WhatsApp) e lead inscrito no 1º contato', pl2.wa_exists === true && !!pl2.wa_checked_at && plE.some((e) => e.status === 'ativa'), JSON.stringify({ pl2: { wa: pl2.wa_exists }, plE }))
  await db.from('prospect_searches').delete().eq('workspace_id', WS).is('created_by', null)
} finally {
  for (const id of createdLeads) await db.from('prospect_leads').delete().eq('id', id)
  if (cadenceId) await db.from('sdr_cadences').delete().eq('id', cadenceId)
  await db.from('sdr_settings').delete().eq('workspace_id', WS)
  const passed = results.filter(Boolean).length
  console.log(`\n${passed}/${results.length} PASS`)
  process.exit(passed === results.length ? 0 : 1)
}
