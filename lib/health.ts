/**
 * Saúde do cliente (bolinha de status na Visão geral e no topo do cliente).
 *   vermelho  → saldo devedor, saldo para ≤ 3 dias ou término dos anúncios em ≤ 3 dias
 *   verde     → métricas tranquilas
 *   azul      → conta de anúncio sem cliente vinculado (sempre no fim da lista)
 *   cinza     → cliente sem conta vinculada
 */
export type Health = 'risk' | 'ok' | 'unlinked' | 'none'

export const RISK_DAYS = 3

/** Dias inteiros entre hoje (fuso de SP) e a data (yyyy-mm-dd ou ISO). */
export function daysUntil(date: string, now = new Date()): number {
  const day = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
  const target = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : day(new Date(date))
  return Math.round((Date.parse(`${target}T12:00:00Z`) - Date.parse(`${day(now)}T12:00:00Z`)) / 86_400_000)
}

export function clientHealth(input: {
  unlinked?: boolean
  accountsCount: number
  balance: number | null
  daysLeft: number | null
  termination: string | null
  now?: Date
}): { health: Health; reason: string } {
  if (input.unlinked) return { health: 'unlinked', reason: 'Conta de anúncio sem cliente' }
  if (input.accountsCount === 0) return { health: 'none', reason: 'Sem conta de anúncio vinculada' }
  const reasons: string[] = []
  if (input.balance !== null && input.balance < 0) reasons.push('Saldo devedor')
  else if (input.daysLeft !== null && input.daysLeft >= 0 && input.daysLeft <= RISK_DAYS) reasons.push(`Saldo baixo (~${Math.max(0, Math.round(input.daysLeft))}d)`)
  if (input.termination) {
    const d = daysUntil(input.termination, input.now)
    if (d >= 0 && d <= RISK_DAYS) reasons.push(d === 0 ? 'Termina hoje' : `Termina em ${d}d`)
  }
  return reasons.length ? { health: 'risk', reason: reasons.join(' · ') } : { health: 'ok', reason: 'Métricas tranquilas' }
}

export const HEALTH_COLOR: Record<Health, string> = {
  risk: '#FF3B47',
  ok: '#34D399',
  unlinked: '#3B82F6',
  none: '#6E6A66',
}

export const HEALTH_LABEL: Record<Health, string> = {
  risk: 'Atenção',
  ok: 'Tranquilo',
  unlinked: 'Sem cliente',
  none: 'Sem conta',
}
