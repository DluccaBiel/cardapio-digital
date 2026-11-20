// ============================================================================
// api_sdr_ai.mjs — Rota POST /api/v1/sdr/ai/reply + ponte do robô (ai-bridge.mjs)
// LOCAL apenas, com um Claude SIMULADO em 127.0.0.1:4591 (o hub de teste usa
// ANTHROPIC_BASE_URL=http://127.0.0.1:4591). Nenhuma chamada paga é feita.
//   HUB_URL=http://localhost:3100 LOCAL_API_URL=... LOCAL_SERVICE_ROLE_KEY=... node supabase/tests/api_sdr_ai.mjs
// ============================================================================
import { createClient } from '@supabase/supabase-js'
import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { createAiBridge } from '../../apps/whatsapp-worker/src/ai-bridge.mjs'

const HUB = process.env.HUB_URL ?? 'http://localhost:3100'
const SB = process.env.LOCAL_API_URL
const SR = process.env.LOCAL_SERVICE_ROLE_KEY
if (!/^http:\/\/(localhost|127\.0\.0\.1)/.test(HUB) || !/^http:\/\/(localhost|127\.0\.0\.1)/.test(SB ?? '') || !SR) {
  console.error('Somente local (HUB_URL / LOCAL_API_URL / LOCAL_SERVICE_ROLE_KEY).')
  process.exit(2)
}
const db = createClient(SB, SR, { auth: { persistSession: false } })
const WS = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const results = []
const check = (name, cond, detail = '') => {
  results.push(Boolean(cond))
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  → ${detail}` : ''}`)
}

// --- Claude simulado ----------------------------------------------------------------
let claudeCalls = 0
const mock = createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    claudeCalls += 1
    const parsed = JSON.parse(body || '{}')
    const last = parsed.messages?.[parsed.messages.length - 1]?.content ?? ''
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        id: `msg_${claudeCalls}`,
        type: 'message',
        role: 'assistant',
        model: parsed.model,
        content: [{ type: 'text', text: `Resposta simulada para: ${String(typeof last === 'string' ? last : 'tool').slice(0, 40)}` }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 10 },
      }),
    )
  })
})
await new Promise((r) => mock.listen(4591, '127.0.0.1', r))

const ext = (await db.from('extensions').select('id').eq('slug', 'undercut-sdr').single()).data
const key = `ck_live_${randomBytes(32).toString('base64url')}`
const { data: keyRow } = await db
  .from('api_keys')
  .insert({ workspace_id: WS, extension_id: ext.id, name: 'teste api_sdr_ai', key_hash: createHash('sha256').update(key).digest('hex'), key_prefix: key.slice(0, 12), scopes: ['sdr:ler', 'sdr:escrever'] })
  .select('id')
  .single()
