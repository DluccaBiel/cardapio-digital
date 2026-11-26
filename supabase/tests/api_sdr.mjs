// ============================================================================
// api_sdr.mjs — Teste HTTP de ponta a ponta da API do SDR no WhatsApp (/api/v1/sdr)
// LOCAL apenas: hub rodando contra o Supabase local (`npx supabase start`).
//   HUB_URL=http://localhost:3100 LOCAL_API_URL=... LOCAL_SERVICE_ROLE_KEY=... node supabase/tests/api_sdr.mjs
// Cria usuário/chaves/leads descartáveis no banco local e apaga tudo ao final.
// Nunca aponte para produção: o script recusa URLs que não sejam localhost/127.0.0.1.
// ============================================================================
import { createHash, randomBytes } from 'node:crypto'

const HUB = process.env.HUB_URL ?? 'http://localhost:3100'
const SB = process.env.LOCAL_API_URL
const SR = process.env.LOCAL_SERVICE_ROLE_KEY
for (const [n, v] of [['HUB_URL', HUB], ['LOCAL_API_URL', SB]]) {
  if (!v || !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(v)) {
    console.error(`${n} precisa ser local (http://localhost / 127.0.0.1). Abortando.`)
    process.exit(2)
  }
}
if (!SR) {
  console.error('LOCAL_SERVICE_ROLE_KEY ausente.')
  process.exit(2)
}

