// E2E local da tela Extensões (usuário/chaves descartáveis no Supabase LOCAL).
// Cobre: relatório + prints (envio via POST /api/v1/optimizations), botão Baixar,
// "Sincronizar" (conectada → desconectada após revogar), exclusão em lote e
// chave recém-criada mascarada (só botão Copiar).
// Pré-requisitos: `npx supabase start` + migrations até 0005 e hub local apontando para ele.
//   HUB_URL=http://localhost:3100 LOCAL_API_URL=... LOCAL_SERVICE_ROLE_KEY=... OUT=<pasta fora do repo> node scripts/e2e-extensoes.mjs
import { chromium } from '@playwright/test'
import { createHash, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'

const HUB = process.env.HUB_URL ?? 'http://localhost:3100'
const SB = process.env.LOCAL_API_URL
const SR = process.env.LOCAL_SERVICE_ROLE_KEY
const OUT = process.env.OUT
for (const v of [HUB, SB]) if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(v ?? '')) throw new Error('somente local')
if (!SR || !OUT) throw new Error('LOCAL_SERVICE_ROLE_KEY e OUT obrigatórios')

const WS = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CLIENT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2' // Hamburgueria Astro (Demo)
const TAG = `e2e-ext-${randomBytes(3).toString('hex')}`
const H = { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }
const rest = async (path, init = {}) => {
  const r = await fetch(`${SB}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers ?? {}) } })
  const t = await r.text()
  return { status: r.status, body: t ? JSON.parse(t) : null }
}
let pass = 0
let fail = 0
const log = (ok, m) => {
  ok ? pass++ : fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${m}`)
}

const email = `${TAG}@orvia-demo.example`
const password = randomBytes(18).toString('base64url')
const u = await (await fetch(`${SB}/auth/v1/admin/users`, { method: 'POST', headers: H, body: JSON.stringify({ email, password, email_confirm: true }) })).json()
await rest('members', { method: 'POST', body: JSON.stringify({ workspace_id: WS, user_id: u.id, role: 'owner' }) })

const ext = (await rest('extensions?slug=eq.orvia-ifood&select=id')).body[0]
async function makeKey(name, extensionId = null) {
  const key = `ck_live_${randomBytes(32).toString('base64url')}`
  const r = await rest('api_keys', {
    method: 'POST',
    body: JSON.stringify({ workspace_id: WS, extension_id: extensionId, name, key_hash: createHash('sha256').update(key).digest('hex'), key_prefix: key.slice(0, 12), scopes: ['clientes:ler', 'catalogo:ler', 'catalogo:escrever'] }),
  })
  return { key, id: r.body[0].id }
}

// Estado anterior da instalação (para restaurar no fim)
const prevInstall = (await rest(`extension_installs?workspace_id=eq.${WS}&extension_id=eq.${ext.id}&select=*`)).body[0] ?? null
const extKey = await makeKey(`${TAG} extensão`, ext.id)
const bulkA = await makeKey(`${TAG} lote A`)
const bulkB = await makeKey(`${TAG} lote B`)
await rest('extension_installs?on_conflict=workspace_id,extension_id', {
  method: 'POST',
  headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
  body: JSON.stringify({ workspace_id: WS, extension_id: ext.id, api_key_id: extKey.id, version: '0.4.17', status: 'active', last_seen_at: new Date().toISOString() }),
})

