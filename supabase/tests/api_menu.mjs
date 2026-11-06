// ============================================================================
// api_menu.mjs — Teste HTTP de ponta a ponta da API /api/v1 (cardápio + iFood)
// LOCAL apenas: hub rodando contra o Supabase local (`npx supabase start`).
//   HUB_URL=http://localhost:3100 LOCAL_API_URL=... LOCAL_SERVICE_ROLE_KEY=... node supabase/tests/api_menu.mjs
// Cria chaves descartáveis direto no banco local e as apaga ao final.
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
const CLIENT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2' // Hamburgueria Astro (Demo)
const COMBO = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee4'

const results = []
const check = (name, cond, detail = '') => {
  results.push({ name, pass: Boolean(cond), detail })
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

async function makeKey(scopes, extra = {}) {
  const key = `ck_live_${randomBytes(32).toString('base64url')}`
  const ext = await rest('extensions?slug=eq.orvia-ifood&select=id')
  const r = await rest('api_keys', {
    method: 'POST',
    body: JSON.stringify({
      workspace_id: WS,
      extension_id: ext.body[0].id,
      name: 'teste api_menu.mjs',
      key_hash: createHash('sha256').update(key).digest('hex'),
      key_prefix: key.slice(0, 12),
      scopes,
      ...extra,
    }),
  })
  return { key, id: r.body[0].id }
}

async function api(method, path, key, { body, ifMatch } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (key) headers['X-API-Key'] = key
  if (ifMatch) headers['If-Match'] = ifMatch
  const res = await fetch(`${HUB}/api/v1${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = { raw: text.slice(0, 200) }
  }
  return { status: res.status, etag: res.headers.get('etag'), json }
}

const created = []
try {
  const full = await makeKey(['clientes:ler', 'catalogo:ler', 'catalogo:escrever'])
  const readOnly = await makeKey(['catalogo:ler'])
  const revoked = await makeKey(['catalogo:ler'], { revoked_at: new Date().toISOString() })
  created.push(full.id, readOnly.id, revoked.id)

  // Autenticação
  check('sem chave → 401', (await api('GET', '/me')).status === 401)
  check('chave revogada → 401', (await api('GET', '/me', revoked.key)).status === 401)
  const me = await api('GET', '/me', full.key)
  check('GET /me → 200 com workspace', me.status === 200 && me.json?.data?.workspace?.id === WS, JSON.stringify(me.json))

  const hs = await api('POST', '/extensions/handshake', full.key, { body: { version: '0.2.0' } })
  check('handshake registra instalação', hs.status === 200 && hs.json?.data?.version === '0.2.0', JSON.stringify(hs.json))

  const clients = await api('GET', '/clients', full.key)
  check('GET /clients lista clientes', clients.status === 200 && clients.json?.data?.some((c) => c.id === CLIENT))
  check('escopo ausente (clientes:ler) → 403', (await api('GET', '/clients', readOnly.key)).status === 403)

  // Catálogo + ETag
  const menu = await api('GET', `/menu?client_id=${CLIENT}`, full.key)
  check('GET /menu → 200 + ETag', menu.status === 200 && Boolean(menu.etag), `${menu.status}`)
  const combo = menu.json?.data?.items?.find((i) => i.id === COMBO)
  check('combo do seed com 2 componentes', combo?.kind === 'combo' && combo.components.length === 2)

  // Importação
  const snapshot = {
    client_id: CLIENT,
    merchant: { id: 'MERCHANT-ASTRO-1', name: 'Hamburgueria Astro' },
    categories: [
      { id: 'IF-CAT-1', name: 'Lanches', position: 0 },
      { id: 'IF-CAT-2', name: 'Porções', position: 1 },
    ],
    items: [
      { id: 'IF-ITEM-1', name: 'X-Burger Clássico (Demo)', description: 'Hambúrguer artesanal 150g com queijo e molho da casa', price: 32.9, status: 'active', categoryId: 'IF-CAT-1', complements: [] },
      { id: 'IF-ITEM-2', name: 'Batata Frita (Demo)', description: 'Porção 300g', price: 19.9, status: 'active', categoryId: 'IF-CAT-2', complements: [{ id: 'IF-G-1', name: 'Molhos', min: 0, max: 2, options: [{ id: 'IF-O-1', name: 'Cheddar', price: 4 }] }] },
      { id: 'synth_3', name: 'Item sem id real', description: '', price: 5, status: 'paused', categoryId: 'IF-CAT-2', complements: [] },
      { id: 'IF-ITEM-4', name: 'Sem preço', description: '', price: null, status: 'active', categoryId: 'IF-CAT-2', complements: [] },
    ],
  }
  check('import sem If-Match → 428', (await api('POST', '/menu/import', full.key, { body: snapshot })).status === 428)
  check('import com If-Match velho → 409', (await api('POST', '/menu/import', full.key, { body: snapshot, ifMatch: '"2000-01-01T00:00:00.000Z:1"' })).status === 409)
  check('import com chave só-leitura → 403', (await api('POST', '/menu/import', readOnly.key, { body: snapshot, ifMatch: menu.etag })).status === 403)

  const imp = await api('POST', '/menu/import', full.key, { body: snapshot, ifMatch: menu.etag })
  const s = imp.json?.data
  check('import → 200', imp.status === 200, JSON.stringify(imp.json))
  check('import: vinculou X-Burger por nome', s?.items?.linked_by_name === 1, JSON.stringify(s?.items))
  check('import: criou Batata e item sintético', s?.items?.created === 2, JSON.stringify(s?.items))
  check('import: pulou item sem preço', s?.skipped?.some((x) => x.name === 'Sem preço'))
  check('import: criou grupo + opção', s?.groups?.created === 1 && s?.groups?.options_created === 1, JSON.stringify(s?.groups))

  const after = await api('GET', `/menu?client_id=${CLIENT}`, full.key)
  const batata = after.json?.data?.items?.find((i) => i.name === 'Batata Frita (Demo)')
  const synth = after.json?.data?.items?.find((i) => i.name === 'Item sem id real')
  check('Batata importada já sincronizada', batata && batata.ifood_id === 'IF-ITEM-2' && batata.pending === false, JSON.stringify(batata))
  check('id sintético NÃO vira ifood_id (fica pendente)', synth && synth.ifood_id === null && synth.pending === true && synth.status === 'inactive')
  check('Batata com grupo Molhos vinculado', batata?.group_ids?.length === 1)

  // Trava de loja
  const other = await api('POST', '/menu/import', full.key, { body: { ...snapshot, merchant: { id: 'OUTRA-LOJA', name: 'x' } }, ifMatch: after.etag })
  check('import de outra loja → 409 merchant_mismatch', other.status === 409 && other.json?.error?.code === 'merchant_mismatch', JSON.stringify(other.json))

  // Pendências
  const pend = await api('GET', `/menu/pending?client_id=${CLIENT}`, full.key)
  const pCombo = pend.json?.data?.pending?.find((p) => p.id === COMBO)
  check('combo aparece em pendências (criar)', pCombo?.action === 'create' && pCombo.components.length === 2, JSON.stringify(pCombo))
  check('Batata NÃO aparece em pendências', !pend.json?.data?.pending?.some((p) => p.name === 'Batata Frita (Demo)'))

  // PATCH com If-Match
  const item = await api('GET', `/menu/items/${batata.id}`, full.key)
  check('PATCH sem If-Match → 428', (await api('PATCH', `/menu/items/${batata.id}`, full.key, { body: { price: 21.9 } })).status === 428)
  const patched = await api('PATCH', `/menu/items/${batata.id}`, full.key, { body: { price: 21.9 }, ifMatch: item.etag })
  check('PATCH com If-Match → 200', patched.status === 200, JSON.stringify(patched.json))
  const stale = await api('PATCH', `/menu/items/${batata.id}`, full.key, { body: { price: 22.9 }, ifMatch: item.etag })
  check('PATCH com If-Match antigo → 409 + current', stale.status === 409 && stale.json?.error?.details?.current, JSON.stringify(stale.json))
  const pend2 = await api('GET', `/menu/pending?client_id=${CLIENT}`, full.key)
  check('Batata editada volta à fila', pend2.json?.data?.pending?.some((p) => p.id === batata.id && p.action === 'update'))

  // Confirmação de aplicação no iFood
  check('ifood-sync sem If-Match → 428', (await api('POST', `/menu/items/${COMBO}/ifood-sync`, full.key, { body: {} })).status === 428)
  const sync = await api('POST', `/menu/items/${COMBO}/ifood-sync`, full.key, { body: { ifood_id: 'IF-COMBO-1' }, ifMatch: pCombo.etag })
  check('ifood-sync combo → 200 + ifood_id', sync.status === 200 && sync.json?.data?.ifood_id === 'IF-COMBO-1', JSON.stringify(sync.json))
  const pend3 = await api('GET', `/menu/pending?client_id=${CLIENT}`, full.key)
  check('combo saiu da fila', !pend3.json?.data?.pending?.some((p) => p.id === COMBO))

  // Criar combo via API (sempre pausado)
  const xburger = after.json.data.items.find((i) => i.name === 'X-Burger Clássico (Demo)')
  const newCombo = await api('POST', '/menu/combos', full.key, {
    body: { client_id: CLIENT, name: 'Combo Batata (teste)', description: 'X-Burger + Batata', price: 45.9, status: 'active', components: [{ component_id: xburger.id, quantity: 1 }, { component_id: batata.id, quantity: 1 }] },
  })
  check('POST /menu/combos → 201', newCombo.status === 201, JSON.stringify(newCombo.json))
  const combosNow = await api('GET', `/menu?client_id=${CLIENT}`, full.key)
  const nc = combosNow.json?.data?.items?.find((i) => i.name === 'Combo Batata (teste)')
  check('combo criado via API nasce pausado', nc?.status === 'inactive' && nc.kind === 'combo')
  const bad = await api('POST', '/menu/combos', full.key, { body: { client_id: CLIENT, name: 'x', price: 1, components: [{ component_id: xburger.id, quantity: 1 }] } })
  check('combo com 1 item → 422', bad.status === 422)

  // Auditoria
  const audit = await rest(`audit_log?workspace_id=eq.${WS}&actor_type=eq.api_key&select=action`)
  const actions = new Set(audit.body.map((a) => a.action))
  check('audit_log registra ações da chave', actions.has('menu.import.ifood') && actions.has('menu.item.ifood_synced') && actions.has('menu.combo.create'), [...actions].join(','))
  check('audit_log não contém a chave em claro', !JSON.stringify(audit.body).includes('ck_live_'))
} finally {
  for (const id of created) await rest(`api_keys?id=eq.${id}`, { method: 'DELETE' })
}

const failed = results.filter((r) => !r.pass).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
