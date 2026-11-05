/** Formatação pt-BR usada no hub. */

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

export function formatBRL(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return 'R$ 0,00'
  return BRL.format(value)
}

export function formatComlpact(value: number): string {
  return new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

export function relativeChange(iso: string): { label: string; alert: boolean } {
  const now = Date.now()
  const then = new Date(iso).getTime()
  const days = Math.floor((now - then) / 86_400_000)
  if (days <= 0) return { label: 'hoje', alert: false }
  if (days === 1) return { label: 'ontem', alert: false }
  return { label: `há ${days} dias`, alert: days > 14 }
}

/** ISO week atual no formato '2026-W45'. */
export function currentISOWeek(d = new Date()): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const dayNum = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`
}

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
export function monthLabel(iso: string): string {
  const d = new Date(iso)
  return `${MESES[d.getUTCMonth()]} de ${d.getUTCFullYear()}`
}

/** Data curta dd/MM. */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' })
}
