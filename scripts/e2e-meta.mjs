// E2E LOCAL da integração Meta: Conectar com o Facebook (OAuth) → portfólios →
// sincronizar → Visão geral → Relatórios → desconectar. NUNCA usa a Meta real nem
// o banco de produção: sobe um simulador da Graph API/diálogo OAuth em 127.0.0.1.
//
// Pré-requisitos:
//   1) Supabase local (`npx supabase start`) com as migrations + seed (workspace orvia-demo).
//   2) Hub em http://localhost:3100 apontando para o Supabase LOCAL, com:
//        META_APP_ID=123456789012  META_APP_SECRET=e2e-app-secret  META_TOKEN_KEY=<32 bytes b64>
//        META_GRAPH_BASE_URL=http://127.0.0.1:4590  META_DIALOG_BASE_URL=http://127.0.0.1:4590
//        NEXT_DIST_DIR=.next-e2e   (não disputa a .next do `npm run dev`)
//   3) LOCAL_API_URL / LOCAL_ANON_KEY / LOCAL_SERVICE_ROLE_KEY só no ambiente do processo.
//   OUT=<pasta para prints, fora do repo> node scripts/e2e-meta.mjs
import { chromium } from '@playwright/test'
import { createHmac, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'

const HUB = 'http://localhost:3100'
const SB = process.env.LOCAL_API_URL
const ANON = process.env.LOCAL_ANON_KEY
const SR = process.env.LOCAL_SERVICE_ROLE_KEY
const OUT = process.env.OUT
if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(SB ?? '')) throw new Error('somente Supabase LOCAL')

const APP_ID = '123456789012'
const APP_SECRET = 'e2e-app-secret'
const LONG = `EAAE2E${randomBytes(12).toString('hex')}`
const WS_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const WS = 'orvia-demo'

let pass = 0
let fail = 0
const log = (ok, m) => {
  ok ? pass++ : fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${m}`)
}

// ---------------------------------------------------------------------------
// Simulador da Meta
// ---------------------------------------------------------------------------
const calls = []
const live = { C1: 'ACTIVE' } // status "ao vivo" da campanha C1 (o teste pausa no meio)
const days = (since, until) => {
  const out = []
  for (let d = new Date(`${since}T12:00:00Z`); d <= new Date(`${until}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10))
  return out
}
const ACCOUNTS = {
  '111111111111': [
    { id: 'act_9001', name: 'Pizzaria do Ze (Demo)', currency: 'BRL', account_status: 1, is_prepay_account: true, balance: '0', amount_spent: '250000', timezone_name: 'America/Sao_Paulo', business: { id: '111111111111', name: 'BM Teste A' }, funding_source_details: { display_string: 'Saldo disponível (R$ 700,00 BRL)' }, insights: { data: [{ spend: '1600.00' }] } },
    { id: 'act_9002', name: 'Conta Pos-paga E2E', currency: 'BRL', account_status: 1, is_prepay_account: false, balance: '15000', amount_spent: '90000', timezone_name: 'America/Sao_Paulo', business: { id: '111111111111', name: 'BM Teste A' }, insights: { data: [{ spend: '300.00' }] } },
  ],
  '222222222222': [{ id: 'act_9003', name: 'Conta Desativada E2E', currency: 'BRL', account_status: 2, is_prepay_account: true, balance: '0', amount_spent: '0', business: { id: '222222222222', name: 'BM Teste B' } }],
}

