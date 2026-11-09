// ============================================================================
// api_clients_ensure.mjs — Teste HTTP de POST /api/v1/clients/ensure
// LOCAL apenas: hub rodando contra o Supabase local (`npx supabase start`).
//   HUB_URL=http://localhost:3100 LOCAL_API_URL=... LOCAL_SERVICE_ROLE_KEY=... node supabase/tests/api_clients_ensure.mjs
// Cria chaves/clientes descartáveis no banco local e os apaga ao final.
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

const WS_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const TAG = `ensure-${randomBytes(4).toString('hex')}`
const results = []
const check = (name, cond, detail = '') => {
  results.push({ name, pass: Boolean(cond) })
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  → ${detail}` : ''}`)
}

async function rest(path, init = {}) {
  const res = await fetch(`${SB}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(init.headers ?? {}) },
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}

const keys = []
async function makeKey(workspaceId, scopes) {
  const key = `ck_live_${randomBytes(32).toString('base64url')}`
  const r = await rest('api_keys', {
    method: 'POST',
    body: JSON.stringify({ workspace_id: workspaceId, name: 'teste ensure', key_hash: createHash('sha256').update(key).digest('hex'), key_prefix: key.slice(0, 12), scopes }),
  })
  keys.push(r.body[0].id)
  return key
}

async function ensure(key, body, method = 'POST') {
  const headers = { 'Content-Type': 'application/json' }
  if (key) headers['X-API-Key'] = key
  const res = await fetch(`${HUB}/api/v1/clients/ensure`, { method, headers, body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined })
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { /* 405 sem corpo */ }
  return { status: res.status, json }
}

let wsB = null
try {
  // workspace B (isolamento)
  const wb = await rest('workspaces', { method: 'POST', body: JSON.stringify({ name: `B ${TAG}`, slug: `b-${TAG}` }) })
  wsB = wb.body[0].id

  const keyW = await makeKey(WS_A, ['clientes:ler', 'catalogo:ler', 'catalogo:escrever'])
  const keyR = await makeKey(WS_A, ['clientes:ler', 'catalogo:ler'])
  const keyB = await makeKey(wsB, ['catalogo:escrever'])

  check('GET → 405 (rota existe, método errado)', (await ensure(null, null, 'GET')).status === 405)
  check('POST sem chave → 401', (await ensure(null, { name: 'x' })).status === 401)
  check('POST sem catalogo:escrever → 403', (await ensure(keyR, { name: 'x' })).status === 403)
  check('POST sem name → 422', (await ensure(keyW, {})).status === 422)

  const name = `Loja Teste ${TAG}`
  const r1 = await ensure(keyW, { name, ifood_merchant_id: `m-${TAG}` })
  check('cria cliente → 201 created=true', r1.status === 201 && r1.json?.data?.created === true && r1.json.data.id, JSON.stringify(r1.json))
  const id = r1.json?.data?.id

  const r2 = await ensure(keyW, { name: 'outro nome qualquer', ifood_merchant_id: `m-${TAG}` })
  check('acha por ifood_merchant_id → 200 created=false mesmo id', r2.status === 200 && r2.json?.data?.created === false && r2.json.data.id === id)

  const r3 = await ensure(keyW, { name: name.toUpperCase() })
  check('acha por nome sem diferenciar maiúsculas', r3.status === 200 && r3.json?.data?.id === id && r3.json.data.created === false)

  const r4 = await ensure(keyW, { name, ifood_merchant_id: `outra-${TAG}` })
  check('mesmo nome, OUTRA loja do iFood → cria cliente novo', r4.status === 201 && r4.json?.data?.id !== id)

  const r5 = await ensure(keyW, { name: `Loja_% ${TAG}` })
  check('curingas (%/_) no nome não casam com outro cliente', r5.status === 201)

  const r6 = await ensure(keyB, { name, ifood_merchant_id: `m-${TAG}` })
  check('workspace B não enxerga cliente do A (cria o seu)', r6.status === 201 && r6.json?.data?.id !== id)
  const own = await rest(`clients?id=eq.${r6.json?.data?.id}&select=workspace_id`)
  check('cliente criado no workspace da chave', own.body?.[0]?.workspace_id === wsB)

  const aud = await rest(`audit_log?entity_id=eq.${id}&action=eq.client.created_by_extension&select=actor_type,metadata`)
  check('audit_log registrado sem segredo', aud.body?.length === 1 && !JSON.stringify(aud.body).includes('ck_live_'))
} finally {
  await rest(`clients?name=like.*${TAG}*`, { method: 'DELETE' })
  for (const k of keys) await rest(`api_keys?id=eq.${k}`, { method: 'DELETE' })
  if (wsB) await rest(`workspaces?id=eq.${wsB}`, { method: 'DELETE' })
}

const failed = results.filter((r) => !r.pass).length
console.log(`\n${results.length - failed}/${results.length} passaram`)
process.exit(failed ? 1 : 0)
