// E2E LOCAL da extensão "Undercut · SDR WhatsApp" (apps/extensions/undercut-sdr).
// Carrega a extensão num Chromium do Playwright e serve uma página FALSA em
// https://web.whatsapp.com (mesma estrutura: #main header, [data-id] e campo de digitação).
// Nunca toca o WhatsApp real nem produção: hub local (:3100) + Supabase local.
//
//   LOCAL_API_URL=... LOCAL_SERVICE_ROLE_KEY=... node scripts/e2e-sdr-extension.mjs
import { chromium } from '@playwright/test'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomBytes } from 'node:crypto'

const HUB = 'http://localhost:3100'
const SB = process.env.LOCAL_API_URL
const SR = process.env.LOCAL_SERVICE_ROLE_KEY
if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(SB ?? '') || !SR) throw new Error('somente Supabase LOCAL')
const WS_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const PHONE = `55199${String(Date.now()).slice(-8)}`
const OUT = process.env.OUT

let pass = 0
let fail = 0
const log = (ok, m, d = '') => {
  ok ? pass++ : fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${m}${!ok && d ? `  → ${d}` : ''}`)
}
const H = { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json' }
const rest = async (p, init = {}) => {
  const r = await fetch(`${SB}/rest/v1/${p}`, { ...init, headers: { ...H, Prefer: 'return=representation', ...(init.headers ?? {}) } })
  const t = await r.text()
  return t ? JSON.parse(t) : null
}

// --- Extensão em pasta temporária, com localhost liberado (só no teste) -----------------
const extDir = mkdtempSync(path.join(tmpdir(), 'uc-sdr-ext-'))
cpSync(path.resolve('apps/extensions/undercut-sdr'), extDir, { recursive: true })
const manifest = JSON.parse(readFileSync(path.join(extDir, 'manifest.json'), 'utf8'))
manifest.host_permissions.push('http://localhost/*')
writeFileSync(path.join(extDir, 'manifest.json'), JSON.stringify(manifest))

// --- WhatsApp Web falso ---------------------------------------------------------------------
const waPage = (name, withId) => `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;font-family:sans-serif">
<div id="app"><div id="main">
  <header><span dir="auto" title="${name}">${name}</span></header>
  <div class="msgs">${withId ? `<div data-id="false_${PHONE}@c.us_3EB0ABC"><span>Oi, vi o anúncio</span></div>` : ''}</div>
  <footer><div contenteditable="true" role="textbox" style="border:1px solid #ccc;min-height:30px;width:400px"></div></footer>
</div></div>
<script>
  window.__sent = []
  document.querySelector('footer [contenteditable]').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); window.__sent.push(e.target.innerText); e.target.innerText = '' }
  })