const mock = createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:4590')
  const q = url.searchParams
  const send = (status, body, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers })
    res.end(typeof body === 'string' ? body : JSON.stringify(body))
  }
  const path = url.pathname.replace(/^\/v\d+\.\d+/, '')
  calls.push(path)

  if (path === '/dialog/oauth') {
    const scopes = (q.get('scope') ?? '').split(',')
    if (q.get('client_id') !== APP_ID || !scopes.includes('ads_read') || !scopes.includes('business_management')) return send(400, { error: { message: 'dialog inválido' } })
    const back = new URL(q.get('redirect_uri'))
    back.searchParams.set('code', 'E2E_CODE')
    back.searchParams.set('state', q.get('state'))
    res.writeHead(302, { Location: back.toString() })
    return res.end()
  }
  if (path === '/oauth/access_token') {
    if (q.get('client_id') !== APP_ID || q.get('client_secret') !== APP_SECRET) return send(400, { error: { code: 1, message: 'app inválido' } })
    if (q.get('code') === 'E2E_CODE' && q.get('redirect_uri')?.endsWith('/api/meta/oauth/callback')) return send(200, { access_token: 'SHORT_E2E' })
    if (q.get('grant_type') === 'fb_exchange_token' && q.get('fb_exchange_token') === 'SHORT_E2E') return send(200, { access_token: LONG, expires_in: 5184000 })
    return send(400, { error: { code: 100, message: 'troca inválida' } })
  }

  // Demais chamadas: token longo + appsecret_proof válido (igual à Meta com "Exigir appsecret_proof")
  const proof = createHmac('sha256', APP_SECRET).update(LONG).digest('hex')
  if (q.get('access_token') !== LONG) return send(400, { error: { code: 190, message: 'token inválido' } })
  if (q.get('appsecret_proof') !== proof) return send(400, { error: { code: 100, message: 'appsecret_proof inválido' } })

  if (path === '/me') return send(200, { id: '1000001', name: 'Usuário Teste E2E' })
  if (path === '/me/permissions') return send(200, { data: [{ permission: 'ads_read', status: 'granted' }, { permission: 'business_management', status: 'granted' }] })
  if (path === '/me/businesses') return send(200, { data: [{ id: '111111111111', name: 'BM Teste A' }, { id: '222222222222', name: 'BM Teste B' }] })

  let m = /^\/(\d+)\/(owned_ad_accounts|client_ad_accounts)$/.exec(path)
  if (m) return send(200, { data: m[2] === 'owned_ad_accounts' ? ACCOUNTS[m[1]] ?? [] : [] })

  m = /^\/(act_\d+)\/insights$/.exec(path)
  if (m) {
    const range = JSON.parse(q.get('time_range') ?? '{}')
    const list = days(range.since, range.until)
    // Por dia: gasto 100, 3000 impressões, 50 cliques no link, 10 carrinhos, 4 compras (R$ 400)
    const dayRow = (n) => ({
      spend: String(100 * n), reach: String(1000 * n), impressions: String(3000 * n), clicks: String(60 * n), inline_link_clicks: String(50 * n),
      actions: [{ action_type: 'omni_purchase', value: String(4 * n) }, { action_type: 'purchase', value: String(4 * n) }, { action_type: 'omni_add_to_cart', value: String(10 * n) }, { action_type: 'link_click', value: String(50 * n) }],
      action_values: [{ action_type: 'omni_purchase', value: String(400 * n) }, { action_type: 'purchase', value: String(400 * n) }],
    })
    if (q.get('time_increment') === '1') return send(200, { data: list.map((d) => ({ date_start: d, date_stop: d, ...dayRow(1) })) })
    if (q.get('level') === 'ad') {
      const ad = (id, name, spend, purchases) => ({ ad_id: id, ad_name: name, spend: String(spend), impressions: String(spend * 30), inline_link_clicks: String(spend / 2), actions: [{ action_type: 'omni_purchase', value: String(purchases) }, { action_type: 'omni_add_to_cart', value: String(purchases * 2) }], action_values: [{ action_type: 'omni_purchase', value: String(purchases * 100) }] })
      return send(200, { data: [ad('A1', 'Criativo Pizza Calabresa', 300, 9), ad('A2', 'Criativo Combo Família', 250, 14), ad('A3', 'Criativo Sobremesa', 150, 3)] })
    }
    return send(200, { data: [dayRow(list.length)] })
  }
  m = /^\/(act_\d+)\/campaigns$/.exec(path)
  if (m) {
    return send(200, { data: [
      { id: 'C1', name: 'Campanha Vendas Pizza', effective_status: live.C1, daily_budget: '5000', objective: 'OUTCOME_SALES', start_time: '2026-10-01T00:00:00-0300' },
      { id: 'C2', name: 'Campanha Antiga', effective_status: 'PAUSED', lifetime_budget: '90000', objective: 'OUTCOME_SALES' },
    ] })
  }
  m = /^\/(act_\d+)\/adsets$/.exec(path)
  if (m) {
    return send(200, { data: [
      { id: 'S1', name: 'Conjunto Aberto', campaign_id: 'C1', effective_status: 'ACTIVE', end_time: '2026-12-20T23:59:00-0300', updated_time: '2026-11-15T10:00:00-0300' },
      { id: 'S2', name: 'Conjunto Remarketing', campaign_id: 'C1', effective_status: 'ACTIVE', daily_budget: '2000', updated_time: '2026-11-14T10:00:00-0300' },
      { id: 'S3', name: 'Conjunto Antigo', campaign_id: 'C2', effective_status: 'PAUSED', end_time: '2027-01-30T23:59:00-0300', updated_time: '2026-11-16T09:30:00-0300' },
    ] })
  }
  m = /^\/(act_\d+)\/ads$/.exec(path)
  if (m) {
    return send(200, { data: [
      { id: 'A1', name: 'Criativo Pizza Calabresa', adset_id: 'S1', campaign_id: 'C1', effective_status: 'ACTIVE', creative: { thumbnail_url: 'https://scontent.fbcdn.net/e2e/calabresa.png' } },
      { id: 'A2', name: 'Criativo Combo Família', adset_id: 'S2', campaign_id: 'C1', effective_status: 'ACTIVE', creative: { thumbnail_url: 'https://evil.example/x.png' } },
      { id: 'A3', name: 'Criativo Sobremesa', adset_id: 'S3', campaign_id: 'C2', effective_status: 'PAUSED' },
    ] })
  }
  return send(404, { error: { code: 803, message: `rota não simulada: ${path}` } })
})
await new Promise((r) => mock.listen(4590, '127.0.0.1', r))

