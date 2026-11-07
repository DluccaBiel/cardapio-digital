#!/usr/bin/env node
/**
 * E2E da extensão no Chromium real, contra o hub LOCAL (http://localhost:3100 → Supabase local).
 * O "portal do iFood" é SIMULADO: o Playwright intercepta https://portal.ifood.com.br/* e serve
 * uma página que busca tests/fixtures/menu-payload.json (dados fictícios). Nada toca o iFood real.
 *
 * Pré-requisitos: `npx supabase db reset` + hub local na porta 3100.
 *   LOCAL_API_URL=... LOCAL_SERVICE_ROLE_KEY=... node scripts/e2e.mjs
 * Gera um build de teste (Shadow DOM aberto + host localhost) numa pasta temporária e
 * reconstrói o build normal ao final.
 */
import { chromium } from '@playwright/test'
import { execSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HUB = process.env.HUB_URL ?? 'http://localhost:3100'
const SB = process.env.LOCAL_API_URL
const SR = process.env.LOCAL_SERVICE_ROLE_KEY
if (!/^http:\/\/(localhost|127\.0\.0\.1)/.test(SB ?? '') || !/^http:\/\/(localhost|127\.0\.0\.1)/.test(HUB)) {
  console.error('Somente ambiente local.')
  process.exit(2)
}
const WS = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CLIENT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'
const H = { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }
const rest = async (path, init = {}) => {
  const r = await fetch(`${SB}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers ?? {}) } })
  const t = await r.text()
  return t ? JSON.parse(t) : null
}

// Trava de segurança: nunca fica pendurado
setTimeout(() => { console.error("TIMEOUT global (300s)"); process.exit(3) }, 300_000).unref()
const step = (m) => console.log(`·· ${m}`)
const results = []
const check = (name, cond, detail = '') => {
  results.push(Boolean(cond))
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  → ${detail}` : ''}`)
}

// 1) Build de teste numa pasta temporária
execSync('node scripts/build.mjs', { env: { ...process.env, ORVIA_E2E: '1' }, stdio: 'inherit' })
const dir = mkdtempSync(join(tmpdir(), 'orvia-ext-e2e-'))
for (const f of ['manifest.json', 'options.html', 'dist', 'assets']) cpSync(f, join(dir, f), { recursive: true })
const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
manifest.host_permissions.push('http://localhost/*') // só no build de teste
manifest.content_scripts.find((cs) => cs.js.includes('dist/hub-bridge.js')).matches.push('http://localhost/a/*/extensoes*')
writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))
execSync('node scripts/build.mjs', { stdio: 'inherit' }) // volta o build normal

// 2) Chave descartável
const ext = await rest('extensions?slug=eq.orvia-ifood&select=id')
const key = `ck_live_${randomBytes(32).toString('base64url')}`
const [row] = await rest('api_keys', {
  method: 'POST',
  body: JSON.stringify({
    workspace_id: WS,
    extension_id: ext[0].id,
    name: 'e2e extensão',
    key_hash: createHash('sha256').update(key).digest('hex'),
    key_prefix: key.slice(0, 12),
    scopes: ['clientes:ler', 'catalogo:ler', 'catalogo:escrever'],
  }),
})

const fixtureJson = JSON.parse(readFileSync('tests/fixtures/menu-payload.json', 'utf8'))
const fixture = JSON.stringify(fixtureJson)
// "Servidor do iFood" SIMULADO: detalhe dos itens em centavos, PUT do objeto inteiro, exige token.
const portalDb = {}
for (const cat of fixtureJson.categories) for (const it of cat.items) {
  portalDb[it.id] = { id: it.id, name: it.name, description: it.description, price: { value: Math.round(it.price * 100) }, status: it.status, extra: { sku: `SKU-${it.id}` } }
}
const TOKEN = 'Bearer sim-token'
async function portalRoute(route) {
  const req = route.request()
  const url = new URL(req.url())
  if (url.pathname === '/api/v1/menu-fixture') return route.fulfill({ status: 200, contentType: 'application/json', body: fixture })
  const m = url.pathname.match(/^\/merchant-api\/catalog\/items\/([^/]+)$/)
  if (m) {
    if (req.headers()['authorization'] !== TOKEN) return route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"no auth"}' })
    const id = decodeURIComponent(m[1])
    if (!portalDb[id]) return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
    if (req.method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: portalDb[id] }) })
    if (req.method() === 'PUT') {
      portalDb[id] = JSON.parse(req.postData())
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
    }
  }
  return route.fulfill({ status: 200, contentType: 'text/html', body: portalHtml })
}
const portalHtml = `<!doctype html><html><head><title>Portal (simulado)</title></head><body>
<h1>Portal do Parceiro (SIMULADO para teste)</h1>
<script>
const H = { Authorization: 'Bearer sim-token' }
fetch('/api/v1/menu-fixture', { headers: H }).then(r => r.json()).then(() => document.body.dataset.loaded = '1')
// Edição "manual" como o portal faria: abre o item (GET) e salva o objeto inteiro (PUT)
window.simEdit = async (id, change) => {
  const r = await fetch('/merchant-api/catalog/items/' + id, { headers: H })
  const item = (await r.json()).data
  change(item)
  const w = await fetch('/merchant-api/catalog/items/' + id, { method: 'PUT', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify(item) })
  return w.status
}
</script>
</body></html>`

step('abrindo Chromium com a extensão')
let createdUser = null
let autoKeyId = null
let loginKeyIds = []
const context = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${dir}`, `--load-extension=${dir}`],
  viewport: { width: 1440, height: 900 },
})
context.setDefaultTimeout(40000)
try {
  await context.route('https://portal.ifood.com.br/**', portalRoute)

  step('aguardando service worker')
  let [sw] = context.serviceWorkers()
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 20000 })
  const extId = new URL(sw.url()).host
  check('service worker da extensão ativo', Boolean(extId))

  // "Conectar com um clique": login no painel → Extensões → Conectar extensão
  step('conexão automática pelo painel')
  const email = `e2e-ext-${Date.now()}@orvia-demo.example`
  const password = randomBytes(18).toString('base64url')
  const user = await (await fetch(`${SB}/auth/v1/admin/users`, { method: 'POST', headers: H, body: JSON.stringify({ email, password, email_confirm: true }) })).json()
  createdUser = user.id
  await rest('members', { method: 'POST', body: JSON.stringify({ workspace_id: WS, user_id: user.id, role: 'owner' }) })
  step('login com usuário nas opções da extensão')
  step('opções: abrindo')
  const opt = await context.newPage()
  await opt.goto(`chrome-extension://${extId}/options.html`)
  await opt.locator('summary').click()
  await opt.fill('#hubUrl', HUB)
  await opt.fill('#email', email)
  await opt.fill('#password', password)
  step('opções: enviando login')
  await opt.click('#loginBtn')
  await opt.locator('#who').filter({ hasText: email }).waitFor({ timeout: 60000 })
  check('login com e-mail/senha conectou a extensão', (await opt.textContent('#who')).includes('Orvia Demo'))
  const viaLogin = await sw.evaluate(async () => (await chrome.storage.local.get('orvia.hub'))['orvia.hub'])
  check('senha não fica salva na extensão', !JSON.stringify(viaLogin).includes(password) && /^ck_live_/.test(viaLogin?.apiKey ?? ''))
  const loginKeys = await rest(`api_keys?workspace_id=eq.${WS}&name=like.${encodeURIComponent('Extensão · ' + email + '*')}&select=id,scopes,revoked_at`)
  check('servidor criou acesso da extensão para o usuário', loginKeys.length === 1 && !loginKeys[0].revoked_at, JSON.stringify(loginKeys))
  loginKeyIds = loginKeys.map((k) => k.id)
  await opt.screenshot({ path: join(dir, 'ext-00-login.png') })

  const hubPage = await context.newPage()
  await hubPage.goto(`${HUB}/login`)
  await hubPage.fill('input[type=email]', email)
  await hubPage.fill('input[type=password]', password)
  await hubPage.keyboard.press('Enter')
  await hubPage.waitForURL(/\/a\//, { timeout: 30000 })
  await hubPage.goto(`${HUB}/conectar-extensao`, { timeout: 120000 }) // 1ª compilação em modo dev é lenta
  await hubPage.waitForURL(/extensoes\?conectar=1/, { timeout: 30000 })
  await hubPage.getByText(/Extensão detectada \(v0\.3\.0\)/).waitFor({ timeout: 15000 })
  check('painel detecta a extensão instalada', true)
  await hubPage.getByRole('button', { name: 'Conectar extensão' }).click()
  await hubPage.getByText(/Extensão conectada ao workspace “Orvia Demo”/).waitFor({ timeout: 20000 })
  await hubPage.screenshot({ path: join(dir, 'ext-01-conectar.png') })
  const saved = await sw.evaluate(async () => (await chrome.storage.local.get('orvia.hub'))['orvia.hub'])
  check('extensão salvou a conexão sozinha (sem colar chave)', saved?.hubUrl === HUB && /^ck_live_/.test(saved?.apiKey ?? ''))
  check('chave não aparece na página do painel', !(await hubPage.content()).includes(saved?.apiKey ?? '###'))
  const install = await rest(`extension_installs?workspace_id=eq.${WS}&select=version,last_seen_at`)
  check('handshake registrou instalação v0.3.0', install?.[0]?.version === '0.3.0', JSON.stringify(install))
  const autoKeys = await rest(`api_keys?workspace_id=eq.${WS}&name=like.${encodeURIComponent('Conexão automática*')}&select=id,scopes`)
  check('chave automática criada com escopos mínimos', autoKeys.length === 1 && autoKeys[0].scopes.length === 3, JSON.stringify(autoKeys))
  autoKeyId = autoKeys[0]?.id
  await hubPage.goto(`${HUB}/conectar-extensao`, { timeout: 120000 })
  const connectedText = await hubPage.getByText(/Conectada agora/).first().waitFor({ timeout: 20000 }).then(() => true, () => false)
  check('painel do Orvia mostra a extensão "Conectada agora"', connectedText)
  await hubPage.screenshot({ path: join(dir, 'ext-01b-painel-conectada.png') })

  // Página de opções reflete a conexão
  const options = await context.newPage()
  await options.goto(`chrome-extension://${extId}/options.html`)
  await options.locator('#who').waitFor({ timeout: 10000 })
  check('opções mostram a conexão ativa', ((await options.textContent('#who')) ?? '').length > 0)

  // Portal simulado
  step('portal simulado')
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(e.message))
  await page.goto('https://portal.ifood.com.br/menu/list')
  await page.waitForSelector('body[data-loaded="1"]')
  const panel = page.locator('#orvia-ifood-root')
  await panel.getByRole('button', { name: 'Abrir Orvia' }).click()
  await panel.getByText('Hamburgueria Astro (Demo)').first().waitFor({ timeout: 15000 })
  check('captura passiva leu o cardápio (4 produtos)', await panel.getByText(/4 produtos/).isVisible())
  await panel.getByText(/conectado: Orvia Demo/).waitFor({ timeout: 15000 })
  const selected = await panel.getByLabel('Cliente no Orvia').inputValue()
  check('cliente sugerido pelo nome da loja', selected === CLIENT, selected)
  await page.screenshot({ path: join(dir, 'ext-02-cardapio.png') })

  // Importar
  await panel.getByRole('button', { name: 'Enviar cardápio para o Orvia' }).click()
  await panel.getByText('Resultado').waitFor({ timeout: 20000 })
  await page.screenshot({ path: join(dir, 'ext-03-importado.png') })
  const suco = await rest(`menu_items?client_id=eq.${CLIENT}&name=eq.${encodeURIComponent('Suco Natural (Demo)')}&select=ifood_id,status,price`)
  check('import criou Suco (pausado, com ifood_id)', suco?.[0]?.ifood_id === 'IF-ITEM-4' && suco[0].status === 'inactive', JSON.stringify(suco))
  const cl = await rest(`clients?id=eq.${CLIENT}&select=ifood_merchant_id`)
  check('cliente vinculado à loja do iFood', cl?.[0]?.ifood_merchant_id === 'MERCHANT-DEMO-1')

  // Pendências: combo do seed
  await panel.getByRole('button', { name: 'Pendências' }).click()
  const comboCard = panel.locator('.card', { hasText: 'Combo Clássico (Demo)' })
  await comboCard.waitFor({ timeout: 15000 })
  check('pendência do combo com itens', (await comboCard.textContent()).includes('Refrigerante Lata (Demo)'))
  await page.screenshot({ path: join(dir, 'ext-04-pendencias.png') })
  await comboCard.getByLabel('ID no iFood').fill('IF-COMBO-E2E')
  await comboCard.getByRole('button', { name: /Apliquei no iFood/ }).click()
  await panel.getByText(/confirmado no iFood/).waitFor({ timeout: 15000 })
  const combo = await rest(`menu_items?id=eq.eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee4&select=ifood_id,ifood_synced_at,updated_at`)
  check('combo marcado como aplicado (ifood_id + sincronizado)', combo?.[0]?.ifood_id === 'IF-COMBO-E2E' && combo[0].ifood_synced_at === combo[0].updated_at, JSON.stringify(combo))

  // ---- Aplicação automática -------------------------------------------------
  step('aplicação automática')
  // No Orvia: novo preço para o Astro Bacon (IF-ITEM-2) → vira pendência de atualização
  await rest(`menu_items?client_id=eq.${CLIENT}&ifood_id=eq.IF-ITEM-2`, { method: 'PATCH', body: JSON.stringify({ price: 44.9 }) })
  // Você edita 1 produto no portal (preço + descrição) → a extensão aprende
  const editStatus = await page.evaluate((fn) => window.simEdit('IF-ITEM-1', new Function('it', fn)), "it.price.value = 3390; it.status = 'UNAVAILABLE'; it.description = 'Hambúrguer 150g, queijo e molho da casa (editado)'")
  check('edição manual no portal simulado salvou', editStatus === 200)
  await panel.getByText(/Aprendi como o iFood salva/).waitFor({ timeout: 15000 })
  check('extensão aprendeu preço e descrição com 1 edição', /Preço/.test(await panel.getByText(/Aprendi como o iFood salva/).textContent()))
  const learned = await sw.evaluate(async () => (await chrome.storage.local.get('orvia.templates'))['orvia.templates'])
  check('moldes salvos sem token/cabeçalhos', Array.isArray(learned) && learned.length >= 2 && !JSON.stringify(learned).includes('sim-token'))
  await panel.getByRole('button', { name: /Atualizar lista|Carregar pendências/ }).click()
  const applyBtn = panel.getByRole('button', { name: /Aplicar automaticamente \(\d+\)/ })
  await applyBtn.waitFor({ timeout: 15000 })
  await page.screenshot({ path: join(dir, 'ext-06-auto-antes.png') })
  await panel.getByRole('button', { name: /^Simular/ }).click()
  await panel.getByText(/Simulação:/).waitFor({ timeout: 30000 })
  check('simulação não altera o iFood', portalDb['IF-ITEM-2'].price.value === 4150)
  await applyBtn.click()
  await panel.getByText(/aplicados no iFood\./).waitFor({ timeout: 60000 })
  await page.screenshot({ path: join(dir, 'ext-07-auto-depois.png') })
  const astro = portalDb['IF-ITEM-2']
  check('iFood (simulado) recebeu o preço novo do Orvia', astro.price.value === 4490, JSON.stringify(astro))
  check('iFood recebeu a descrição do Orvia', astro.description === 'Burger duplo com bacon crocante', astro.description)
  check('iFood recebeu o status do Orvia (em falta → pausado)', astro.status === 'UNAVAILABLE', astro.status)
  check('demais campos do item intactos', astro.extra.sku === 'SKU-IF-ITEM-2' && astro.name === 'Astro Bacon (Demo)')
  const astroOrvia = await rest(`menu_items?client_id=eq.${CLIENT}&ifood_id=eq.IF-ITEM-2&select=ifood_synced_at,updated_at`)
  check('Orvia marcou como sincronizado', astroOrvia?.[0]?.ifood_synced_at === astroOrvia?.[0]?.updated_at, JSON.stringify(astroOrvia))
  // Desfazer
  await panel.getByRole('button', { name: 'Desfazer último lote no iFood' }).click()
  await panel.getByText(/voltaram ao valor anterior/).waitFor({ timeout: 60000 })
  check('desfazer devolveu o preço anterior no iFood', portalDb['IF-ITEM-2'].price.value === 4150, JSON.stringify(portalDb['IF-ITEM-2'].price))

  // Análise → criar combo no Orvia
  await panel.getByRole('button', { name: 'Análise' }).click()
  await panel.getByRole('button', { name: 'Analisar cardápio' }).click()
  const createBtn = panel.getByRole('button', { name: 'Criar no Orvia (pausado)' }).first()
  const hasSuggestion = await createBtn.waitFor({ timeout: 8000 }).then(() => true, () => false)
  await page.screenshot({ path: join(dir, 'ext-05-analise.png') })
  if (hasSuggestion) {
    await createBtn.click()
    await panel.getByText(/criado no Orvia \(pausado\)/).waitFor({ timeout: 15000 })
    const combos = await rest(`menu_items?client_id=eq.${CLIENT}&kind=eq.combo&select=name,status`)
    check('combo sugerido criado no Orvia, pausado', combos.length >= 2 && combos.every((c) => c.status === 'inactive'), JSON.stringify(combos))
  } else {
    check('análise gerou sugestão de combo', false, 'nenhuma sugestão para a fixture')
  }
  check('sem erros JS no portal simulado', pageErrors.length === 0, pageErrors.join(' | '))
  console.log(`Capturas: ${dir}`)
} catch (error) {
  check(`exceção: ${String(error.message).split(/\r?\n/)[0]}`, false)
  let n = 0
  for (const p of context.pages()) await p.screenshot({ path: join(dir, `zz-erro-${n++}.png`) }).catch(() => undefined)
  console.log(`Capturas do erro: ${dir}`)
} finally {
  await context.close()
  await rest(`api_keys?id=eq.${row.id}`, { method: 'DELETE' })
  if (autoKeyId) await rest(`api_keys?id=eq.${autoKeyId}`, { method: 'DELETE' })
  for (const id of loginKeyIds) await rest(`api_keys?id=eq.${id}`, { method: 'DELETE' })
  if (createdUser) await fetch(`${SB}/auth/v1/admin/users/${createdUser}`, { method: 'DELETE', headers: H })
}
const failed = results.filter((r) => !r).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