// Otimização com 2 prints, enviada pela API como a extensão faz
const png = readFileSync(new URL('../packages/brand/logo/icon128.png', import.meta.url)).toString('base64')
const up = await fetch(`${HUB}/api/v1/optimizations`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-API-Key': extKey.key },
  body: JSON.stringify({
    client_id: CLIENT,
    plan_hash: TAG,
    version: 1,
    summary: `Resumo ${TAG}: descrições e preço ajustados.`,
    aborted: false,
    approved: [
      { id: 'a1', kind: 'item', item_name: 'Hambúrguer Teste', before: { price: 29.9 }, after: { price: 31.9 }, reason: 'margem', source: 'ia' },
      { id: 'a2', kind: 'item', item_name: 'Batata Teste', before: { description: 'antiga' }, after: { description: 'nova' }, reason: 'conversão', source: 'ia' },
    ],
    results: [
      { action_id: 'a1', status: 'ok', message: '' },
      { action_id: 'a2', status: 'erro', message: 'Campo não encontrado no iFood' },
    ],
    evidence: [
      { name: 'print 1.png', content_base64: png },
      { name: 'print 2.png', content_base64: png },
    ],
  }),
})
const upJson = await up.json().catch(() => null)
log(up.status === 201 && upJson?.data?.evidence === 2, `API /optimizations grava plano + 2 prints (${up.status})`)

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: HUB })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message.split(/\r?\n/)[0]))
try {
  await page.goto(`${HUB}/login`)
  await page.fill('input[type=email]', email)
  await page.fill('input[type=password]', password)
  await page.keyboard.press('Enter')
  await page.waitForURL(/\/a\//, { timeout: 30000 })
  await page.goto(`${HUB}/a/orvia-demo/extensoes`)
  await page.getByRole('heading', { name: 'Extensões', exact: true }).waitFor()

  // Relatório + prints
  log(await page.getByRole('heading', { name: /Relatório da extensão/ }).isVisible(), 'seção "Relatório da extensão" aparece com a extensão conectada')
  log(await page.getByText(`Resumo ${TAG}`).isVisible(), 'resumo da otimização visível (primeira expandida)')
  log(await page.getByText('Campo não encontrado no iFood').isVisible(), 'resultado por alteração (erro com mensagem)')
  const thumbs = page.locator('img[alt="print 1.png"], img[alt="print 2.png"]')
  log((await thumbs.count()) === 2, '2 prints exibidos')
  await thumbs.first().scrollIntoViewIfNeeded() // loading="lazy"
  const loaded = await page
    .waitForFunction(() => Array.from(document.querySelectorAll('img[alt$=".png"]')).every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 15000 })
    .then(() => true, () => false)
  log(loaded, 'print carrega da URL assinada (bucket privado)')
  const dl = page.getByRole('link', { name: 'Baixar print 1.png' })
  const href = await dl.getAttribute('href')
  const head = await fetch(href)
  log(head.ok && /attachment/i.test(head.headers.get('content-disposition') ?? ''), 'botão Baixar → Content-Disposition: attachment')
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), dl.click()])
  log(download.suggestedFilename() === 'print 1.png', `download disparado (${download.suggestedFilename()})`)
  await page.screenshot({ path: `${OUT}/ext-01-relatorio.png`, fullPage: true })
  await page.getByRole('button', { name: 'Ampliar print 2.png' }).click()
  log(await page.getByRole('dialog').getByRole('link', { name: 'Baixar print 2.png' }).isVisible(), 'botão Baixar também na visualização ampliada')
  await page.screenshot({ path: `${OUT}/ext-02-print-ampliado.png` })
  await page.getByRole('dialog').getByRole('button', { name: 'Fechar' }).last().click()

  // Sincronizar → conectada
  await page.getByRole('button', { name: 'Sincronizar' }).click()
  await page.getByText(/verificado/).waitFor({ timeout: 15000 })
  const st1 = await page.getByRole('status').filter({ hasText: 'verificado' }).innerText()
  log(/Conectada · último contato/.test(st1), 'Sincronizar: "Conectada"')
  log(!(await page.getByText('Sincronização simulada').isVisible().catch(() => false)), 'sem aviso de "simulada" nesta tela')

  // Revoga a chave da extensão por fora e sincroniza de novo → desconectada
  await rest(`api_keys?id=eq.${extKey.id}`, { method: 'PATCH', body: JSON.stringify({ revoked_at: new Date().toISOString() }) })
  await page.getByRole('button', { name: 'Sincronizar' }).click()
  await page.getByText(/Desconectada — a chave de acesso foi revogada/).first().waitFor({ timeout: 15000 })
  log(true, 'Sincronizar: "Desconectada" após revogar a chave')
  await page.screenshot({ path: `${OUT}/ext-03-sincronizar.png`, fullPage: true })

  // Exclusão em lote
  await page.getByLabel(`Selecionar ${TAG} lote A`).check()
  await page.getByLabel(`Selecionar ${TAG} lote B`).check()
  log(await page.getByText('2 selecionadas').isVisible(), 'seleção múltipla (2 selecionadas)')
  await page.getByRole('button', { name: 'Excluir (2)' }).click()
  await page.screenshot({ path: `${OUT}/ext-04-excluir-lote.png` })
  await page.getByRole('dialog').getByRole('button', { name: 'Excluir', exact: true }).click()
  await page.getByText('2 chaves excluídas.').waitFor({ timeout: 15000 })
  const left = (await rest(`api_keys?id=in.(${bulkA.id},${bulkB.id})&select=id`)).body
  log(left.length === 0, 'chaves excluídas do banco')
  await page.waitForTimeout(800)
  log(!(await page.getByText(`${TAG} lote A`).isVisible().catch(() => false)), 'chaves somem da tabela')

  // Chave nova: mascarada, só Copiar
  await page.getByRole('button', { name: 'Gerar chave' }).first().click()
  await page.getByPlaceholder('Ex.: Chrome do escritório').fill(`${TAG} nova`)
  await page.getByRole('dialog').getByRole('button', { name: 'Gerar chave' }).click()
  await page.getByText('Chave criada').waitFor({ timeout: 15000 })
  const html = await page.content()
  log(!/ck_live_[A-Za-z0-9_-]{43}/.test(html), 'chave completa NÃO aparece na página (mascarada)')
  await page.getByRole('button', { name: 'Copiar chave' }).click()
  await page.getByRole('button', { name: 'Copiada' }).waitFor({ timeout: 5000 })
  const clip = await page.evaluate(() => navigator.clipboard.readText())
  log(/^ck_live_[A-Za-z0-9_-]{43}$/.test(clip), 'Copiar coloca a chave completa na área de transferência')
  const created = (await rest(`api_keys?name=eq.${encodeURIComponent(`${TAG} nova`)}&select=key_hash`)).body[0]
  log(created?.key_hash === createHash('sha256').update(clip).digest('hex'), 'chave copiada é a mesma salva (hash confere)')
  await page.screenshot({ path: `${OUT}/ext-05-chave-mascarada.png` })
  await page.getByRole('button', { name: 'Concluir' }).click()

  // Mobile
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${HUB}/a/orvia-demo/extensoes`)
  await page.getByRole('heading', { name: 'Extensões', exact: true }).waitFor()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
  log(!overflow, 'sem rolagem horizontal em 390px')
  await page.screenshot({ path: `${OUT}/ext-06-mobile.png`, fullPage: true })
} catch (e) {
  log(false, `exceção: ${e.message.split('\n')[0]}`)
  await page.screenshot({ path: `${OUT}/ext-zz-erro.png`, fullPage: true })
} finally {
  log(errors.length === 0, `sem erros JS na página ${errors.join(' | ').slice(0, 300)}`)
  await browser.close()
  // limpeza (só o que este teste criou)
  const opt = (await rest(`menu_optimizations?plan_hash=eq.${TAG}&select=id`)).body ?? []
  for (const o of opt) {
    const ev = (await rest(`menu_optimization_evidence?optimization_id=eq.${o.id}&select=storage_path`)).body ?? []
    if (ev.length) await fetch(`${SB}/storage/v1/object/optimization-evidence`, { method: 'DELETE', headers: H, body: JSON.stringify({ prefixes: ev.map((e) => e.storage_path) }) })
    await rest(`menu_optimizations?id=eq.${o.id}`, { method: 'DELETE' })
  }
  if (prevInstall) {
    const { id: _id, ...rest0 } = prevInstall
    await rest(`extension_installs?workspace_id=eq.${WS}&extension_id=eq.${ext.id}`, { method: 'PATCH', body: JSON.stringify(rest0) })
  } else {
    await rest(`extension_installs?workspace_id=eq.${WS}&extension_id=eq.${ext.id}`, { method: 'DELETE' })
  }
  await rest(`api_keys?name=like.${encodeURIComponent(TAG)}*`, { method: 'DELETE' })
  await fetch(`${SB}/auth/v1/admin/users/${u.id}`, { method: 'DELETE', headers: H })
  console.log(`\n${pass}/${pass + fail} passaram`)
  process.exit(fail ? 1 : 0)
}