// ---------------------------------------------------------------------------
// Usuário descartável (owner do workspace demo) no Supabase LOCAL
// ---------------------------------------------------------------------------
const H = { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json' }
const rest = (p, init = {}) => fetch(`${SB}/rest/v1/${p}`, { ...init, headers: { ...H, ...(init.headers ?? {}) } })
const email = `e2e-meta-${Date.now()}@orvia-demo.example`
const password = randomBytes(18).toString('base64url')
const user = await (await fetch(`${SB}/auth/v1/admin/users`, { method: 'POST', headers: H, body: JSON.stringify({ email, password, email_confirm: true }) })).json()
await rest('members', { method: 'POST', body: JSON.stringify({ workspace_id: WS_ID, user_id: user.id, role: 'owner' }) })

const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1440, height: 950 } })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message.split(/\r?\n/)[0]))
const shot = (n) => (OUT ? page.screenshot({ path: `${OUT}/${n}.png`, fullPage: true }) : Promise.resolve())
// Miniaturas "da Meta" (fbcdn) servidas localmente: o teste nunca toca a internet.
const thumbs = []
await page.route('https://*.fbcdn.net/**', (route) => {
  thumbs.push(route.request().url())
  route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64') })
})
await page.route('https://evil.example/**', (route) => {
  thumbs.push(route.request().url())
  route.abort()
})

