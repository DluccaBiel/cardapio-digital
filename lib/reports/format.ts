/**
 * Relatório: períodos, montagem do payload e mensagem do WhatsApp — funções PURAS
 * (rodam no servidor, no navegador e no teste). A consulta à Meta fica em generate.ts.
 */
import { buildBlocks, KIND_LABEL, type Block, type CampaignResult, type Range, type TopAd } from './blocks'

export type { Range } from './blocks'

export const PERIOD_KEYS = ['last', '7d', '14d', '30d', 'month', 'lastMonth', 'yesterday'] as const
export type PeriodKey = (typeof PERIOD_KEYS)[number]
export const PERIOD_LABEL: Record<PeriodKey, string> = {
  last: 'Semana passada (seg-dom)',
  '7d': 'Últimos 7 dias',
  '14d': 'Últimos 14 dias',
  '30d': 'Últimos 30 dias',
  month: 'Este mês',
  lastMonth: 'Mês passado',
  yesterday: 'Ontem',
}

/** Data (AAAA-MM-DD) em São Paulo. */
export function spDay(now: Date = new Date(), offsetDays = 0): string {
  const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  return offsetDays ? shift(d, offsetDays) : d
}
export function shift(day: string, days: number): string {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
const diffDays = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000)

/** Período e o anterior de mesmo tamanho, no fuso de São Paulo. */
export function ranges(period: PeriodKey, now = new Date()): { cur: Range; prev: Range } {
  const today = spDay(now)
  const yesterday = shift(today, -1)
  const back = (n: number): Range => ({ since: shift(yesterday, -(n - 1)), until: yesterday })
  let cur: Range
  if (period === 'last') {
    const dow = new Date(`${today}T12:00:00Z`).getUTCDay()
    const lastSunday = shift(today, -(dow === 0 ? 7 : dow))
    cur = { since: shift(lastSunday, -6), until: lastSunday }
  } else if (period === '14d') cur = back(14)
  else if (period === '30d') cur = back(30)
  else if (period === 'month') cur = { since: `${today.slice(0, 8)}01`, until: today }
  else if (period === 'lastMonth') {
    const lastPrev = shift(`${today.slice(0, 8)}01`, -1)
    cur = { since: `${lastPrev.slice(0, 8)}01`, until: lastPrev }
  } else if (period === 'yesterday') cur = { since: yesterday, until: yesterday }
  else cur = back(7)
  if (period === 'lastMonth') {
    const lp = shift(cur.since, -1)
    return { cur, prev: { since: `${lp.slice(0, 8)}01`, until: lp } }
  }
  const len = diffDays(cur.since, cur.until) + 1
  return { cur, prev: { since: shift(cur.since, -len), until: shift(cur.since, -1) } }
}

