/** Intervalo de datas da Visão geral (fuso de São Paulo). Funções puras. */

export type RangePeriod = '' | 'today' | 'yesterday' | 'last7' | 'prev7' | 'last30' | 'custom'
export type DateRange = { since: string; until: string; label: string }

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

export function spToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

export function addDays(day: string, delta: number): string {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + delta)
  return d.toISOString().slice(0, 10)
}

const br = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`

export function isDay(v: string | undefined | null): v is string {
  return !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`))
}

/**
 * `month` = primeiro dia do mês escolhido (yyyy-mm-01). Sem período: o mês inteiro (até hoje, se for o atual).
 */
export function computeRange(period: RangePeriod, month: string, custom: { from?: string; to?: string } = {}, now: Date = new Date()): DateRange {
  const today = spToday(now)
  switch (period) {
    case 'today':
      return { since: today, until: today, label: 'hoje' }
    case 'yesterday': {
      const d = addDays(today, -1)
      return { since: d, until: d, label: 'ontem' }
    }
    case 'last7':
      return { since: addDays(today, -6), until: today, label: 'últimos 7 dias' }
    case 'prev7':
      return { since: addDays(today, -13), until: addDays(today, -7), label: 'semana anterior' }
    case 'last30':
      return { since: addDays(today, -29), until: today, label: 'últimos 30 dias' }
    case 'custom': {
      if (isDay(custom.from) && isDay(custom.to)) {
        const [since, until] = custom.from <= custom.to ? [custom.from, custom.to] : [custom.to, custom.from]
        return { since, until: until > today ? today : until, label: `${br(since)} a ${br(until)}` }
      }
      break
    }
  }
  const first = month.slice(0, 7) + '-01'
  const next = new Date(`${first}T12:00:00Z`)
  next.setUTCMonth(next.getUTCMonth() + 1)
  const last = addDays(next.toISOString().slice(0, 10), -1)
  const until = last > today ? today : last
  const m = Number(first.slice(5, 7)) - 1
  return { since: first, until: until < first ? first : until, label: `${MESES[m]} de ${first.slice(0, 4)}` }
}

/** true quando o intervalo é o mês corrente "padrão" (já coberto pelos dados sincronizados). */
export function isDefaultMonth(period: RangePeriod, month: string, now: Date = new Date()): boolean {
  return period === '' && month.slice(0, 7) === spToday(now).slice(0, 7)
}
