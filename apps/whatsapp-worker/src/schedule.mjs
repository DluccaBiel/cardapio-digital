// Regras puras do robô de disparos (testadas em tests/whatsapp-worker.test.ts).
// Fuso: America/Sao_Paulo (sem horário de verão desde 2019 → UTC-03:00).

const FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  weekday: 'short',
})
const DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

/** Data (YYYY-MM-DD), hora (HH:MM) e dia da semana (0=domingo) em São Paulo. */
export function spParts(now = new Date()) {
  const p = Object.fromEntries(FMT.formatToParts(now).map((x) => [x.type, x.value]))
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, dow: DOW[p.weekday] ?? 0 }
}

/** Início do dia de hoje em São Paulo (ISO) — base do limite diário. */
export function spDayStartIso(now = new Date()) {
  return new Date(`${spParts(now).date}T00:00:00-03:00`).toISOString()
}

/** A campanha pode enviar agora? (status, data inicial, dia da semana, janela de horário e intervalo). */
export function canSendNow(c, now = new Date()) {
  if (c.status !== 'agendada' && c.status !== 'enviando') return false
  const p = spParts(now)
  if (c.start_date > p.date) return false
  if (!c.days_of_week.includes(p.dow)) return false
  const start = String(c.window_start).slice(0, 5)
  const end = String(c.window_end).slice(0, 5)
  if (p.time < start || p.time >= end) return false
  if (c.next_send_at && Date.parse(c.next_send_at) > now.getTime()) return false
  return true
}

/** Intervalo aleatório entre min e max segundos (em ms) — evita padrão robótico. */
export function nextDelayMs(minSeconds, maxSeconds, rnd = Math.random) {
  const min = Math.max(20, minSeconds)
  const max = Math.max(min, maxSeconds)
  return Math.round((min + rnd() * (max - min)) * 1000)
}

export function renderMessage(template, name) {
  const first = String(name ?? '').trim()
  return String(template).replace(/\{nome\}/gi, first || 'tudo bem')
}

/** "SAIR", "parar", "stop"... → pedido de descadastro (LGPD). */
export function isOptOut(text) {
  return /^\s*(sair|parar|pare|stop|cancelar|descadastrar|remover)\s*[.!]*\s*$/i.test(String(text ?? ''))
}

/**
 * Variações do número brasileiro: celulares antigos aparecem no WhatsApp sem o 9 extra.
 * 5519912345678 ↔ 551912345678.
 */
export function brVariants(phone) {
  const d = String(phone).replace(/\D/g, '')
  const out = [d]
  if (d.startsWith('55') && d.length === 13 && d[4] === '9') out.push(d.slice(0, 4) + d.slice(5))
  else if (d.startsWith('55') && d.length === 12 && /[6-9]/.test(d[4])) out.push(`${d.slice(0, 4)}9${d.slice(4)}`)
  return out
}

/** Janela das mensagens que NÓS iniciamos (sdr_settings: outreach_days/start/end). */
export function inOutreachWindow(settings, now = new Date()) {
  const p = spParts(now)
  const days = settings?.outreach_days ?? [1, 2, 3, 4, 5, 6]
  if (!days.includes(p.dow)) return false
  const start = String(settings?.outreach_start ?? '09:00').slice(0, 5)
  const end = String(settings?.outreach_end ?? '20:00').slice(0, 5)
  return p.time >= start && p.time < end
}

/** Tempo de "digitando…" proporcional ao tamanho da mensagem (2 a 9 s). */
export function typingMs(text, rnd = Math.random) {
  const base = Math.min(9000, 1500 + String(text ?? '').length * 35)
  return Math.round(base * (0.8 + rnd() * 0.4))
}

/** Texto legível de uma mensagem recebida do WhatsApp (Baileys). */
export function messageText(message) {
  if (!message) return ''
  const m = message.ephemeralMessage?.message ?? message.viewOnceMessage?.message ?? message
  return (
    m.conversation ??
    m.extendedTextMessage?.text ??
    m.imageMessage?.caption ??
    m.videoMessage?.caption ??
    (m.audioMessage ? '[áudio]' : m.imageMessage ? '[imagem]' : m.videoMessage ? '[vídeo]' : m.documentMessage ? '[documento]' : m.stickerMessage ? '[figurinha]' : m.locationMessage ? '[localização]' : '')
  )
}

/** Próximo passo da cadência: { done } ou { nextRunAt } (espera do passo seguinte a partir de agora). */
export function advanceCadence(steps, stepIndex, now = new Date()) {
  const next = stepIndex + 1
  if (!Array.isArray(steps) || next >= steps.length) return { done: true, stepIndex: next, nextRunAt: null }
  const wait = Math.max(0, Number(steps[next]?.wait_hours) || 0)
  return { done: false, stepIndex: next, nextRunAt: new Date(now.getTime() + wait * 3_600_000).toISOString() }
}