try {
  // Login
  await page.goto(`${HUB}/login`)
  await page.fill('input[type=email]', email)
  await page.fill('input[type=password]', password)
  await page.keyboard.press('Enter')
  await page.waitForURL(/\/a\//, { timeout: 60000 })
  log(true, 'login com usuário local descartável')

  // State inválido é recusado
  await page.goto(`${HUB}/api/meta/oauth/callback?code=E2E_CODE&state=forjado`)
  log(!page.url().includes('meta=ok'), 'callback com state forjado é recusado')

  // Integrações
  await page.goto(`${HUB}/a/${WS}/configuracoes?tab=integracoes`)
  const connect = page.getByRole('link', { name: /Conectar com o Facebook/ })
  await connect.waitFor({ timeout: 60000 })
  log((await connect.getAttribute('aria-disabled')) === 'false', 'botão "Conectar com o Facebook" habilitado (app configurado)')
  await shot('01-integracoes-antes')

  await connect.click()
  await page.waitForURL(/meta=ok/, { timeout: 60000 })
  await page.getByText('Conta do Facebook conectada').waitFor({ timeout: 30000 })
  log(true, 'OAuth: diálogo → callback → conexão salva (meta=ok)')
  log(await page.getByText('Usuário Teste E2E').isVisible(), 'nome do perfil do Facebook exibido')
  log((await page.getByText('BM Teste A').isVisible()) && (await page.getByText('BM Teste B').isVisible()), 'os 2 portfólios do perfil aparecem')
  await shot('02-integracoes-conectado')

  // Token criptografado e inacessível pelo usuário
  const tokRows = await (await rest(`meta_connection_tokens?workspace_id=eq.${WS_ID}&select=token_ciphertext`)).json()
  log(tokRows.length === 1 && !tokRows[0].token_ciphertext.includes(LONG) && !tokRows[0].token_ciphertext.includes('EAA'), 'token salvo criptografado (sem o texto do token)')
  const session = await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })).json()
  const asUser = await fetch(`${SB}/rest/v1/meta_connection_tokens?select=*`, { headers: { apikey: ANON, Authorization: `Bearer ${session.access_token}` } })
  const asUserRows = asUser.ok ? await asUser.json() : []
  log(Array.isArray(asUserRows) && asUserRows.length === 0, `RLS: o próprio owner NÃO lê a tabela de tokens (HTTP ${asUser.status})`)

  // Ativa só o portfólio A e sincroniza
  await page.getByRole('switch', { name: 'Conectar portfólio BM Teste A' }).click()
  await page.getByText('BM Teste A conectado').waitFor({ timeout: 30000 })
  await page.getByRole('button', { name: /Sincronizar contas/ }).click()
  await page.getByText(/2 conta\(s\) de anúncio sincronizada\(s\) de 1 portfólio/).waitFor({ timeout: 90000 })
  log(true, 'sincronização: 2 contas do portfólio ativo (o desligado fica de fora)')
  const bizRows = await (await rest(`meta_businesses?workspace_id=eq.${WS_ID}&select=name,enabled,accounts_count,last_synced_at,sync_error`)).json()
  const bizA = bizRows.find((b) => b.name === 'BM Teste A')
  log(bizA?.accounts_count === 2 && !!bizA?.last_synced_at && !bizA?.sync_error, `portfólio registra contas e data da sincronização (${JSON.stringify(bizA)})`)
  await page.reload()
  await page.getByText(/2 conta\(s\) · última sincronização/).waitFor({ timeout: 30000 }).then(() => log(true, 'tela mostra "2 conta(s) · última sincronização"'), () => log(false, 'tela mostra "2 conta(s) · última sincronização"'))
  await shot('03-integracoes-sincronizado')

  const acc = await (await rest(`ad_accounts?workspace_id=eq.${WS_ID}&external_account_id=in.(act_9001,act_9002,act_9003)&select=external_account_id,balance,spend_7d,spend_yesterday,roas_month,ends_at,runs_continuously,last_change_at,active_adsets,client_id,meta_business_id`)).json()
  const a1 = acc.find((a) => a.external_account_id === 'act_9001')
  const a2 = acc.find((a) => a.external_account_id === 'act_9002')
  log(acc.length === 2 && !acc.some((a) => a.external_account_id === 'act_9003'), 'conta do portfólio desligado não foi importada')
  log(Number(a1?.balance) === 700 && Number(a2?.balance) === -150, 'saldo: pré-paga R$ 700 · pós-paga devendo R$ 150')
  log(Number(a1?.spend_7d) === 700 && Number(a1?.spend_yesterday) === 100, 'gasto 7 dias (700) e ontem (100)')
  log(Number(a1?.roas_month) === 4, 'ROAS do mês = 4,00')
  log(a1?.ends_at?.startsWith('2026-12-21T02:59') && a1?.runs_continuously === true && a1?.active_adsets === 2, 'término = maior data dos conjuntos ATIVOS (20/12) + conjunto contínuo detectado')
  log(a1?.last_change_at?.startsWith('2026-11-16T12:30'), 'última alteração = updated_time mais recente (16/11 09:30)')
  log(a1?.client_id === 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1' && !!a1?.meta_business_id, 'conta vinculada automaticamente ao cliente pelo nome + ao portfólio')

  // Visão geral
  await page.goto(`${HUB}/a/${WS}/visao-geral`)
  const row = page.locator('div,tr').filter({ hasText: 'Pizzaria do Ze (Demo)' }).last()
  await page.getByText('Pizzaria do Ze (Demo)').first().waitFor({ timeout: 60000 })
  const body = await page.locator('body').innerText()
  log(/4,00x/.test(body), 'Visão geral: coluna ROAS (mês) = 4,00x')
  log(/R\$\s?700,00/.test(body) && /\b7d\b/.test(body), 'Visão geral: saldo R$ 700,00 com 7 dias')
  log(/20\/12/.test(body), 'Visão geral: término 20/12')
  log(body.includes('Conta Pos-paga E2E') && /Devedor/.test(body), 'Visão geral: conta sem cliente aparece (pós-paga devedora)')
  log(!/dados fictícios/.test(body), 'Visão geral: sem aviso de dados fictícios')
  void row
  await shot('04-visao-geral')

  // Botão Sincronizar do topo
  await page.getByRole('button', { name: /^Sincronizar$/ }).click()
  await page.getByText(/2 conta\(s\) sincronizada\(s\) de 1 portfólio/).waitFor({ timeout: 90000 })
  log(true, 'botão Sincronizar do topo faz a sincronização real')
  log(!/Sincronização simulada/.test(await page.locator('body').innerText()), 'mensagem "simulada" não aparece mais')

  // Status por cor + conta sem cliente sempre no fim
  await page.goto(`${HUB}/a/${WS}/visao-geral`)
  await page.getByText('Pizzaria do Ze (Demo)').first().waitFor({ timeout: 60000 })
  const names = await page.locator('table[aria-label="Lista de clientes"] tbody tr').evaluateAll((trs) => trs.map((tr) => tr.innerText.split('\n')[0]))
  log(names.length > 1 && names[names.length - 1].includes('Conta Pos-paga E2E'), `conta sem cliente fica no fim da lista (${names.slice(-2).join(' | ')})`)
  const pizzaRow = page.locator('table[aria-label="Lista de clientes"] tbody tr').filter({ hasText: 'Pizzaria do Ze (Demo)' })
  const contaRow = page.locator('table[aria-label="Lista de clientes"] tbody tr').filter({ hasText: 'Conta Pos-paga E2E' })
  log((await pizzaRow.getByLabel('Status: Tranquilo').count()) === 1, 'cliente com saldo e término folgados = bolinha verde (Tranquilo)')
  log((await contaRow.getByLabel('Status: Sem cliente').count()) === 1, 'conta sem cliente = bolinha azul')
  log(/contas sem cliente/.test(await page.locator('body').innerText()), 'legenda de status com contagem por cor')

  // Situação salva no banco
  await pizzaRow.getByLabel('Situação do cliente').selectOption('stand_by')
  await page.getByText(/Stand-by salvo/).waitFor({ timeout: 30000 })
  const st1 = await (await rest('clients?id=eq.bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1&select=status')).json()
  log(st1[0]?.status === 'pausado', 'mudar a situação para Stand-by salva no banco (pausado)')
  await pizzaRow.getByLabel('Situação do cliente').selectOption('ativo')
  await page.getByText(/Ativo salvo/).waitFor({ timeout: 30000 })
  await shot('04b-visao-geral-status')

  // Clicar no cliente abre a apresentação
  await pizzaRow.getByTitle('Abrir métricas, campanhas e criativos').click()
  await page.waitForURL(/\/clientes\/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1/, { timeout: 60000 })
  log(true, 'clicar no cliente abre a apresentação de métricas')
  await page.getByText('Faturamento ÷ investimento').waitFor({ timeout: 90000 })
  let cbody = await page.locator('body').innerText()
  log(/4,00x/i.test(cbody), 'Métricas (7 dias): ROAS 4,00x')
  log(/R\$\s?2\.800,00/.test(cbody) && /R\$\s?700,00/.test(cbody), 'Métricas: faturamento R$ 2.800,00 e total investido R$ 700,00')
  log(/R\$\s?2,00/.test(cbody) && /1,67%/.test(cbody), 'Métricas: CPC R$ 2,00 e CTR do link 1,67%')
  log(/\b350\b/.test(cbody) && /\b70\b/.test(cbody), 'Métricas: 350 cliques no link e 70 adições ao carrinho')
  log((await page.getByRole('img', { name: /Gráfico diário/ }).count()) === 1, 'gráfico diário de investimento × faturamento')
  await shot('06-cliente-metricas')

  await page.getByRole('button', { name: 'Últimos 30 dias' }).click()
  await page.getByText(/R\$\s?3\.000,00/).first().waitFor({ timeout: 60000 })
  log(true, 'período 30 dias: total investido R$ 3.000,00')
  await page.getByRole('button', { name: 'Últimos 14 dias' }).click()
  await page.getByText(/R\$\s?1\.400,00/).first().waitFor({ timeout: 60000 })
  log(true, 'período 14 dias: total investido R$ 1.400,00')
  await page.getByLabel('Data inicial do período').fill('2026-11-01')
  await page.getByLabel('Data final do período').fill('2026-11-03')
  await page.getByRole('button', { name: 'Personalizado' }).click()
  await page.getByText('01/11 a 03/11').waitFor({ timeout: 60000 })
  log(/R\$\s?300,00/.test(await page.locator('body').innerText()), 'período personalizado (01/11 a 03/11): R$ 300,00')

  // Campanhas (gerenciador)
  await page.getByRole('tab', { name: /Campanhas/ }).click()
  await page.getByText('Campanha Vendas Pizza').waitFor({ timeout: 60000 })
  cbody = await page.locator('body').innerText()
  log(!cbody.includes('Campanha Antiga'), 'Campanhas: filtro "Ativas" esconde a campanha pausada')
  log(/R\$ 50,00\/dia/.test(cbody), 'Campanhas: orçamento diário R$ 50,00/dia')
  await page.getByRole('button', { name: 'Expandir Campanha Vendas Pizza' }).click()
  await page.getByText('Conjunto Aberto').waitFor({ timeout: 10000 })
  log(await page.getByText('Conjunto Remarketing').isVisible(), 'seta da campanha abre os conjuntos')
  await page.getByRole('button', { name: 'Expandir Conjunto Aberto' }).click()
  await page.getByText('Criativo Pizza Calabresa').waitFor({ timeout: 10000 })
  log(true, 'seta do conjunto abre os anúncios')
  await page.getByRole('radio', { name: 'Desativadas' }).click()
  await page.getByText('Campanha Antiga').waitFor({ timeout: 10000 })
  log(!(await page.getByText('Campanha Vendas Pizza').isVisible()), 'filtro "Desativadas" mostra só as pausadas')
  await page.getByRole('radio', { name: 'Todas' }).click()
  const vendasRow = page.locator('tr').filter({ hasText: 'Campanha Vendas Pizza' })
  log(/Ativo/.test(await vendasRow.innerText()), 'status da campanha ativa = Ativo (bolinha verde)')
  await shot('07-cliente-campanhas')
  live.C1 = 'PAUSED'
  await vendasRow.getByText('Pausado').waitFor({ timeout: 45000 })
  log(true, 'ao vivo: campanha pausada na Meta vira "Pausado" (vermelho) sem recarregar')

  // Criativos
  await page.getByRole('tab', { name: /Criativos/ }).click()
  await page.getByText('Criativo Combo Família').first().waitFor({ timeout: 60000 })
  const cards = await page.locator('article').evaluateAll((els) => els.map((e) => e.innerText))
  log(cards.length === 3 && cards[0].includes('Criativo Combo Família') && cards[0].includes('#1'), 'Criativos: 3 anúncios, ordenados por compras (#1 Combo Família)')
  log(thumbs.some((u) => u.includes('fbcdn.net')) && !thumbs.some((u) => u.includes('evil.example')), 'miniatura da Meta carrega; URL de fora da Meta é bloqueada')
  await page.getByLabel('Ordenar criativos').selectOption('spend')
  const first = await page.locator('article').first().innerText()
  log(first.includes('Criativo Pizza Calabresa'), 'ordenar por maior gasto funciona')
  await shot('08-cliente-criativos')

  // Relatórios
  await page.goto(`${HUB}/a/${WS}/relatorios`)
  await page.getByLabel('Escolher cliente do relatório').selectOption('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1')
  await page.getByText('Consultando a Meta').waitFor({ state: 'detached', timeout: 90000 }).catch(() => undefined)
  await page.waitForTimeout(1500)
  const rep = await page.locator('body').innerText()
  log(/R\$\s?700,00/.test(rep), 'Relatórios: investimento real da semana (R$ 700,00)')
  log(/ROAS: 4,00x/i.test(rep), 'Relatórios: ROAS 4,00x')
  log(/Criativo Combo Família/.test(rep), 'Relatórios: melhor anúncio por compras aparece')
  const wa = await page.locator('textarea').first().inputValue()
  log(/Investimento: R\$\s?700,00/.test(wa) && /ROAS 4,00x/.test(wa), 'Relatórios: texto de WhatsApp com valores reais')
  await shot('05-relatorios')

  // Desconectar
  await page.goto(`${HUB}/a/${WS}/configuracoes?tab=integracoes`)
  page.once('dialog', (d) => d.accept())
  await page.getByRole('button', { name: /Desconectar/ }).click()
  await page.getByText('Conta desconectada.').waitFor({ timeout: 30000 })
  const afterTok = await (await rest(`meta_connection_tokens?workspace_id=eq.${WS_ID}&select=connection_id`)).json()
  const afterBiz = await (await rest(`meta_businesses?workspace_id=eq.${WS_ID}&select=id`)).json()
  log(afterTok.length === 0 && afterBiz.length === 0, 'desconectar apaga o token e os portfólios')

  log(calls.filter((c) => c === '/oauth/access_token').length === 2, 'OAuth trocou code → token curto → token longo')
  log(errors.length === 0, `sem erros de JavaScript na página${errors.length ? `: ${errors.join(' | ')}` : ''}`)
} catch (e) {
  log(false, `exceção: ${e.message.split('\n')[0]}`)
  await shot('99-erro').catch(() => undefined)
} finally {
  // Limpeza: nada de teste fica no banco local
  await rest(`ad_accounts?workspace_id=eq.${WS_ID}&external_account_id=in.(act_9001,act_9002,act_9003)`, { method: 'DELETE' })
  await rest(`meta_connections?workspace_id=eq.${WS_ID}`, { method: 'DELETE' })
  await rest(`members?user_id=eq.${user.id}`, { method: 'DELETE' })
  await fetch(`${SB}/auth/v1/admin/users/${user.id}`, { method: 'DELETE', headers: H })
  await browser.close()
  mock.close()
  console.log(`\n${pass} PASS / ${fail} FAIL`)
  process.exit(fail ? 1 : 0)
}
