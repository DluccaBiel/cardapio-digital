// E2E local dos Relatórios nos grupos do WhatsApp — NUNCA a Meta/WhatsApp reais.
//
//   1) simulador da Graph API em 127.0.0.1:4590 (campanhas de vendas, mensagens e visitas ao perfil)
//   2) painel: prévias reais por objetivo, grupo do cliente, juntar/separar, PNG, copiar, salvar,
//      marcar como enviado, enviar no grupo, disparo em lote, histórico, agendamento, modelo
//   3) API do robô: PNG por chave de API e execução do agendamento (/api/v1/reports/run)
//   4) robô (reports.mjs) com WhatsApp SIMULADO: lê grupos e envia a fila (imagem + legenda)
//
// Pré-requisitos: `npx supabase db reset` e o hub em http://localhost:3100 apontando para o Supabase
// local, com (só no processo): NEXT_DIST_DIR=.next-e2e META_GRAPH_BASE_URL=http://127.0.0.1:4590
// META_ACCESS_TOKEN=e2e-token META_BUSINESS_ID=111111111111 (modo legado, sem OAuth).
//   LOCAL_API_URL=... LOCAL_SERVICE_ROLE_KEY=... OUT=<pasta fora do repo> node scripts/e2e-relatorios.mjs
import { chromium } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { createHash, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createReports } from '../apps/whatsapp-worker/src/reports.mjs'

const HUB = 'http://localhost:3100'
const SB = process.env.LOCAL_API_URL
const SR = process.env.LOCAL_SERVICE_ROLE_KEY
const OUT = process.env.OUT
if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(SB ?? '')) throw new Error('somente local')
const WS = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CLIENT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1' // Pizzaria do Ze (Demo)
const G1 = '120363111111111111@g.us'
const G2 = '120363222222222222@g.us'

let pass = 0
let failed = 0
const log = (ok, m) => {
  ok ? pass++ : failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${m}`)
}

// ---------------------------------------------------------------------------
// 1) Simulador da Graph API
// ---------------------------------------------------------------------------
const act = (n) => [{ action_type: 'offsite_conversion.fb_pixel_purchase', value: String(n) }, { action_type: 'omni_purchase', value: String(n + 5) }]
const mock = createServer((req, res) => {
  const u = new URL(req.url, 'http://x')
  const path = u.pathname.replace(/^\/v\d+\.\d+/, '')
  const json = (d) => (res.writeHead(200, { 'Content-Type': 'application/json' }), res.end(JSON.stringify(d)))
  if (u.searchParams.get('access_token') !== 'e2e-token') return res.writeHead(400).end('{"error":{"message":"token"}}')
  if (path === '/act_9101/campaigns')
    return json({
      data: [
        { id: '9001', name: 'Vendas Pizza', effective_status: 'ACTIVE', objective: 'OUTCOME_SALES' },
        { id: '9002', name: 'Conversas WhatsApp', effective_status: 'ACTIVE', objective: 'OUTCOME_ENGAGEMENT' },
        { id: '9003', name: 'Visitas Perfil IG', effective_status: 'ACTIVE', objective: 'OUTCOME_TRAFFIC' },
        { id: '9004', name: 'Antiga pausada', effective_status: 'PAUSED', objective: 'OUTCOME_SALES' },
      ],
    })
  if (path === '/act_9101/adsets')
    return json({
      data: [
        { campaign_id: '9001', optimization_goal: 'OFFSITE_CONVERSIONS', destination_type: 'WEBSITE' },
        { campaign_id: '9002', optimization_goal: 'CONVERSATIONS', destination_type: 'WHATSAPP' },
        { campaign_id: '9003', optimization_goal: 'VISIT_INSTAGRAM_PROFILE', destination_type: 'INSTAGRAM_PROFILE' },
      ],
    })
  if (path === '/act_9101/insights') {
    const level = u.searchParams.get('level')
    // período anterior da "semana passada" começa 13+ dias atrás (o atual, no máx. 13)
    const since = JSON.parse(u.searchParams.get('time_range') ?? '{}').since ?? '9999-12-31'
    const prev = Date.now() - Date.parse(`${since}T12:00:00Z`) >= 13.5 * 86_400_000
    if (level === 'campaign')
      return json({
        data: [
          { campaign_id: '9001', campaign_name: 'Vendas Pizza', spend: prev ? '200' : '300', reach: '4000', impressions: '9000', clicks: '400', inline_link_clicks: '120', outbound_clicks: [{ action_type: 'outbound_click', value: '110' }], video_p50_watched_actions: [{ action_type: 'video_view', value: '800' }], actions: [...act(prev ? 8 : 12), { action_type: 'landing_page_view', value: '90' }, { action_type: 'offsite_conversion.fb_pixel_add_to_cart', value: '30' }, { action_type: 'post_reaction', value: '55' }, { action_type: 'video_view', value: '2100' }], action_values: [{ action_type: 'offsite_conversion.fb_pixel_purchase', value: prev ? '900' : '1500' }] },
          { campaign_id: '9002', campaign_name: 'Conversas WhatsApp', spend: '100', reach: '2500', impressions: '5000', actions: [{ action_type: 'onsite_conversion.messaging_conversation_started_7d', value: prev ? '30' : '40' }] },
          { campaign_id: '9003', campaign_name: 'Visitas Perfil IG', spend: '50', reach: '3000', impressions: '6000', actions: [{ action_type: 'instagram_profile_visit', value: '210' }, { action_type: 'link_click', value: '90' }] },
        ],
      })
    if (level === 'ad')
      return json({ data: [{ ad_id: '7001', ad_name: 'Vídeo pizza', campaign_id: '9001', spend: '150', actions: act(7) }, { ad_id: '7002', ad_name: 'Carrossel', campaign_id: '9001', spend: '150', actions: act(5) }] })
    return json({ data: [{ reach: '7600', impressions: '20000' }] })
  }
  if (path === '/' && u.searchParams.get('ids'))
    return json(Object.fromEntries(u.searchParams.get('ids').split(',').map((id) => [id, { creative: { thumbnail_url: `https://scontent.fbcdn.net/e2e/${id}.jpg` } }])))
  res.writeHead(404).end('{"error":{"message":"rota do simulador"}}')
})
await new Promise((r) => mock.listen(4590, '127.0.0.1', r))