</script></body></html>`

// --- Usuário + chave da extensão SDR (login real pela API) -------------------------------------
const email = `sdr-ext-${Date.now()}@undercut-demo.example`
const password = randomBytes(18).toString('base64url')
const user = await (await fetch(`${SB}/auth/v1/admin/users`, { method: 'POST', headers: H, body: JSON.stringify({ email, password, email_confirm: true }) })).json()
await rest('members', { method: 'POST', body: JSON.stringify({ workspace_id: WS_ID, user_id: user.id, role: 'owner' }) })

const ctx = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
  viewport: { width: 1400, height: 900 },
})
let leadId = null
try {
  let [sw] = ctx.serviceWorkers()
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 20000 })
  // O worker pode aparecer antes das APIs chrome.* estarem prontas: espera ficar utilizável.
  for (let i = 0; i < 40; i++) {
    const ready = await sw.evaluate(() => typeof chrome !== 'undefined' && !!chrome.storage?.local).catch(() => false)
    if (ready) break
    await new Promise((r) => setTimeout(r, 250))
    ;[sw] = ctx.serviceWorkers().length ? ctx.serviceWorkers().slice(-1) : [sw]
  }
  const extId = sw.url().split('/')[2]
  log(!!extId, 'extensão carregada (service worker ativo)')

  // Login pelo popup (fluxo real: e-mail + senha → chave só do SDR)
  await sw.evaluate(async (hub) => chrome.storage.local.set({ hubUrl: hub }), HUB)
  const popup = await ctx.newPage()
  await popup.goto(`chrome-extension://${extId}/popup.html`)
  await popup.fill('#email', email)
  await popup.fill('#password', password)
  await popup.click('#doLogin')
  await popup.waitForSelector('#app:not([hidden])', { timeout: 30000 })
  const stored = await sw.evaluate(() => chrome.storage.local.get(['apiKey', 'workspace']))
  log(/^ck_live_/.test(stored.apiKey ?? '') && stored.workspace?.slug === 'undercut-demo', 'login no popup guarda a chave (senha não fica salva)')
  const pwdStored = JSON.stringify(await sw.evaluate(() => chrome.storage.local.get(null)))
  log(!pwdStored.includes(password), 'senha não aparece no armazenamento da extensão')

  // WhatsApp falso com conversa de número desconhecido
  const page = await ctx.newPage()
  await page.route('https://web.whatsapp.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: waPage('Pizzaria Extensão E2E', true) }))
  await page.goto('https://web.whatsapp.com/')
  const panel = page.locator('#undercut-sdr-panel')
  await panel.locator('text=Adicionar ao SDR').waitFor({ timeout: 30000 })
  log(true, 'conversa de número desconhecido: painel oferece "Adicionar ao SDR"')
  log(await panel.locator(`text=+${PHONE}`).isVisible(), 'telefone lido do id das mensagens do WhatsApp')

  // Adiciona como lead que "me procurou" (sem 1º contato automático)
  await panel.locator('input[type=checkbox]').check()
  await panel.locator('text=Adicionar ao SDR').click()
  await panel.locator('select').waitFor({ timeout: 20000 })
  const leadRows = await rest(`prospect_leads?workspace_id=eq.${WS_ID}&phone=eq.${PHONE}&select=id,stage,source`)
  leadId = leadRows?.[0]?.id
  log(leadRows?.[0]?.stage === 'respondeu' && leadRows?.[0]?.source === 'whatsapp', 'lead criado pela extensão em "Respondeu" (origem WhatsApp)', JSON.stringify(leadRows))
  log((await panel.locator('select').inputValue()) === 'respondeu', 'ficha mostra a etapa no funil')

  // Resposta rápida → campo de digitação (não envia sozinho)
  await panel.locator('button', { hasText: 'Qualificar' }).click()
  const typed = await page.locator('footer [contenteditable]').innerText()
  log(typed.includes('Pizzaria Extensão E2E') && (await page.evaluate(() => window.__sent.length)) === 0, 'resposta rápida entra no campo com {nome} e NÃO é enviada sozinha', typed)

  // Atalho #proposta + Enter: muda a etapa e não envia
  await page.locator('footer [contenteditable]').evaluate((el) => (el.innerText = ''))
  await page.locator('footer [contenteditable]').click()
  await page.keyboard.type('#proposta')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(2500)
  const afterCmd = await rest(`prospect_leads?id=eq.${leadId}&select=stage`)
  const sentCmd = await page.evaluate(() => window.__sent)
  log(afterCmd?.[0]?.stage === 'proposta' && sentCmd.length === 0, 'atalho #proposta muda a etapa e não é enviado ao cliente', JSON.stringify({ afterCmd, sentCmd }))
  await panel.locator('text=Proposta enviada').first().waitFor({ timeout: 15000 }).then(() => log(true, 'etapa "proposta" mostra o follow-up "Proposta enviada"'), () => log(false, 'etapa "proposta" mostra o follow-up "Proposta enviada"'))

  // Valor previsto
  await panel.locator('input[type=number]').fill('2400')
  await panel.locator('input[type=number]').press('Tab')
  await page.waitForTimeout(2000)
  log(Number((await rest(`prospect_leads?id=eq.${leadId}&select=deal_value`))?.[0]?.deal_value) === 2400, 'valor previsto salvo pelo painel')

  // Nota com lembrete
  await panel.locator('textarea[placeholder="Nota ou lembrete…"]').fill('Mandar case da hamburgueria')
  await panel.locator('button', { hasText: 'Salvar nota' }).click()
  await panel.locator('text=Mandar case da hamburgueria').waitFor({ timeout: 15000 })
  log(true, 'nota salva e listada na ficha')

  // IA: liga no workspace, sugestão aguardando aprovação → editar e enviar
  await rest(`sdr_settings?workspace_id=eq.${WS_ID}`, { method: 'PATCH', body: JSON.stringify({ ai_enabled: true }) })
  await rest('sdr_tasks', { method: 'POST', body: JSON.stringify({ workspace_id: WS_ID, lead_id: leadId, kind: 'ai_reply', body: 'Sugestão original da IA', status: 'aguardando_aprovacao', respects_window: false }) })
  await panel.locator('button[title="Recarregar"]').click()
  await panel.locator('text=Sugestões da IA').waitFor({ timeout: 15000 })
  await panel.locator('.card textarea').first().fill('Sugestão editada por mim')
  await panel.locator('button', { hasText: 'Enviar' }).first().click()
  await page.waitForTimeout(2500)
  const tk = await rest(`sdr_tasks?lead_id=eq.${leadId}&kind=eq.ai_reply&select=status,body`)
  log(tk?.[0]?.status === 'pendente' && tk?.[0]?.body === 'Sugestão editada por mim', 'sugestão da IA editada e aprovada → vai para a fila do robô', JSON.stringify(tk))

  // Assumir conversa (IA para neste lead)
  await panel.locator('button', { hasText: 'Assumir conversa' }).click()
  await page.waitForTimeout(2000)
  log((await rest(`prospect_leads?id=eq.${leadId}&select=ai_paused`))?.[0]?.ai_paused === true, '"Assumir conversa" pausa a IA neste lead')
  if (OUT) await page.screenshot({ path: `${OUT}/sdr-painel.png` })

  // Contato salvo sem número visível → pede o telefone
  const page2 = await ctx.newPage()
  await page2.route('https://web.whatsapp.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: waPage('Fulano Sem Número', false) }))
  await page2.goto('https://web.whatsapp.com/')
  await page2.locator('#undercut-sdr-panel').locator('text=Informe o telefone').waitFor({ timeout: 20000 }).then(() => log(true, 'sem número legível: painel pede o telefone (nada é adivinhado)'), () => log(false, 'sem número legível: painel pede o telefone'))

  // Popup lista o que precisa de você
  await rest(`prospect_leads?id=eq.${leadId}`, { method: 'PATCH', body: JSON.stringify({ needs_human: true, handoff_reason: 'Pediu para falar com uma pessoa' }) })
  await popup.reload()
  await popup.locator('#human li', { hasText: 'Pizzaria Extensão E2E' }).waitFor({ timeout: 20000 }).then(() => log(true, 'popup: lista leads que precisam de você'), () => log(false, 'popup: lista leads que precisam de você'))
  const badge = await sw.evaluate(() => chrome.action.getBadgeText({}))
  log(Number(badge) >= 1, `ícone mostra contador de pendências (${badge})`)
} catch (e) {
  log(false, `erro inesperado: ${e.message}`)
} finally {
  await ctx.close()
  rmSync(extDir, { recursive: true, force: true })
  if (leadId) await rest(`prospect_leads?id=eq.${leadId}`, { method: 'DELETE' })
  await rest(`api_keys?created_by=eq.${user.id}`, { method: 'DELETE' })
  await rest(`members?user_id=eq.${user.id}`, { method: 'DELETE' })
  await fetch(`${SB}/auth/v1/admin/users/${user.id}`, { method: 'DELETE', headers: H })
  await rest(`sdr_settings?workspace_id=eq.${WS_ID}`, { method: 'DELETE' })
  await rest(`sdr_cadences?workspace_id=eq.${WS_ID}`, { method: 'DELETE' })
  await rest(`sdr_quick_replies?workspace_id=eq.${WS_ID}`, { method: 'DELETE' })
  console.log(`\n${pass} PASS / ${fail} FAIL`)
  process.exit(fail ? 1 : 0)
}