const WS = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const results = []
const check = (name, cond, detail = '') => {
  results.push({ name, pass: Boolean(cond), detail })
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  → ${detail}` : ''}`)
}
const H = { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json' }
async function rest(path, init = {}) {
  const res = await fetch(`${SB}/rest/v1/${path}`, { ...init, headers: { ...H, Prefer: 'return=representation', ...(init.headers ?? {}) } })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}
async function api(path, { key, method = 'GET', body, etag } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (key) headers['X-API-Key'] = key
  if (etag) headers['If-Match'] = etag
  const res = await fetch(`${HUB}/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = { raw: text.slice(0, 200) }
  }
  return { status: res.status, etag: res.headers.get('etag'), json }
}

const PHONE_NEW = `5519${String(Date.now()).slice(-9).replace(/^./, '9')}` // celular aleatório (55 19 9xxxxxxxx)
const created = { leads: [], keys: [], user: null }

try {
  // --- 1) Login pela extensão SDR → chave com escopos sdr:* -------------------------
  const email = `sdr-api-${Date.now()}@undercut-demo.example`
  const password = randomBytes(18).toString('base64url')
  const user = await (await fetch(`${SB}/auth/v1/admin/users`, { method: 'POST', headers: H, body: JSON.stringify({ email, password, email_confirm: true }) })).json()
  created.user = user.id
  await rest('members', { method: 'POST', body: JSON.stringify({ workspace_id: WS, user_id: user.id, role: 'editor' }) })
  const login = await api('/extension-auth/login', { method: 'POST', body: { email, password, workspace_slug: 'undercut-demo', device_id: 'sdrtest-0001', extension: 'undercut-sdr' } })
  const KEY = login.json?.data?.key
  check('login da extensão SDR devolve chave', login.status === 200 && /^ck_live_/.test(KEY ?? ''), JSON.stringify(login.json).slice(0, 200))
  const me = await api('/me', { key: KEY })
  check('GET /me: extensão undercut-sdr com escopos sdr:ler + sdr:escrever (só)', me.json?.data?.extension === 'undercut-sdr' && JSON.stringify(me.json?.data?.scopes?.sort()) === JSON.stringify(['sdr:escrever', 'sdr:ler']), JSON.stringify(me.json?.data))

  // Chave de outra extensão (iFood) não acessa o SDR
  const ifood = (await rest('extensions?slug=eq.undercut-ifood&select=id')).body[0].id
  const otherKey = `ck_live_${randomBytes(32).toString('base64url')}`
  const ok2 = await rest('api_keys', { method: 'POST', body: JSON.stringify({ workspace_id: WS, extension_id: ifood, name: 'teste api_sdr (ifood)', key_hash: createHash('sha256').update(otherKey).digest('hex'), key_prefix: otherKey.slice(0, 12), scopes: ['clientes:ler', 'catalogo:ler'] }) })
  created.keys.push(ok2.body[0].id)
  const forb = await api(`/sdr/leads/by-phone?phone=${PHONE_NEW}`, { key: otherKey })
  check('chave sem escopo sdr:ler → 403', forb.status === 403)
  check('sem chave → 401', (await api(`/sdr/inbox`)).status === 401)

  // --- 2) Número que não é lead -------------------------------------------------------
  const none = await api(`/sdr/leads/by-phone?phone=${PHONE_NEW}`, { key: KEY })
  check('by-phone de número desconhecido → lead: null', none.status === 200 && none.json?.data?.lead === null, JSON.stringify(none.json))
  check('by-phone com telefone inválido → 400', (await api('/sdr/leads/by-phone?phone=12', { key: KEY })).status === 400)

  // --- 3) Criar lead a partir da conversa ----------------------------------------------
  const c = await api('/sdr/leads', { key: KEY, method: 'POST', body: { name: 'Pizzaria Teste SDR', phone: `+${PHONE_NEW}` } })
  const view = c.json?.data
  if (view?.lead?.id) created.leads.push(view.lead.id)
  check('POST /sdr/leads → 201 com etapa "novo"', c.status === 201 && view?.lead?.stage === 'novo', JSON.stringify(c.json).slice(0, 300))
  check('padrões criados: cadência "Primeiro contato" (passo 1/4) e respostas rápidas', view?.cadence?.name === 'Primeiro contato' && view?.cadence?.step === 1 && view?.cadence?.total === 4 && view?.quick_replies?.length > 0)
  check('resposta rápida já vem com {nome} preenchido', view?.quick_replies?.some((q) => q.preview.includes('Pizzaria Teste SDR')))
  check('atalhos # e etapas no payload', view?.commands?.['#reuniao'] === 'reuniao' && view?.stages?.length === 8)
  const dup = await api('/sdr/leads', { key: KEY, method: 'POST', body: { name: 'Outra', phone: PHONE_NEW } })
  check('mesmo número de novo → 409 (com lead_id)', dup.status === 409 && dup.json?.error?.details?.lead_id === view?.lead?.id)
  const found = await api(`/sdr/leads/by-phone?phone=${PHONE_NEW.slice(0, 4)}${PHONE_NEW.slice(5)}`, { key: KEY })
  check('by-phone acha o lead mesmo sem o 9º dígito', found.json?.data?.lead?.id === view?.lead?.id)

  const LEAD = view.lead.id
  let etag = view.lead.etag

  // --- 4) PATCH com If-Match ------------------------------------------------------------
  check('PATCH sem If-Match → 428', (await api(`/sdr/leads/${LEAD}`, { key: KEY, method: 'PATCH', body: { stage: 'respondeu' } })).status === 428)
  check('PATCH com ETag velho → 409', (await api(`/sdr/leads/${LEAD}`, { key: KEY, method: 'PATCH', body: { stage: 'respondeu' }, etag: '"2000-01-01T00:00:00+00:00"' })).status === 409)
  const p1 = await api(`/sdr/leads/${LEAD}`, { key: KEY, method: 'PATCH', body: { stage: 'respondeu', deal_value: 1500 }, etag })
  check('PATCH etapa → "respondeu" e valor previsto', p1.status === 200 && p1.json?.data?.lead?.stage === 'respondeu' && p1.json?.data?.lead?.deal_value === 1500, JSON.stringify(p1.json).slice(0, 200))
  check('mudar de etapa PARA a cadência anterior (respondeu não tem cadência)', p1.json?.data?.cadence === null)
  const enr = await rest(`sdr_enrollments?lead_id=eq.${LEAD}&select=status,stop_reason`)
  check('inscrição antiga ficou "parada" com motivo', enr.body.some((e) => e.status === 'parada' && /etapa/.test(e.stop_reason ?? '')))
  etag = p1.json.data.lead.etag
  const p2 = await api(`/sdr/leads/${LEAD}`, { key: KEY, method: 'PATCH', body: { stage: 'proposta' }, etag })
  check('etapa "proposta" inscreve na cadência "Proposta enviada"', p2.json?.data?.cadence?.name === 'Proposta enviada')
  etag = p2.json.data.lead.etag
  check('PATCH com etapa inválida → 422', (await api(`/sdr/leads/${LEAD}`, { key: KEY, method: 'PATCH', body: { stage: 'xyz' }, etag })).status === 422)

  // --- 5) Notas e lembretes ---------------------------------------------------------------
  const n1 = await api(`/sdr/leads/${LEAD}/notes`, { key: KEY, method: 'POST', body: { body: 'Ligar para o dono', remind_at: new Date(Date.now() - 60_000).toISOString() } })
  check('POST nota com lembrete → 201', n1.status === 201 && n1.json?.data?.id)
  const inbox1 = await api('/sdr/inbox', { key: KEY })
  check('inbox mostra o lembrete vencido', inbox1.json?.data?.reminders?.some((r) => r.id === n1.json?.data?.id))
  const nd = await api(`/sdr/notes/${n1.json.data.id}`, { key: KEY, method: 'PATCH', body: { done: true }, etag: n1.etag })
  check('PATCH nota concluída (If-Match)', nd.status === 200 && nd.json?.data?.done === true)
  check('PATCH nota sem If-Match → 428', (await api(`/sdr/notes/${n1.json.data.id}`, { key: KEY, method: 'PATCH', body: { done: false } })).status === 428)

  // --- 6) Fila do robô: envio manual, aprovação da IA ----------------------------------------
  const s1 = await api(`/sdr/leads/${LEAD}/send`, { key: KEY, method: 'POST', body: { body: 'Oi {nome}, tudo certo?' } })
  check('POST send → tarefa manual "pendente", sem esperar janela, {nome} preenchido', s1.status === 201 && s1.json?.data?.status === 'pendente' && s1.json?.data?.body === 'Oi Pizzaria Teste SDR, tudo certo?')
  const cancel = await api(`/sdr/tasks/${s1.json.data.id}`, { key: KEY, method: 'PATCH', body: { action: 'cancel' }, etag: s1.etag })
  check('cancelar envio pendente (If-Match)', cancel.status === 200 && cancel.json?.data?.status === 'cancelada')

  const ai = await rest('sdr_tasks', { method: 'POST', body: JSON.stringify({ workspace_id: WS, lead_id: LEAD, kind: 'ai_reply', body: 'Sugestão da IA', status: 'aguardando_aprovacao', respects_window: false }) })
  const aiTask = ai.body[0]
  const inbox2 = await api('/sdr/inbox', { key: KEY })
  const pending = inbox2.json?.data?.awaiting_approval?.find((t) => t.id === aiTask.id)
  check('inbox lista resposta da IA aguardando aprovação', !!pending)
  const ap = await api(`/sdr/tasks/${aiTask.id}`, { key: KEY, method: 'PATCH', body: { action: 'approve', body: 'Sugestão corrigida' }, etag: pending?.etag })
  check('aprovar com texto editado → "pendente"', ap.status === 200 && ap.json?.data?.status === 'pendente' && ap.json?.data?.body === 'Sugestão corrigida')
  const again = await api(`/sdr/tasks/${aiTask.id}`, { key: KEY, method: 'PATCH', body: { action: 'approve' }, etag: ap.etag })
  check('aprovar de novo → 409 (já não aguarda aprovação)', again.status === 409)

  // --- 7) Opt-out e isolamento ----------------------------------------------------------------
  const v3 = await api(`/sdr/leads/${LEAD}`, { key: KEY })
  const oo = await api(`/sdr/leads/${LEAD}`, { key: KEY, method: 'PATCH', body: { opt_out: true }, etag: v3.json.data.lead.etag })
  check('opt-out marca o lead e para a cadência', oo.json?.data?.lead?.status === 'opt_out' && oo.json?.data?.cadence === null)
  check('opt-out: envio manual recusado (422)', (await api(`/sdr/leads/${LEAD}/send`, { key: KEY, method: 'POST', body: { body: 'oi' } })).status === 422)

  const otherWs = await rest('workspaces', { method: 'POST', body: JSON.stringify({ name: 'WS SDR outro', slug: `sdr-outro-${Date.now()}`, plan: 'free' }) })
  const foreign = await rest('prospect_leads', { method: 'POST', body: JSON.stringify({ workspace_id: otherWs.body[0].id, name: 'Lead de outro WS', phone: '5519988887777', source: 'manual' }) })
  check('lead de outro workspace → 404', (await api(`/sdr/leads/${foreign.body[0].id}`, { key: KEY })).status === 404)
  await rest(`workspaces?id=eq.${otherWs.body[0].id}`, { method: 'DELETE' })

  const audit = await rest(`audit_log?workspace_id=eq.${WS}&action=like.sdr_*&select=action,metadata`)
  check('audit_log registra as ações do SDR (sem textos de mensagem)', audit.body.length >= 4 && !JSON.stringify(audit.body).includes('tudo certo'))
} finally {
  for (const id of created.leads) await rest(`prospect_leads?id=eq.${id}`, { method: 'DELETE' })
  for (const id of created.keys) await rest(`api_keys?id=eq.${id}`, { method: 'DELETE' })
  if (created.user) {
    await rest(`api_keys?created_by=eq.${created.user}`, { method: 'DELETE' })
    await rest(`members?user_id=eq.${created.user}`, { method: 'DELETE' })
    await fetch(`${SB}/auth/v1/admin/users/${created.user}`, { method: 'DELETE', headers: H })
  }
  await rest(`sdr_settings?workspace_id=eq.${WS}`, { method: 'DELETE' })
  await rest(`sdr_cadences?workspace_id=eq.${WS}`, { method: 'DELETE' })
  await rest(`sdr_quick_replies?workspace_id=eq.${WS}`, { method: 'DELETE' })
  const passed = results.filter((r) => r.pass).length
  console.log(`\n${passed}/${results.length} PASS`)
  process.exit(passed === results.length ? 0 : 1)
}