// ---------------------------------------------------------------------------
// Dados locais (usuário descartável, conta, sessão e grupos)
// ---------------------------------------------------------------------------
const H = { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }
const rest = (p, init = {}) => fetch(`${SB}/rest/v1/${p}`, { headers: H, ...init })
const db = createClient(SB, SR, { auth: { persistSession: false } })
const email = `e2e-rel-${Date.now()}@undercut-demo.example`
const password = randomBytes(18).toString('base64url')
const user = await (await fetch(`${SB}/auth/v1/admin/users`, { method: 'POST', headers: H, body: JSON.stringify({ email, password, email_confirm: true }) })).json()
await rest('members', { method: 'POST', body: JSON.stringify({ workspace_id: WS, user_id: user.id, role: 'owner' }) })
const [acc] = await (
  await rest('ad_accounts', { method: 'POST', body: JSON.stringify({ workspace_id: WS, client_id: CLIENT, external_account_id: 'act_9101', name: 'CA Pizzaria E2E', balance: 700, funding_kind: 'pix', spend_7d: 1400, is_watched: true }) })
).json()
await db.from('whatsapp_sessions').upsert({ workspace_id: WS, status: 'ready', desired_state: 'connected', phone: '5511999990000', display_name: 'Agência E2E', worker_seen_at: new Date().toISOString() }, { onConflict: 'workspace_id' })
await db.from('whatsapp_groups').insert([
  { workspace_id: WS, jid: G1, name: 'Pizzaria do Zé + Agência', participants: 5 },
  { workspace_id: WS, jid: G2, name: 'Outro cliente', participants: 3 },
])