const br = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`
export const rangeLabel = (r: Range) => (r.since === r.until ? br(r.since) : `${br(r.since)} a ${br(r.until)}`)
export const money = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
export const int = (v: number) => Math.round(v).toLocaleString('pt-BR')
const delta = (v: number | null) => (v == null ? '' : ` (${v > 0 ? '▲' : v < 0 ? '▼' : '='} ${Math.abs(v)}%)`)
const r2 = (n: number) => Math.round(n * 100) / 100

export type Show = { general: boolean; byObjective: boolean; topCreatives: boolean; balance: boolean }
export const DEFAULT_SHOW: Show = { general: true, byObjective: true, topCreatives: true, balance: true }
export type CampaignMode = 'merged' | 'separate'

export type ReportSource = {
  adAccountId: string
  clientId: string | null
  title: string // nome do cliente (ou da conta)
  accountName: string
  accountId: string // act_...
  workspaceName: string
  periodKey: PeriodKey
  period: Range
  previous: Range | null
  campaigns: CampaignResult[]
  reach: number
  impressions: number
  topAds: TopAd[]
  balance: { kind: 'pix' | 'card' | 'unknown'; available: number; debt: number; unbilled: number; daysLeft: number | null }
  generatedAt: string
}

export type ReportPayload = ReportSource & {
  version: 1
  periodLabel: string
  previousLabel: string | null
  mode: CampaignMode
  selected: string[]
  show: Show
  totals: { spend: number; reach: number; impressions: number; prevSpend: number | null; spendDelta: number | null }
  blocks: Block[]
}

/** Monta (ou remonta, ao trocar juntar/separar/campanhas/blocos) o relatório a partir dos dados da Meta. */
export function composeReport(src: ReportSource, opts: { mode: CampaignMode; selected: string[]; show: Show }): ReportPayload {
  const selected = opts.selected.filter((id) => src.campaigns.some((c) => c.id === id))
  const chosen = selected.length ? src.campaigns.filter((c) => selected.includes(c.id)) : src.campaigns
  const spend = chosen.reduce((t, c) => t + c.spend, 0)
  const hasPrev = Boolean(src.previous)
  const prevSpend = hasPrev ? chosen.reduce((t, c) => t + (c.prev?.spend ?? 0), 0) : null
  const reach = selected.length ? chosen.reduce((t, c) => t + c.reach, 0) : src.reach
  const impressions = selected.length ? chosen.reduce((t, c) => t + c.impressions, 0) : src.impressions
  return {
    ...src,
    version: 1,
    topAds: selected.length ? src.topAds.filter((a) => selected.includes(a.campaignId)) : src.topAds,
    periodLabel: rangeLabel(src.period),
    previousLabel: src.previous ? rangeLabel(src.previous) : null,
    mode: opts.mode,
    selected,
    show: opts.show,
    totals: {
      spend: r2(spend),
      reach: Math.round(reach),
      impressions: Math.round(impressions),
      prevSpend: prevSpend == null ? null : r2(prevSpend),
      spendDelta: prevSpend && prevSpend > 0 ? Math.round(((spend - prevSpend) / prevSpend) * 100) : null,
    },
    blocks: buildBlocks(src.campaigns, opts.mode, selected),
  }
}

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const dayName = (d: string, withYear: boolean) => `${Number(d.slice(8, 10))} de ${MONTHS[Number(d.slice(5, 7)) - 1]}${withYear ? ` de ${d.slice(0, 4)}` : ''}`

/** "18 de outubro a 16 de novembro de 2026" (período por extenso). */
export function rangeLong(r: Range): string {
  if (r.since === r.until) return dayName(r.since, true)
  const sameYear = r.since.slice(0, 4) === r.until.slice(0, 4)
  if (sameYear && r.since.slice(5, 7) === r.until.slice(5, 7)) return `${Number(r.since.slice(8, 10))} a ${dayName(r.until, true)}`
  return `${dayName(r.since, !sameYear)} a ${dayName(r.until, true)}`
}

const pctTxt = (v: number) => `${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
const xTxt = (v: number) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: v >= 10 ? 1 : 2 })}x`
const ratio = (a: number, b: number) => (b > 0 && a > 0 ? a / b : null)
const pctOf = (a: number, b: number) => (b > 0 && a > 0 ? (a / b) * 100 : null)

type Line = string | null
const section = (title: string, lines: Line[]) => {
  const ok = lines.filter((l): l is string => Boolean(l))
  return ok.length ? ['', title, ...ok] : []
}
/** Linha "• Rótulo: valor" só quando o valor existe (> 0). */
const item = (label: string, v: number | null | undefined, fmt: (n: number) => string = int, extra = '') => (v != null && v > 0 ? `• ${label}: ${fmt(v)}${extra}` : null)

/** Seções completas de um objetivo (foco no resultado daquele objetivo). */
function blockSections(b: Block, show: Show): string[] {
  const m = b.metrics
  const k = b.kind
  const main: Line[] = [`• Investimento: ${money(b.spend)}`]
  if (k === 'sales') {
    main.push(item('Receita Ads', b.revenue, money), item('ROAS', b.roas, xTxt))
    main.push(`• Compras: ${int(b.result)}${delta(b.deltaResult)}`, item('CPA', b.costPerResult, money, delta(b.deltaCost)))
  } else {
    main.push(`• ${b.resultLabel}: ${int(b.result)}${delta(b.deltaResult)}`, item(b.costLabel, b.costPerResult, money, delta(b.deltaCost)))
  }
  const out = section(k === 'sales' ? '💰 *Investimento & Retorno*' : '💰 *Investimento & Resultado*', main)
  if (!m) return out

  if (show.general) {
    const freq = m.reach > 0 ? m.impressions / m.reach : 0
    out.push(
      ...section('👥 *Alcance & Impressões*', [
        item('Alcance', m.reach, (v) => `${int(v)} pessoas`),
        item('Impressões', m.impressions),
        item('Frequência', freq >= 1 ? freq : null, (v) => v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })),
      ]),
    )
  }
  out.push(
    ...section('🖱️ *Cliques & Engajamento*', [
      item('Cliques totais', m.clicks),
      item('Cliques no link', m.linkClicks),
      item('Cliques de saída', m.outboundClicks),
      item('CTR', pctOf(m.linkClicks, m.impressions), pctTxt),
      item('CPC', ratio(b.spend, m.clicks), money),
      item('Custo por clique no link', ratio(b.spend, m.linkClicks), money),
      k === 'engagement' ? null : item('Engajamentos', m.engagements),
      item('Reações', m.reactions),
      item('Comentários', m.comments),
      item('Salvamentos', m.saves),
      item('Compartilhamentos', m.shares),
      item('Taxa de engajamento', pctOf(m.engagements, m.impressions), pctTxt),
    ]),
  )
  out.push(
    ...section('📱 *Perfil & Comunidade*', [
      k === 'profile' ? null : item('Visitas ao perfil', m.profileVisits),
      item('Novos seguidores', m.follows),
      k === 'messages' ? null : item('Conversas iniciadas', m.conversations),
      k === 'traffic' ? null : item('Landing page views', m.landingViews),
      item('Taxa de LP view', pctOf(m.landingViews, m.linkClicks), pctTxt),
    ]),
  )
  out.push(
    ...section('🎯 *Conversões*', [
      k === 'sales' ? null : item('Compras', m.purchases),
      item('Adicionar ao carrinho', m.addToCart),
      item('Checkout iniciado', m.checkout),
      k === 'leads' ? null : item('Cadastros', m.leads),
    ]),
  )
  out.push(...section('🎬 *Vídeo*', [item('Visualizações', m.videoViews), item('50% assistido', m.video50), item('75% assistido', m.video75), item('100% assistido', m.video100)]))
  return out
}

/** Pontos fortes e de atenção calculados dos números (no máx. 3 de cada). */
export function highlights(p: ReportPayload): { strong: string[]; attention: string[] } {
  const strong: string[] = []
  const attention: string[] = []
  for (const b of p.blocks) {
    const name = p.blocks.length > 1 ? ` em ${b.title}` : ''
    const m = b.metrics
    if (b.kind === 'sales' && b.roas != null && b.spend > 0) {
      if (b.roas >= 4) strong.push(`ROAS excelente (${xTxt(b.roas)})${name} — retorno muito acima da média.`)
      else if (b.roas >= 2) strong.push(`ROAS saudável (${xTxt(b.roas)})${name}.`)
      else if (b.roas < 1) attention.push(`ROAS abaixo de 1x${name} — o investimento ainda supera a receita.`)
    }
    if (b.deltaResult != null && b.deltaResult >= 15) strong.push(`${b.resultLabel}${name}: +${b.deltaResult}% em relação ao período anterior.`)
    if (b.deltaResult != null && b.deltaResult <= -15) attention.push(`${b.resultLabel}${name}: -${Math.abs(b.deltaResult)}% em relação ao período anterior.`)
    if (b.deltaCost != null && b.deltaCost <= -10) strong.push(`${b.costLabel}${name} caiu ${Math.abs(b.deltaCost)}%.`)
    if (b.deltaCost != null && b.deltaCost >= 20) attention.push(`${b.costLabel}${name} subiu ${b.deltaCost}%.`)
    if (m && m.impressions >= 2000) {
      const ctr = (m.linkClicks / m.impressions) * 100
      if (ctr >= 1.5) strong.push(`CTR de ${pctTxt(ctr)}${name} — os anúncios estão chamando atenção.`)
      else if (ctr < 0.7 && b.kind !== 'messages' && b.kind !== 'awareness') attention.push(`CTR baixo (${pctTxt(ctr)})${name} — vale testar novos criativos.`)
      const freq = m.reach > 0 ? m.impressions / m.reach : 0
      if (freq > 3.5) attention.push(`Frequência alta (${freq.toLocaleString('pt-BR', { maximumFractionDigits: 1 })})${name} — o público pode estar saturando.`)
    }
    if (m && m.linkClicks >= 50 && m.landingViews > 0) {
      const lp = (m.landingViews / m.linkClicks) * 100
      if (lp >= 60) strong.push(`Boa taxa de carregamento da página (${pctTxt(lp)} dos cliques).`)
      else if (lp < 40) attention.push(`Só ${pctTxt(lp)} dos cliques carregam a página — conferir a velocidade do site.`)
    }
  }
  if (p.show.balance && p.balance.kind === 'pix' && p.balance.daysLeft != null && p.balance.daysLeft <= 3) attention.push(`Saldo para ~${p.balance.daysLeft} dia(s) — programar a recarga.`)
  if (p.show.balance && p.balance.debt > 0) attention.push(`Conta com pagamento pendente (${money(p.balance.debt)}).`)
  return { strong: Array.from(new Set(strong)).slice(0, 3), attention: Array.from(new Set(attention)).slice(0, 3) }
}

/** Mensagem do WhatsApp (negrito com *…*), uma seção completa por objetivo. */
export function reportMessage(p: ReportPayload): string {
  const blocks = p.show.byObjective ? p.blocks : []
  const objectives = Array.from(new Set(p.blocks.map((b) => b.kind))).map((k) => `${KIND_LABEL[k].emoji} ${KIND_LABEL[k].title}`)
  const lines: string[] = [
    `📊 *RELATÓRIO DE RESULTADOS — ${p.title}*`,
    `📅 Período: ${rangeLong(p.period)}`,
    ...(p.previous ? [`↔️ Comparado a: ${rangeLong(p.previous)}`] : []),
    ...(objectives.length ? [`🎯 Objetivo: ${objectives.join(' + ')}`] : []),
  ]
  if (!p.show.byObjective && p.show.general) {
    lines.push(
      ...section('💰 *Investimento*', [`• Investimento: ${money(p.totals.spend)}${delta(p.totals.spendDelta)}`, item('Alcance', p.totals.reach, (v) => `${int(v)} pessoas`), item('Impressões', p.totals.impressions)]),
    )
  }
  for (const b of blocks) {
    if (blocks.length > 1) lines.push('', '━━━━━━━━━━━━━━', `${KIND_LABEL[b.kind].emoji} *${b.title.toUpperCase()}*`)
    lines.push(...blockSections(b, p.show))
  }
  if (p.show.byObjective && blocks.length === 0) lines.push('', 'Sem campanhas com investimento no período.')
  if (blocks.length > 1 && p.show.general) lines.push('', '━━━━━━━━━━━━━━', `💰 *Total investido:* ${money(p.totals.spend)}${delta(p.totals.spendDelta)}`)

  if (p.show.topCreatives && p.topAds[0] && p.topAds[0].result > 0) {
    const a = p.topAds[0]
    lines.push('', `🏆 *Melhor anúncio:* ${a.name} (${int(a.result)} ${KIND_LABEL[a.kind].result.toLowerCase()})`)
  }
  if (p.show.balance && p.balance.debt <= 0) {
    if (p.balance.kind === 'pix') lines.push('', `🏦 *Saldo (Pix):* ${money(p.balance.available)}${p.balance.daysLeft != null ? ` · dura ~${p.balance.daysLeft} dias` : ''}`)
    else if (p.balance.kind === 'card') lines.push('', '💳 *Pagamento:* cartão (cobrança automática)')
  }
  const h = highlights(p)
  if (h.strong.length) lines.push('', '✅ *Pontos fortes:*', ...h.strong.map((s) => `• ${s}`))
  if (h.attention.length) lines.push('', '⚠️ *Pontos de atenção:*', ...h.attention.map((s) => `• ${s}`))
  lines.push('', 'Qualquer dúvida, estou à disposição! 👊')
  return lines.join('\n').slice(0, 3900)
}

/** Resultado principal (para listas/prévias pequenas). */
export function headline(p: ReportPayload): string {
  const b = p.blocks[0]
  if (!b) return 'Sem investimento no período'
  return `${int(b.result)} ${b.resultLabel.toLowerCase()}${b.costPerResult != null ? ` · ${money(b.costPerResult)} cada` : ''}`
}

// ---------------------------------------------------------------------------
// Agenda (São Paulo = UTC-3 fixo, sem horário de verão desde 2019)
// ---------------------------------------------------------------------------
/** Próxima execução (ISO) depois de `from`, nos dias (0 = domingo) e horário (HH:MM) dados. */
export function nextRunAt(days: number[], time: string, from: Date = new Date()): string | null {
  const hhmm = time.slice(0, 5)
  if (!/^\d{2}:\d{2}$/.test(hhmm) || days.length === 0) return null
  for (let i = 0; i <= 7; i++) {
    const day = spDay(from, i)
    const dow = new Date(`${day}T12:00:00Z`).getUTCDay()
    const at = Date.parse(`${day}T${hhmm}:00-03:00`)
    if (days.includes(dow) && at > from.getTime()) return new Date(at).toISOString()
  }
  return null
}

/** Horários de envio escalonados: o 1º em `start`, os demais com intervalo aleatório entre min e max (s). */
export function staggered(start: Date, n: number, minS: number, maxS: number, rand: () => number = Math.random): string[] {
  const lo = Math.max(20, Math.min(minS, maxS))
  const hi = Math.max(lo, maxS)
  const out: string[] = []
  let t = start.getTime()
  for (let i = 0; i < n; i++) {
    if (i > 0) t += Math.round((lo + rand() * (hi - lo)) * 1000)
    out.push(new Date(t).toISOString())
  }
  return out
}
