// E2E local do painel Cardápio/Extensões (usuário descartável no Supabase LOCAL).
// Pré-requisitos: `npx supabase db reset`, hub em http://localhost:3100 apontando
// para o Supabase local e `node supabase/tests/api_menu.mjs` já executado
// (ele importa a "Batata Frita (Demo)" e o grupo "Molhos" usados aqui).
//   LOCAL_API_URL=... LOCAL_SERVICE_ROLE_KEY=... OUT=<pasta fora do repo> node scripts/e2e-cardapio.mjs
import { chromium } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const HUB = 'http://localhost:3100'
const SB = process.env.LOCAL_API_URL
const SR = process.env.LOCAL_SERVICE_ROLE_KEY
const OUT = process.env.OUT
if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(SB ?? '')) throw new Error('somente local')

const email = `e2e-${Date.now()}@orvia-demo.example`
const password = randomBytes(18).toString('base64url')
const H = { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json' }
const u = await (await fetch(`${SB}/auth/v1/admin/users`, { method: 'POST', headers: H, body: JSON.stringify({ email, password, email_confirm: true }) })).json()
await fetch(`${SB}/rest/v1/members`, { method: 'POST', headers: H, body: JSON.stringify({ workspace_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', user_id: u.id, role: 'owner' }) })

const log = (ok, m) => console.log(`${ok ? 'PASS' : 'FAIL'}  ${m}`)
const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push(`${new URL(page.url()).pathname}: ${e.message.split(/\r?\n/)[0]}`))
try {
  await page.goto(`${HUB}/login`)
  await page.fill('input[type=email]', email)
  await page.fill('input[type=password]', password)
  await page.keyboard.press('Enter')
  await page.waitForURL(/\/a\//, { timeout: 30000 })

  await page.goto(`${HUB}/a/orvia-demo/cardapio?cliente=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2`)
  await page.getByRole('heading', { name: 'Cardápio' }).waitFor()
  await page.screenshot({ path: `${OUT}/01-produtos.png`, fullPage: true })
  log(await page.getByText('Batata Frita (Demo)').first().isVisible(), 'produtos importados aparecem')

  // Editar preço inline
  const row = page.locator('tr', { hasText: 'Refrigerante Lata (Demo)' })
  await row.getByTitle('Clique para editar o preço').click()
  await row.getByLabel('Novo preço').fill('6,50')
  await row.getByLabel('Novo preço').press('Enter')
  await page.getByText('Preço atualizado.').waitFor({ timeout: 15000 })
  const saved = await row.getByText(/6,50/).waitFor({ timeout: 15000 }).then(() => true, () => false)
  log(saved, 'preço inline salvo (R$ 6,50)')

  // Combos
  await page.getByRole('tab', { name: /Combos/ }).click()
  await page.screenshot({ path: `${OUT}/02-combos.png`, fullPage: true })
  await page.getByRole('button', { name: 'Novo combo' }).click()
  await page.getByPlaceholder('Buscar produto para adicionar…').fill('Astro')
  await page.getByRole('button', { name: /Astro Bacon/ }).click()
  await page.getByPlaceholder('Buscar produto para adicionar…').fill('Refri')
  await page.getByRole('button', { name: /Refrigerante/ }).click()
  await page.getByPlaceholder('Ex.: Combo Clássico').fill('Combo Astro (E2E)')
  await page.getByRole('button', { name: 'Gerar dos itens' }).click()
  await page.getByRole('button', { name: /Sugerir preço/ }).click()
  await page.screenshot({ path: `${OUT}/03-novo-combo.png` })
  await page.getByRole('button', { name: 'Criar combo' }).click()
  await page.getByText('Combo criado (pendente para o iFood).').waitFor({ timeout: 15000 })
  await page.waitForTimeout(1500)
  log(await page.getByRole('heading', { name: 'Combo Astro (E2E)' }).isVisible(), 'combo criado pela UI')

  // Complementos
  await page.getByRole('tab', { name: /Complementos/ }).click()
  const molhos = page.locator('article', { hasText: 'Molhos' })
  await molhos.getByLabel('Nome da nova opção').fill('Barbecue')
  await molhos.getByLabel('Preço adicional').fill('3,50')
  await molhos.getByLabel('Preço adicional').press('Enter')
  await page.getByText('Opção adicionada.').waitFor({ timeout: 15000 })
  await page.waitForTimeout(1200)
  log(await molhos.getByText('Barbecue').isVisible(), 'opção de complemento adicionada')
  await page.screenshot({ path: `${OUT}/04-complementos.png`, fullPage: true })

  // Sincronização
  await page.getByRole('tab', { name: /Sincronização iFood/ }).click()
  await page.screenshot({ path: `${OUT}/05-sync.png`, fullPage: true })
  log(await page.getByText('Combo Astro (E2E)').isVisible(), 'combo novo na fila do iFood')

  // Extensões: gerar chave
  await page.goto(`${HUB}/a/orvia-demo/extensoes`)
  await page.getByRole('button', { name: 'Gerar chave' }).click()
  await page.getByPlaceholder('Ex.: Chrome do escritório').fill('Chave E2E')
  await page.getByRole('dialog').getByRole('button', { name: 'Gerar chave' }).click()
  await page.getByText('Copie agora').waitFor({ timeout: 15000 })
  const keyText = await page.locator('code').textContent()
  log(/^ck_live_[A-Za-z0-9_-]{43}$/.test(keyText ?? ''), 'chave exibida uma vez no formato certo')
  await page.locator('code').evaluate((el) => (el.textContent = 'ck_live_••••••••••••••••(oculta na captura)'))
  await page.screenshot({ path: `${OUT}/06-chave.png` })
  await page.getByRole('button', { name: 'Concluir' }).click()
  await page.waitForTimeout(1500)
  log(await page.getByText('Chave E2E').isVisible(), 'chave listada (só prefixo)')
  await page.screenshot({ path: `${OUT}/07-extensoes.png`, fullPage: true })

  // Mobile
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${HUB}/a/orvia-demo/cardapio?cliente=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2`)
  await page.getByRole('heading', { name: 'Cardápio' }).waitFor()
  await page.screenshot({ path: `${OUT}/08-mobile.png`, fullPage: true })
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
  log(!overflow, 'sem rolagem horizontal no corpo em 390px')
} catch (e) {
  log(false, `exceção: ${e.message.split('\n')[0]}`)
  await page.screenshot({ path: `${OUT}/zz-erro.png`, fullPage: true })
} finally {
  log(errors.length === 0, `sem erros JS na página ${errors.length ? errors.join(' | ').slice(0, 300) : ''}`)
  await browser.close()
  await fetch(`${SB}/rest/v1/api_keys?name=eq.Chave%20E2E`, { method: 'DELETE', headers: H })
  await fetch(`${SB}/auth/v1/admin/users/${u.id}`, { method: 'DELETE', headers: H })
}
