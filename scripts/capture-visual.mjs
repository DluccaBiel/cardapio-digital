/**
 * Captura das telas da fase visual (dados fictícios) para comparação.
 * Uso: node scripts/capture-visual.mjs
 * Requer o dev server em http://localhost:3000 com NEXT_PUBLIC_DEMO_UI=1.
 */
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const BASE = process.env.CAPTURE_BASE ?? 'http://localhost:3000'
const OUT = 'docs/referencia/comparacao'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()

async function newPage(width, height, mobile = false) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    isMobile: mobile,
    hasTouch: mobile,
    reducedMotion: 'reduce',
  })
  const page = await context.newPage()
  return { context, page }
}

async function open(page, path) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'load' })
  await page.waitForTimeout(1800)
  await page.evaluate(() => document.fonts?.ready)
  await page.waitForTimeout(300)
}

const desktop = await newPage(1915, 1030)

await open(desktop.page, '/demo/visao-geral')
await desktop.page.screenshot({ path: `${OUT}/01-visao-geral-topo.png` })

// Estado 2: rolagem vertical com cabeçalho fixo alinhado ao topo da tabela
await desktop.page.evaluate(() => {
  const main = document.getElementById('hub-main')
  const table = document.querySelector('table[aria-label="Lista de clientes"]')
  if (main && table) main.scrollTop = main.scrollTop + table.getBoundingClientRect().top - 132
})
await desktop.page.waitForTimeout(600)
await desktop.page.screenshot({ path: `${OUT}/02-visao-geral-tabela.png` })

// Estado 3: mesma rolagem + navegação horizontal até o fim
await desktop.page.evaluate(() => {
  const table = document.querySelector('table[aria-label="Lista de clientes"]')
  const scroller = table?.parentElement
  if (scroller) scroller.scrollLeft = scroller.scrollWidth
})
await desktop.page.waitForTimeout(700)
await desktop.page.screenshot({ path: `${OUT}/03-visao-geral-horizontal.png` })

// Estado extra: paleta de busca (Ctrl K)
await desktop.page.keyboard.press('Control+k')
await desktop.page.waitForTimeout(600)
await desktop.page.screenshot({ path: `${OUT}/11-busca-ctrl-k.png` })
await desktop.page.keyboard.press('Escape')

await open(desktop.page, '/demo/contas')
await desktop.page.screenshot({ path: `${OUT}/04-contas.png` })

await open(desktop.page, '/demo/relatorios')
await desktop.page.screenshot({ path: `${OUT}/05-relatorios-topo.png` })

await desktop.page.evaluate(() => {
  const main = document.getElementById('hub-main')
  if (main) main.scrollTop = 520
})
await desktop.page.waitForTimeout(500)
await desktop.page.screenshot({ path: `${OUT}/06-relatorios-mensagem.png` })

await open(desktop.page, '/demo/cardapio')
await desktop.page.screenshot({ path: `${OUT}/07-cardapio-placeholder.png` })

await desktop.context.close()

const laptop = await newPage(1366, 768)
await open(laptop.page, '/demo/visao-geral')
await laptop.page.screenshot({ path: `${OUT}/08-1366x768.png` })
await laptop.context.close()

const mobile = await newPage(390, 844, true)
await open(mobile.page, '/demo/visao-geral')
await mobile.page.screenshot({ path: `${OUT}/09-mobile-390.png` })
await mobile.page.getByRole('button', { name: 'Abrir menu' }).click()
await mobile.page.waitForTimeout(500)
await mobile.page.screenshot({ path: `${OUT}/10-mobile-menu.png` })
await mobile.context.close()

await browser.close()
console.log('Capturas salvas em', OUT)