// ---------------------------------------------------------------------------
// 2) Painel
// ---------------------------------------------------------------------------
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'], acceptDownloads: true })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message.split(/\r?\n/)[0]))
const toast = (re) => page.getByRole('status').filter({ hasText: re }).waitFor({ timeout: 30000 }).then(() => true, () => false)
try {
  await page.goto(`${HUB}/login`)
  await page.fill('input[type=email]', email)
  await page.fill('input[type=password]', password)
  await page.keyboard.press('Enter')
  await page.waitForURL(/\/a\//, { timeout: 30000 })

  await page.goto(`${HUB}/a/undercut-demo/relatorios`)
  await page.getByRole('heading', { name: 'Relatórios' }).waitFor({ timeout: 60000 })
  log(await page.getByText('Pronto', { exact: true }).waitFor({ timeout: 15000 }).then(() => true, () => false), 'WhatsApp: status real "Pronto" + número')
  log(await page.getByText(/2 grupo\(s\)/).isVisible(), 'WhatsApp: mostra os grupos sincronizados')
  await page.getByRole('button', { name: /Grupos \(2\)/ }).click()
  log(await page.getByText('Outro cliente').first().isVisible(), 'lista dos grupos do número conectado aparece no Relatórios')
  await page.getByRole('button', { name: 'Ocultar grupos' }).click()

  const row = page.locator('li', { hasText: 'Pizzaria do Ze (Demo)' })
  const loaded = await row.getByText(/12 compras/).waitFor({ timeout: 60000 }).then(() => true, () => false)
  log(loaded, 'prévia real: vendas = 12 compras do PIXEL (não 17 do omni)')
  const card = page.locator('section', { hasText: 'Prévia' })
  log(await card.getByText('Conversas iniciadas').first().isVisible(), 'prévia: bloco de mensagens (conversas iniciadas)')
  log(await card.getByText('Visitas ao perfil').first().isVisible(), 'prévia: bloco de visitas ao perfil')
  log(await card.getByText(/ROAS 5,00x/).first().isVisible(), 'prévia: ROAS só das vendas (1500/300)')
  log(await card.getByText(/Saldo Pix: R\$\s?700,00/).first().isVisible(), 'prévia: saldo Pix da conta')
  await page.screenshot({ path: `${OUT}/rel-01-gerador.png`, fullPage: true })

  await row.getByLabel('Grupo do WhatsApp').selectOption(G1)
  await page.waitForTimeout(1500)
  const tg = await (await rest(`report_targets?ad_account_id=eq.${acc.id}&select=group_jid,campaign_mode`)).json()
  log(tg[0]?.group_jid === G1, 'grupo do cliente salvo (report_targets)')

  await row.getByRole('radio', { name: 'Separar' }).click()
  await card.getByText('Vendas Pizza').first().waitFor({ timeout: 10000 })
  log(true, 'separar: um bloco por campanha')
  await row.getByRole('button', { name: /Todas \(3\)/ }).click()
  await row.getByLabel(/Conversas WhatsApp/).check().catch(() => row.locator('label', { hasText: 'Conversas WhatsApp' }).locator('input').check())
  await page.waitForTimeout(1500)
  log(await card.getByText('Vendas Pizza').count() === 0 && (await card.getByText('Conversas WhatsApp').count()) > 0, 'só a campanha escolhida no relatório')
  await row.locator('label', { hasText: 'Conversas WhatsApp' }).locator('input').uncheck()
  await row.getByRole('radio', { name: 'Juntar' }).click()
  await page.waitForTimeout(1500)

  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), card.getByRole('button', { name: /Baixar imagem/ }).click()])
  const file = `${OUT}/rel-card.png`
  await dl.saveAs(file)
  const buf = readFileSync(file)
  log(buf.subarray(1, 4).toString() === 'PNG' && buf.length > 20000, `Baixar imagem: PNG real (${Math.round(buf.length / 1024)} KB)`)

  await card.getByRole('button', { name: /Copiar mensagem/ }).click()
  log(await toast(/Mensagem copiada/), 'Copiar mensagem')
  const clip = await page.evaluate(() => navigator.clipboard.readText())
  log(
    clip.includes('📊 *RELATÓRIO DE RESULTADOS — Pizzaria do Ze (Demo)*') && clip.includes('• Compras: 12') && clip.includes('• Conversas iniciadas: 40') && clip.includes('• Visitas ao perfil: 210'),
    'mensagem nova: uma seção por objetivo',
  )
  log(/• Cliques no link: 120/.test(clip) && /• Adicionar ao carrinho: 30/.test(clip) && /• Visualizações: 2\.100/.test(clip) && /✅ \*Pontos fortes:\*/.test(clip), 'mensagem nova: cliques, conversões, vídeo e pontos fortes')
  log((await card.getByRole('link', { name: /Abrir no WhatsApp/ }).getAttribute('href'))?.startsWith('https://api.whatsapp.com/send?text=') ?? false, 'Abrir no WhatsApp com o texto')

  await card.getByRole('button', { name: /Salvar relatório/ }).click()
  log(await toast(/salvo no histórico/), 'Salvar relatório')
  await card.getByRole('button', { name: /Marcar como enviado/ }).click()
  log(await toast(/Marcado como enviado/), 'Marcar como enviado')
  await card.getByRole('button', { name: /Enviar no grupo/ }).click()
  log(await toast(/Na fila do robô/), 'Enviar no grupo → fila do robô')

  await row.getByLabel('Selecionar Pizzaria do Ze (Demo)').check()
  await page.getByRole('button', { name: /Disparar nos grupos/ }).click()
  log(await toast(/1 relatório\(s\) na fila/), 'Disparar nos grupos (selecionados + intervalo)')
  await page.screenshot({ path: `${OUT}/rel-02-detalhe.png`, fullPage: true })

  await page.getByRole('radio', { name: /Histórico/ }).click()
  await page.getByRole('table').waitFor()
  const statuses = await page.locator('tbody tr td:nth-child(5) span').allInnerTexts()
  log(statuses.filter((s) => /enviado/i.test(s)).length === 1 && statuses.filter((s) => /agendado/i.test(s)).length === 2, `histórico real: ${statuses.join(', ')}`)
  await page.screenshot({ path: `${OUT}/rel-03-historico.png`, fullPage: true })

  await page.getByRole('radio', { name: 'Agendamentos' }).click()
  await page.getByRole('button', { name: 'Novo agendamento' }).click()
  await page.locator('label', { hasText: 'Pizzaria do Ze (Demo)' }).locator('input').check()
  await page.getByRole('button', { name: 'Sex' }).click()
  await page.getByRole('button', { name: /Salvar agendamento/ }).click()
  log(await toast(/Agendado — próximo envio/), 'Agendamento salvo com próximo envio')
  await page.screenshot({ path: `${OUT}/rel-04-agendamentos.png`, fullPage: true })

  await page.getByRole('radio', { name: 'Modelos' }).click()
  await page.getByRole('switch', { name: 'Saldo da conta' }).click()
  await page.getByRole('button', { name: /Salvar modelo/ }).click()
  log(await toast(/Modelo salvo/), 'Modelo salvo')
  const st = await (await rest(`report_settings?workspace_id=eq.${WS}&select=blocks`)).json()
  log(st[0]?.blocks?.balance === false, 'modelo grava blocos no banco')
  log(errors.length === 0, `sem erros de JavaScript na página${errors.length ? `: ${errors.join(' | ')}` : ''}`)
} finally {
  await browser.close()
}