const post = async (body, k = key) => {
  const r = await fetch(`${HUB}/api/v1/sdr/ai/reply`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': k }, body: JSON.stringify(body) })
  return { status: r.status, json: await r.json().catch(() => null) }
}

let leadId = null
try {
  await db.from('sdr_settings').delete().eq('workspace_id', WS)
  await db.from('sdr_settings').insert({ workspace_id: WS, ai_enabled: true, ai_mode: 'auto', ai_reply_delay_seconds: 0 })
  const { data: lead } = await db.from('prospect_leads').insert({ workspace_id: WS, name: 'Hamburgueria IA', phone: '5519944443333', source: 'manual', status: 'respondeu', stage: 'respondeu' }).select('id').single()
  leadId = lead.id
  await db.from('sdr_messages').insert({ workspace_id: WS, lead_id: leadId, direction: 'in', body: 'Oi, quanto custa?', sent_by: 'lead', created_at: new Date(Date.now() - 5000).toISOString() })

  // 1) Modo automático → tarefa "pendente" (o robô envia)
  const r1 = await post({ lead_id: leadId })
  const { data: t1 } = await db.from('sdr_tasks').select('status, body, respects_window, kind').eq('lead_id', leadId)
  check('IA gera resposta e coloca na fila do robô (modo automático → pendente, 24h)', r1.status === 200 && r1.json?.data?.action === 'reply' && t1.length === 1 && t1[0].status === 'pendente' && t1[0].respects_window === false && /Resposta simulada/.test(t1[0].body), JSON.stringify({ r1, t1 }))

  // 2) Mesma mensagem de novo → não duplica
  const callsBefore = claudeCalls
  const r2 = await post({ lead_id: leadId })
  check('mesma mensagem do lead não gera 2ª resposta (nem chama o Claude)', r2.json?.data?.action === 'skip' && claudeCalls === callsBefore)

  // 3) Modo sugestão → aguarda aprovação
  await db.from('sdr_settings').update({ ai_mode: 'suggest' }).eq('workspace_id', WS)
  await db.from('sdr_tasks').update({ status: 'enviada' }).eq('lead_id', leadId)
  await db.from('sdr_messages').insert({ workspace_id: WS, lead_id: leadId, direction: 'out', body: 'resp', sent_by: 'ai', created_at: new Date(Date.now() - 3000).toISOString() })
  await db.from('sdr_messages').insert({ workspace_id: WS, lead_id: leadId, direction: 'in', body: 'E como funciona?', sent_by: 'lead', created_at: new Date(Date.now() - 1000).toISOString() })
  await post({ lead_id: leadId })
  const { data: t3 } = await db.from('sdr_tasks').select('status').eq('lead_id', leadId).eq('status', 'aguardando_aprovacao')
  check('modo sugestão → resposta "aguardando aprovação" no painel/extensão', t3.length === 1)

  // 4) IA desligada → nada
  await db.from('sdr_settings').update({ ai_enabled: false }).eq('workspace_id', WS)
  await db.from('sdr_messages').insert({ workspace_id: WS, lead_id: leadId, direction: 'in', body: 'alô?', sent_by: 'lead' })
  const r4 = await post({ lead_id: leadId })
  check('IA desligada → skip', r4.json?.data?.action === 'skip')

  // 5) Escopo: chave sem sdr:escrever → 403
  const roKey = `ck_live_${randomBytes(32).toString('base64url')}`
  const { data: roRow } = await db.from('api_keys').insert({ workspace_id: WS, extension_id: ext.id, name: 'teste ro', key_hash: createHash('sha256').update(roKey).digest('hex'), key_prefix: roKey.slice(0, 12), scopes: ['sdr:ler'] }).select('id').single()
  check('chave só de leitura → 403', (await post({ lead_id: leadId }, roKey)).status === 403)
  await db.from('api_keys').delete().eq('id', roRow.id)

  // 6) Ponte do robô: cria a própria chave, revoga a anterior e pede resposta na varredura
  await db.from('sdr_settings').update({ ai_enabled: true, ai_mode: 'auto' }).eq('workspace_id', WS)
  await db.from('sdr_tasks').delete().eq('lead_id', leadId)
  await db.from('sdr_messages').insert({ workspace_id: WS, lead_id: leadId, direction: 'in', body: 'Pode me ligar?', sent_by: 'lead', created_at: new Date(Date.now() - 60_000).toISOString() })
  await db.from('prospect_leads').update({ last_inbound_at: new Date(Date.now() - 60_000).toISOString(), last_outbound_at: new Date(Date.now() - 120_000).toISOString(), needs_human: false }).eq('id', leadId)
  const logs = []
  const b1 = await createAiBridge({ db, WS, log: (...a) => logs.push(a.join(' ')), hubUrl: HUB })
  const b2 = await createAiBridge({ db, WS, log: (...a) => logs.push(a.join(' ')), hubUrl: HUB })
  const { data: robotKeys } = await db.from('api_keys').select('revoked_at, scopes').eq('workspace_id', WS).like('name', 'Robô local (SDR)%')
  check('robô cria a própria chave (sdr:*) e revoga a anterior', robotKeys.length >= 2 && robotKeys.filter((k) => !k.revoked_at).length === 1 && robotKeys.every((k) => JSON.stringify(k.scopes) === '["sdr:ler","sdr:escrever"]'), JSON.stringify(robotKeys))
  await b2.tick()
  const { data: t6 } = await db.from('sdr_tasks').select('status, kind').eq('lead_id', leadId)
  check('varredura do robô: lead sem resposta → IA responde (tarefa na fila)', t6.some((t) => t.kind === 'ai_reply' && t.status === 'pendente'), JSON.stringify({ t6, logs }))
  void b1
  const old = await post({ lead_id: leadId }, 'ck_live_' + 'x'.repeat(43))
  check('chave inexistente → 401', old.status === 401)
} finally {
  mock.close()
  if (leadId) await db.from('prospect_leads').delete().eq('id', leadId)
  await db.from('api_keys').delete().eq('id', keyRow.id)
  await db.from('api_keys').delete().eq('workspace_id', WS).like('name', 'Robô local (SDR)%')
  await db.from('sdr_settings').delete().eq('workspace_id', WS)
  const passed = results.filter(Boolean).length
  console.log(`\n${passed}/${results.length} PASS`)
  process.exit(passed === results.length ? 0 : 1)
}
