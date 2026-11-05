#!/usr/bin/env node
/**
 * smoke.mjs — Smoke test HTTP contra o stack LOCAL do Supabase (Docker).
 * NÃO commitar chaves: passe pelas variáveis de ambiente (valores descartáveis
 * do `npx supabase status -o env` local):
 *
 *   $env:LOCAL_API_URL='http://127.0.0.1:54321'        # (padrão se ausente)
 *   $env:LOCAL_ANON_KEY='<anon key LOCAL>'
 *   $env:LOCAL_SERVICE_ROLE_KEY='<service role key LOCAL>'
 *   node supabase/tests/smoke.mjs
 *
 * Prova:
 *   (a) cada usuário lê apenas os próprios dados (PostgREST + RLS);
 *   (b) ler/escrever dado do outro workspace falha/vazio;
 *   (c) visualizador não escreve.
 * Exit code 0 = tudo passou; 1 = falhou (detalhes no log).
 */
const clean = (v) => (v || '').replace(/^"|"$/g, '').trim()
const API = clean(process.env.LOCAL_API_URL) || 'http://127.0.0.1:54321'
const ANON = clean(process.env.LOCAL_ANON_KEY)
const SERVICE = clean(process.env.LOCAL_SERVICE_ROLE_KEY)

if (!ANON || !SERVICE) {
  console.error('Defina LOCAL_ANON_KEY e LOCAL_SERVICE_ROLE_KEY (chaves LOCAIS descartáveis de `npx supabase status -o env`).')
  process.exit(1)
}

const J = (obj) => JSON.stringify(obj)
const uniq = Date.now().toString(36)
const users = {
  a: { email: `smoke-a-${uniq}@orvia-smoke.example`, password: 'Smoke123!@#' },
  b: { email: `smoke-b-${uniq}@orvia-smoke.example`, password: 'Smoke123!@#' },
  v: { email: `smoke-v-${uniq}@orvia-smoke.example`, password: 'Smoke123!@#' },
}
const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
}
const rest = (path, { method = 'GET', key = ANON, token, body } = {}) =>
  fetch(`${API}${path}`, {
    method,
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${token || key}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: body ? J(body) : undefined,
  })

const signupAndToken = async ({ email, password }) => {
  let r = await fetch(`${API}/auth/v1/signup`, {
    method: 'POST',
    headers: { 'apikey': ANON, 'Content-Type': 'application/json' },
    body: J({ email, password }),
  })
  let body = await r.json()
  if (body.session?.access_token) return { id: body.user.id, token: body.session.access_token }
  // já existe? cai para password grant
  r = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'apikey': ANON, 'Content-Type': 'application/json' },
    body: J({ email, password }),
  })
  body = await r.json()
  if (body.access_token) return { id: body.user.id, token: body.access_token }
  throw new Error(`signup/token falhou para ${email}: ${J(body)}`)
}

try {
  console.log(`API: ${API}\n`)

  const [ta, tb, tv] = await Promise.all([signupAndToken(users.a), signupAndToken(users.b), signupAndToken(users.v)])
  console.log('signups ok\n')

  // Cria workspaces + membros + 1 cliente por workspace (service role; RLS bypassed de propósito)
  const mk = async (name, slug, memberId, role) => {
    const r = await rest('/rest/v1/workspaces', { method: 'POST', key: SERVICE, body: { name, slug, plan: 'free' } })
    const [ws] = await r.json()
    const rm = await rest('/rest/v1/members', { method: 'POST', key: SERVICE, body: { workspace_id: ws.id, user_id: memberId, role } })
    if (rm.status >= 300) throw new Error(`member insert falhou: ${await rm.text()}`)
    return ws.id
  }
  const wsA = await mk('Smoke A', `smoke-a-${uniq}`, ta.id, 'owner')
  const wsB = await mk('Smoke B', `smoke-b-${uniq}`, tb.id, 'owner')
  const rmv = await rest('/rest/v1/members', { method: 'POST', key: SERVICE, body: { workspace_id: wsA, user_id: tv.id, role: 'visualizador' } })
  if (rmv.status >= 300) throw new Error(`viewer member insert falhou: ${await rmv.text()}`)

  const mkClient = async (ws, name) => {
    const r = await rest('/rest/v1/clients', { method: 'POST', key: SERVICE, body: { workspace_id: ws, name } })
    const [c] = await r.json()
    return c.id
  }
  await mkClient(wsA, 'Cliente Smoke A')
  await mkClient(wsB, 'Cliente Smoke B')

  // (a) cada usuário lê apenas os próprios dados
  let r = await rest('/rest/v1/clients?select=workspace_id', { token: ta.token })
  let rows = await r.json()
  check('A lê apenas clientes do próprio workspace', Array.isArray(rows) && rows.every(x => x.workspace_id === wsA) && rows.length === 1, J(rows))

  r = await rest('/rest/v1/clients?select=workspace_id', { token: tb.token })
  rows = await r.json()
  check('B lê apenas clientes do próprio workspace', Array.isArray(rows) && rows.every(x => x.workspace_id === wsB) && rows.length === 1, J(rows))

  // (b) ler dado do outro workspace retorna vazio
  r = await rest(`/rest/v1/clients?workspace_id=eq.${wsB}&select=id`, { token: ta.token })
  rows = await r.json()
  check('A não enxerga clientes de B por filtro direto', Array.isArray(rows) && rows.length === 0, J(rows))

  // (b) escrever dado no workspace do outro falha (RLS)
  r = await rest('/rest/v1/clients', { method: 'POST', token: ta.token, body: { workspace_id: wsB, name: 'Injeção XL' } })
  rows = await r.text()
  check('A não cria cliente no workspace B', r.status >= 400, `HTTP ${r.status}`)

  // (c) visualizador não escreve
  r = await rest('/rest/v1/clients', { method: 'POST', token: tv.token, body: { workspace_id: wsA, name: 'Viewer escrevendo' } })
  check('Visualizador não escreve no próprio workspace', r.status >= 400, `HTTP ${r.status}`)

  // (b) membro A só vê membros do próprio workspace
  r = await rest('/rest/v1/members?select=workspace_id', { token: ta.token })
  rows = await r.json()
  check('A só enxerga membros do próprio workspace', Array.isArray(rows) && rows.every(x => x.workspace_id === wsA), J(rows))

  // anônimo não lê nada
  r = await rest('/rest/v1/clients?select=id', { token: 'invalid.token.here' })
  const anonRows = await r.json().catch(() => null)
  check('Token inválido não lê clientes', r.status >= 400 || (Array.isArray(anonRows) && anonRows.length === 0), `HTTP ${r.status}`)

  // cliente B é invisível por id para A (403/404/[] — qualquer um é recusa)
  r = await rest(`/rest/v1/clients?workspace_id=eq.${wsB}&select=id`, { token: ta.token })
  rows = await r.json()
  check('Filtro direto por B retorna vazio para A (não 401, não dados)', Array.isArray(rows) && rows.length === 0)

  console.log(`\n${results.filter(x => x.ok).length}/${results.length} checks passaram`)
  process.exit(results.every(x => x.ok) ? 0 : 1)
} catch (err) {
  console.error('ERRO no smoke test:', err)
  process.exit(1)
}