// ---------------------------------------------------------------------------
// 3) API do robô
// ---------------------------------------------------------------------------
const { data: ext } = await db.from('extensions').select('id').eq('slug', 'undercut-sdr').maybeSingle()
const key = `ck_live_${randomBytes(32).toString('base64url')}`
await db.from('api_keys').insert({ workspace_id: WS, extension_id: ext?.id ?? null, name: 'E2E relatórios', key_hash: createHash('sha256').update(key).digest('hex'), key_prefix: key.slice(0, 12), scopes: ['relatorios:ler', 'relatorios:escrever'] })
const { data: queued } = await db.from('reports').select('id, scheduled_at').eq('workspace_id', WS).eq('status', 'agendado').order('scheduled_at')
const png = await fetch(`${HUB}/api/v1/reports/${queued[0].id}/card`, { headers: { 'X-API-Key': key } })
log(png.ok && png.headers.get('content-type') === 'image/png', 'API: PNG do relatório com chave do robô')
log((await fetch(`${HUB}/api/v1/reports/${queued[0].id}/card`)).status === 401, 'API: PNG sem chave → 401')

const { data: sch } = await db.from('report_schedules').select('id').eq('workspace_id', WS).limit(1).single()
await db.from('report_schedules').update({ next_run_at: new Date(Date.now() - 60_000).toISOString() }).eq('id', sch.id)
const run = await (await fetch(`${HUB}/api/v1/reports/run`, { method: 'POST', headers: { 'X-API-Key': key, 'Content-Type': 'application/json' }, body: JSON.stringify({ schedule_id: sch.id }) })).json()
log(run?.data?.action === 'queued' && run.data.queued === 1, `agendamento executado: ${JSON.stringify(run?.data ?? run)}`)
const again = await (await fetch(`${HUB}/api/v1/reports/run`, { method: 'POST', headers: { 'X-API-Key': key, 'Content-Type': 'application/json' }, body: JSON.stringify({ schedule_id: sch.id }) })).json()
log(again?.data?.action === 'skip', 'agendamento não roda duas vezes no mesmo horário')

