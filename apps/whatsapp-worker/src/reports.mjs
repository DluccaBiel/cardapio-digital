// Relatórios nos grupos do WhatsApp (robô local).
//
//   grupos       lista os grupos do número (quando o painel pede e a cada 6 h) → whatsapp_groups
//   agendamentos quando um disparo automático vence, pede ao Undercut para gerar (Meta) e enfileirar
//   envios       manda cada relatório da fila (imagem + legenda) no grupo do cliente, na hora marcada
//
// Os horários da fila já vêm escalonados pelo Undercut (intervalo aleatório escolhido no painel);
// aqui ainda há um mínimo de 20 s entre envios e o ritmo é compartilhado com Disparos/SDR.

const GROUPS_EVERY_MS = 6 * 3_600_000
const SCHEDULE_EVERY_MS = 60_000
const MIN_GAP_MS = 20_000
const STALE_SENDING_MS = 10 * 60_000

export function createReports({ db, WS, log, getSock, isReady, hub, pace }) {
  let lastGroups = 0
  let lastSchedules = 0
  let sendingNow = false

  async function syncGroups() {
    const sock = getSock()
    if (!sock) return
    const all = await sock.groupFetchAllParticipating()
    const now = new Date().toISOString()
    const rows = Object.values(all ?? {})
      .filter((g) => /^[0-9-]+@g\.us$/.test(g.id ?? ''))
      .map((g) => ({ workspace_id: WS, jid: g.id, name: String(g.subject ?? '').slice(0, 200), participants: g.participants?.length ?? 0, synced_at: now }))
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await db.from('whatsapp_groups').upsert(rows.slice(i, i + 200), { onConflict: 'workspace_id,jid' })
      if (error) throw new Error(error.code ?? error.message)
    }
    await db.from('whatsapp_groups').delete().eq('workspace_id', WS).lt('synced_at', now) // saiu do grupo
    await db.from('whatsapp_sessions').update({ groups_synced_at: now }).eq('workspace_id', WS)
    lastGroups = Date.now()
    log(`Relatórios: ${rows.length} grupo(s) do WhatsApp atualizados.`)
  }

  async function groupsTick() {
    const { data: s } = await db.from('whatsapp_sessions').select('groups_sync_requested_at, groups_synced_at').eq('workspace_id', WS).maybeSingle()
    const requested = s?.groups_sync_requested_at ? Date.parse(s.groups_sync_requested_at) : 0
    const synced = s?.groups_synced_at ? Date.parse(s.groups_synced_at) : 0
    if (requested > synced || !synced || Date.now() - Math.max(synced, lastGroups) > GROUPS_EVERY_MS) {
      await syncGroups().catch((e) => {
        lastGroups = Date.now() // não insiste a cada ciclo
        log('Relatórios: falha ao listar grupos —', e.message)
      })
    }
  }

  async function schedulesTick() {
    if (Date.now() - lastSchedules < SCHEDULE_EVERY_MS) return
    lastSchedules = Date.now()
    const { data } = await db.from('report_schedules').select('id, name').eq('workspace_id', WS).eq('active', true).lte('next_run_at', new Date().toISOString()).limit(5)
    for (const s of data ?? []) {
      if (!hub?.key) {
        log(`Relatórios: agendamento "${s.name}" venceu, mas o robô está sem chave do Undercut (veja o aviso da IA acima).`)
        continue
      }
      log(`Relatórios: gerando o agendamento "${s.name}"…`)
      try {
        const res = await fetch(`${hub.base}/api/v1/reports/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-API-Key': hub.key },
          body: JSON.stringify({ schedule_id: s.id }),
          signal: AbortSignal.timeout(300_000),
        })
        const json = await res.json().catch(() => null)
        if (!res.ok) log(`Relatórios: o Undercut respondeu ${res.status} — ${json?.error?.message ?? ''}`)
        else if (json?.data?.action === 'queued') log(`Relatórios: ${json.data.queued} relatório(s) na fila.${json.data.errors?.length ? ` Avisos: ${json.data.errors.join(' · ')}` : ''}`)
      } catch (e) {
        log('Relatórios: sem conexão com o Undercut —', e.message)
      }
    }
  }

  async function fetchCard(id) {
    if (!hub?.key) return null
    try {
      const res = await fetch(`${hub.base}/api/v1/reports/${id}/card`, { headers: { 'X-API-Key': hub.key }, signal: AbortSignal.timeout(60_000) })
      if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('image/png')) return null
      return Buffer.from(await res.arrayBuffer())
    } catch {
      return null
    }
  }

  async function sendTick() {
    if (sendingNow || Date.now() < pace.nextAt) return
    // Relatório preso em "enviando" (robô caiu no meio): marca falha para não duplicar.
    await db
      .from('reports')
      .update({ status: 'falhou', error: 'Envio interrompido (robô reiniciou). Reenvie se não chegou no grupo.' })
      .eq('workspace_id', WS)
      .eq('status', 'enviando')
      .lt('updated_at', new Date(Date.now() - STALE_SENDING_MS).toISOString())

    const { data: next } = await db
      .from('reports')
      .select('id, title, message, group_jid')
      .eq('workspace_id', WS)
      .eq('status', 'agendado')
      .lte('scheduled_at', new Date().toISOString())
      .order('scheduled_at')
      .limit(1)
    const r = next?.[0]
    if (!r) return
    const { data: claimed } = await db.from('reports').update({ status: 'enviando', error: null }).eq('workspace_id', WS).eq('id', r.id).eq('status', 'agendado').select('id')
    if (!claimed?.length) return

    sendingNow = true
    try {
      const sock = getSock()
      if (!r.group_jid) throw new Error('Sem grupo do WhatsApp vinculado.')
      await sock.groupMetadata(r.group_jid).catch(() => {
        throw new Error('O número conectado não está mais neste grupo.')
      })
      const png = await fetchCard(r.id)
      if (png) await sock.sendMessage(r.group_jid, { image: png, mimetype: 'image/png', caption: r.message })
      else await sock.sendMessage(r.group_jid, { text: r.message })
      await db.from('reports').update({ status: 'enviado', sent_at: new Date().toISOString(), error: png ? null : 'Enviado só o texto (imagem indisponível).' }).eq('workspace_id', WS).eq('id', r.id)
      log(`Relatórios: "${r.title}" enviado no grupo${png ? ' (imagem + texto)' : ' (só texto)'}.`)
    } catch (e) {
      await db.from('reports').update({ status: 'falhou', error: String(e.message ?? e).slice(0, 300) }).eq('workspace_id', WS).eq('id', r.id)
      log(`Relatórios: falha ao enviar "${r.title}" —`, e.message)
    } finally {
      sendingNow = false
      pace.nextAt = Math.max(pace.nextAt, Date.now() + MIN_GAP_MS)
    }
  }

  async function tick() {
    if (!getSock() || !isReady()) return
    try {
      await groupsTick()
      await schedulesTick()
      await sendTick()
    } catch (e) {
      log('Relatórios: erro no ciclo —', e.message)
    }
  }

  return { tick }
}
