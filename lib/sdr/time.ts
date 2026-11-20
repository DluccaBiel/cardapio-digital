/** Início do dia de hoje em São Paulo (UTC-03:00, sem horário de verão) como ISO. */
export function spDayStart(now = new Date()): string {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  return new Date(`${ymd}T00:00:00-03:00`).toISOString()
}