// ---------------------------------------------------------------------------
// 4) Robô com WhatsApp simulado
// ---------------------------------------------------------------------------
const sent = []
const fakeSock = {
  groupFetchAllParticipating: async () => ({
    [G1]: { id: G1, subject: 'Pizzaria do Zé + Agência', participants: [{}, {}, {}, {}, {}, {}] },
    '120363333333333333@g.us': { id: '120363333333333333@g.us', subject: 'Grupo novo', participants: [{}, {}] },
  }),
  groupMetadata: async (jid) => (jid === G1 ? { id: jid } : Promise.reject(new Error('not-authorized'))),
  sendMessage: async (jid, content) => sent.push({ jid, content }),
}
await db.from('whatsapp_sessions').update({ groups_sync_requested_at: new Date().toISOString() }).eq('workspace_id', WS)
const pace = { nextAt: 0 }
const robot = createReports({ db, WS, log: () => {}, getSock: () => fakeSock, isReady: () => true, hub: { key, base: HUB }, pace })
// fila: tudo "vence" agora para o teste
await db.from('reports').update({ scheduled_at: new Date(Date.now() - 1000).toISOString() }).eq('workspace_id', WS).eq('status', 'agendado')
for (let i = 0; i < 4; i++) {
  pace.nextAt = 0
  await robot.tick()
}
const { data: groups } = await db.from('whatsapp_groups').select('jid, participants').eq('workspace_id', WS)
log(groups.length === 2 && groups.some((g) => g.jid === G1 && g.participants === 6) && !groups.some((g) => g.jid === G2), 'robô: grupos atualizados (novo entra, quem saiu some)')
const { data: after } = await db.from('reports').select('status').eq('workspace_id', WS)
const done = after.filter((r) => r.status === 'enviado').length
const images = sent.filter((s) => Buffer.isBuffer(s.content.image))
const texts = sent.filter((s) => typeof s.content.text === 'string')
log(done === 4 && images.length === 3, `robô: fila enviada (${images.length} relatórios; ${done} enviados no total)`)
log(
  sent.every((s) => s.jid === G1) && images.every((s) => s.content.caption.includes('RELATÓRIO DE RESULTADOS')) && texts.length === 3 && texts.every((s) => s.content.text.includes('Pontos fortes') || s.content.text.includes('Investimento')),
  'robô: imagem PNG + relatório completo em texto (legenda longa não é cortada)',
)

// limpeza
await db.from('reports').delete().eq('workspace_id', WS)
await db.from('report_schedules').delete().eq('workspace_id', WS)
await db.from('report_settings').delete().eq('workspace_id', WS)
await db.from('whatsapp_groups').delete().eq('workspace_id', WS)
await db.from('api_keys').delete().eq('name', 'E2E relatórios')
await db.from('ad_accounts').delete().eq('id', acc.id)
await rest(`members?user_id=eq.${user.id}`, { method: 'DELETE' })
await fetch(`${SB}/auth/v1/admin/users/${user.id}`, { method: 'DELETE', headers: H })
mock.close()
console.log(`\n${pass}/${pass + failed} ok`)
process.exit(failed ? 1 : 0)
