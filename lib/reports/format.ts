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

/** Mensagem do WhatsApp (negrito com *…*). */
export function reportMessage(p: ReportPayload): string {
  const lines: string[] = [`*Relatório de tráfego — ${p.title}*`, `📅 ${p.periodLabel}${p.previousLabel ? ` (comparado a ${p.previousLabel})` : ''}`]
  if (p.show.general) {
    lines.push('', `💰 Investimento: *${money(p.totals.spend)}*${delta(p.totals.spendDelta)}`)
    if (p.totals.reach > 0) lines.push(`👥 Alcance: ${int(p.totals.reach)} pessoas`)
  }
  if (p.show.byObjective) {
    for (const b of p.blocks) {
      lines.push('', `${KIND_LABEL[b.kind].emoji} *${b.title}* — ${money(b.spend)}`)
      lines.push(`• ${b.resultLabel}: *${int(b.result)}*${delta(b.deltaResult)}`)
      if (b.costPerResult != null) lines.push(`• ${b.costLabel}: ${money(b.costPerResult)}${delta(b.deltaCost)}`)
      if (b.kind === 'sales' && b.revenue > 0) lines.push(`• Faturamento: ${money(b.revenue)} · ROAS ${(b.roas ?? 0).toFixed(2).replace('.', ',')}x`)
    }
    if (p.blocks.length === 0) lines.push('', 'Sem campanhas com investimento no período.')
  }
  if (p.show.topCreatives && p.topAds[0] && p.topAds[0].result > 0) {
    const a = p.topAds[0]
    lines.push('', `🏆 Melhor anúncio: ${a.name} (${int(a.result)} ${KIND_LABEL[a.kind].result.toLowerCase()})`)
  }
  if (p.show.balance) {
    if (p.balance.debt > 0) lines.push('', `⚠️ Conta com pagamento pendente: ${money(p.balance.debt)}`)
    else if (p.balance.kind === 'pix') lines.push('', `🏦 Saldo (Pix): ${money(p.balance.available)}${p.balance.daysLeft != null ? ` · dura ~${p.balance.daysLeft} dias` : ''}`)
    else if (p.balance.kind === 'card') lines.push('', '💳 Pagamento no cartão (cobrança automática)')
  }
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
