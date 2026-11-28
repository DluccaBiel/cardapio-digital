'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { AlertTriangle, CalendarClock, Check, Link2, Loader2, PlayCircle, QrCode, RefreshCw, Send, Wand2 } from 'lucide-react'
import { previewAction, queueSendAction, saveScheduleAction } from '@/app/a/[ws]/relatorios/actions'
import { whatsappConnectAction } from '@/app/a/[ws]/disparos/actions'
import type { WhatsappSession } from '@/lib/db/disparos'
import { composeReport, reportMessage } from '@/lib/reports/format'
import { matchGroups, rankGroups } from '@/lib/reports/group-match'
import type { GroupView, ReportsData, ScheduleView, SettingsView, TargetView } from '@/lib/reports/views'
import { cn } from '@/components/hub/ui'

const CARD = 'rounded-[6px] border border-[#222225] bg-[#111113] p-4 md:p-5'
const BTN_PRIMARY = 'inline-flex items-center justify-center gap-1.5 rounded-[5px] bg-[#D7141F] px-4 py-2 text-[13px] font-semibold text-white hover:bg-[#B5121B] disabled:opacity-40'
const BTN_GHOST = 'inline-flex items-center gap-1.5 rounded-[5px] border border-[#2A2A2E] px-3 py-1.5 text-[12px] font-semibold text-[#CFCBC4] hover:border-[#D7141F] hover:text-white disabled:opacity-40'
const SELECT = 'h-[34px] rounded-[5px] border border-[#2A2A2E] bg-[#0B0B0C] px-2 text-[12px] text-[#ECE9E3] outline-none focus:border-[#D7141F]'
const DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

const fmtNext = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '—'

const STATUS_LABEL: Record<string, string> = {
  disconnected: 'Não conectado',
  starting: 'Iniciando…',
  qr: 'Aguardando a leitura do QR',
  connecting: 'Conectando…',
  syncing: 'Conectado · sincronizando conversas',
  ready: 'Conectado',
  logged_out: 'Desvinculado pelo celular',
  error: 'Erro na conexão',
}

type Props = {
  ws: string
  accounts: ReportsData['accounts']
  groups: GroupView[]
  targets: Map<string, TargetView>
  setTargets: React.Dispatch<React.SetStateAction<Map<string, TargetView>>>
  saveTarget: (accountId: string, patch: Partial<TargetView>) => Promise<boolean>
  schedules: ScheduleView[]
  setSchedules: React.Dispatch<React.SetStateAction<ScheduleView[]>>
  settings: SettingsView
  session: WhatsappSession | null
  workerOnline: boolean | null
  waiting: boolean
  onRequestGroups: () => void
  canWrite: boolean
  flash: (t: string) => void
  goSchedules: () => void
}

function Chip({ ok, warn, children }: { ok?: boolean; warn?: boolean; children: React.ReactNode }) {
  const tone = ok ? 'border-[#16A34A]/40 bg-[#0F291E]/60 text-[#86EFAC]' : warn ? 'border-[#F59E0B]/40 bg-[#F59E0B]/10 text-[#FBBF24]' : 'border-[#D7141F]/40 bg-[#1F0D0F]/60 text-[#FFB199]'
  const dot = ok ? 'bg-[#4ADE80]' : warn ? 'bg-[#FBBF24]' : 'bg-[#F0333D]'
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold', tone)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', dot)} />
      {children}
    </span>
  )
}

function StepTitle({ n, title, done }: { n: number; title: string; done?: boolean }) {
  return (
    <h2 className="uc-title mb-3 flex items-center gap-2.5 text-[17px] text-[#F7F5F1]">
      <span className={cn('grid h-6 w-6 place-items-center rounded-full text-[12px] font-bold', done ? 'bg-[#16A34A] text-white' : 'bg-[#D7141F] text-white')}>{done ? <Check size={13} /> : n}</span>
      {title}
    </h2>
  )
}

export function ConnectionsTab(props: Props) {
  const { ws, accounts, groups, targets, setTargets, saveTarget, schedules, setSchedules, settings, session, canWrite, flash } = props
  const [busy, start] = useTransition()

  const st = session?.status ?? 'disconnected'
  const linked = st === 'ready' || st === 'syncing'
  const robotOk = props.workerOnline === true
  const wantsConnect = session?.desired_state === 'connected'

  // ---- 1. WhatsApp -------------------------------------------------------------------------
  const generateQr = () =>
    start(async () => {
      const r = await whatsappConnectAction(ws, true)
      if (!r.ok) return flash(r.error)
      flash(robotOk ? 'Gerando o QR code…' : 'Pedido enviado. Instale o robô no computador (instalar-robo.cmd, uma vez só) para o QR aparecer.')
    })

  // ---- 3. Vínculos (pendentes até você confirmar) -----------------------------------------
  const [q, setQ] = useState('')
  const [onlyMissing, setOnlyMissing] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [pending, setPending] = useState<Map<string, GroupView | null>>(new Map())
  const base = useMemo(() => accounts.filter((a) => showAll || a.watched), [accounts, showAll])
  const nameOf = (a: (typeof accounts)[number]) => a.clientName ?? a.name
  const jidOf = (id: string) => targets.get(id)?.group_jid ?? null
  const connected = useMemo(() => base.filter((a) => jidOf(a.id)), [base, targets]) // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase()
    return base
      .filter((a) => !term || nameOf(a).toLowerCase().includes(term))
      .filter((a) => !onlyMissing || !jidOf(a.id) || pending.has(a.id))
  }, [base, q, onlyMissing, targets, pending]) // eslint-disable-line react-hooks/exhaustive-deps
  const usedJids = useMemo(() => {
    const m = new Map<string, string>()
    for (const a of accounts) {
      const j = pending.has(a.id) ? pending.get(a.id)?.jid : jidOf(a.id)
      if (j) m.set(j, a.id)
    }
    return m
  }, [accounts, targets, pending]) // eslint-disable-line react-hooks/exhaustive-deps

  const suggest = () => {
    const missing = base.filter((a) => !jidOf(a.id) && !pending.has(a.id))
    const hits = matchGroups(missing.map((a) => ({ id: a.id, name: nameOf(a) })), groups.filter((g) => !usedJids.has(g.jid)))
    if (!hits.length) return flash('Não achei grupos com nome parecido. Escolha manualmente em cada cliente.')
    setPending((m) => {
      const n = new Map(m)
      for (const h of hits) n.set(h.id, h.group)
      return n
    })
    flash(`${hits.length} sugestão(ões) preenchida(s). Confira e clique em "Confirmar vínculos".`)
  }
  const confirm = () =>
    start(async () => {
      const entries = Array.from(pending.entries())
      let okN = 0
      const failed = new Map<string, GroupView | null>()
      for (const [id, g] of entries) {
        if (await saveTarget(id, { group_jid: g?.jid ?? null, group_name: g?.name ?? null })) okN++
        else failed.set(id, g)
      }
      setPending(failed) // o que falhou continua pendente para você corrigir
      if (!failed.size) flash(`${okN} vínculo(s) confirmado(s).`)
      else flash(`${okN} confirmado(s); ${failed.size} não salvou (veja o aviso e ajuste o grupo).`)
    })

  // ---- 4. Agendar ---------------------------------------------------------------------------
  const [days, setDays] = useState<number[]>([1])
  const [time, setTime] = useState('09:00')
  const [picked, setPicked] = useState<Set<string> | null>(null) // null = todos os conectados
  const chosen = useMemo(() => connected.filter((a) => (picked ? picked.has(a.id) : true)), [connected, picked])
  const n = chosen.length
  // Segunda antes das 12h: ajusta o intervalo para a fila inteira terminar a tempo.
  const [hh, mm] = time.split(':').map(Number)
  const startMin = (hh ?? 0) * 60 + (mm ?? 0)
  const budgetSec = Math.max(0, 12 * 3600 - startMin * 60 - 5 * 60)
  const avgFits = n > 1 ? budgetSec / (n - 1) : 90
  const auto = Math.max(20, Math.min(90, Math.floor(avgFits)))
  const intervalMin = Math.max(20, Math.floor(auto * 0.6))
  const intervalMax = Math.max(intervalMin, Math.floor(auto * 1.4))
  const endMin = startMin + Math.ceil(((n - 1) * ((intervalMin + intervalMax) / 2)) / 60)
  const endsBefore12 = endMin < 12 * 60
  const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

  const createSchedule = () =>
    start(async () => {
      if (!n) return flash('Vincule e confirme ao menos um cliente a um grupo antes de agendar.')
      if (!days.length) return flash('Escolha pelo menos um dia.')
      const r = await saveScheduleAction(ws, {
        name: `Relatório semanal · ${days.map((d) => DAYS[d]).join(', ')} ${time}`,
        active: true,
        days,
        time,
        period: '7d',
        compare: false,
        accountIds: chosen.map((a) => a.id),
        intervalMin,
        intervalMax,
      })
      if (!r.ok) return flash(r.error)
      setTargets((m) => {
        const x = new Map(m)
        for (const t of r.targets) x.set(t.ad_account_id, t)
        return x
      })
      setSchedules((list) => [...list.filter((s) => s.id !== r.schedule.id), r.schedule])
      flash(r.schedule.next_run_at ? `Agendado! Próximo envio: ${fmtNext(r.schedule.next_run_at)}.` : 'Agendamento salvo.')
    })

  // Teste: gera o relatório real (últimos 7 dias) de UM cliente e manda agora para o grupo dele.
  const [testId, setTestId] = useState('')
  useEffect(() => {
    if (!testId && connected[0]) setTestId(connected[0].id)
  }, [connected, testId])
  const testNow = () =>
    start(async () => {
      const acc = accounts.find((a) => a.id === testId)
      const t = testId ? targets.get(testId) : undefined
      if (!acc || !t?.group_jid) return flash('Escolha um cliente com grupo confirmado.')
      const pv = await previewAction(ws, { accountIds: [testId], period: '7d', compare: false })
      if (!pv.ok) return flash(pv.error)
      const item = pv.items[0]
      if (!item?.source) return flash(item?.error ?? 'Não consegui ler os dados da Meta.')
      const payload = composeReport(item.source, { mode: t.campaign_mode, selected: t.campaign_ids, show: settings.show })
      const r = await queueSendAction(ws, { items: [{ payload, message: reportMessage(payload) }], intervalMin: 20, intervalMax: 20 })
      if (!r.ok) return flash(r.error)
      flash(`Teste na fila do robô — sai em instantes no grupo ${t.group_name ?? ''}.`)
    })

  const activeSchedules = schedules.filter((s) => s.active)

  return (
    <div className="space-y-4">
      {/* 1. WhatsApp */}
      <section className={CARD}>
        <StepTitle n={1} title="Conectar o WhatsApp" done={linked} />
        <div className="flex flex-wrap items-center gap-2">
          <Chip ok={robotOk}>{robotOk ? 'Robô ligado' : 'Robô desligado'}</Chip>
          <Chip ok={linked} warn={!linked && (st === 'qr' || st === 'connecting' || st === 'starting')}>
            {linked ? `WhatsApp conectado${session?.phone ? ` · +${session.phone}` : ''}` : STATUS_LABEL[st] ?? 'Não conectado'}
          </Chip>
          {session?.display_name && linked && <span className="text-[12px] text-[#8E8A86]">{session.display_name}</span>}
          {!linked && (
            <button type="button" className={cn(BTN_PRIMARY, 'ml-auto')} disabled={!canWrite || busy || (wantsConnect && st === 'qr')} onClick={generateQr}>
              {busy ? <Loader2 size={13} className="animate-spin" /> : <QrCode size={14} />} Gerar QR code
            </button>
          )}
        </div>
        {!robotOk && (
          <p className="mt-3 rounded-[5px] border border-[#F59E0B]/35 bg-[#F59E0B]/10 px-3 py-2 text-[12px] text-[#FBBF24]">
            O robô precisa estar ligado para gerar o QR. Instalação única: no seu computador, dê dois cliques em <b>instalar-robo.cmd</b>. Depois disso ele liga sozinho com o Windows, sem janela nem terminal.
          </p>
        )}
        {!linked && st === 'qr' && session?.qr_data_url && (
          <div className="mt-4 flex flex-wrap items-center gap-5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={session.qr_data_url} alt="QR code para vincular o WhatsApp" width={240} height={240} className="rounded bg-white p-2" />
            <ol className="list-decimal space-y-1 pl-5 text-[13px] text-[#CFCBC4]">
              <li>Abra o WhatsApp no celular.</li>
              <li>
                Toque em <b>⋮ / Configurações → Aparelhos conectados → Conectar aparelho</b>.
              </li>
              <li>Aponte a câmera para este QR code.</li>
            </ol>
          </div>
        )}
        {session?.last_error && !linked && <p className="mt-2 text-[12px] text-[#FFB199]">{session.last_error}</p>}
      </section>

      {/* 2. Sincronizar */}
      <section className={CARD}>
        <StepTitle n={2} title="Sincronizar os grupos" done={groups.length > 0} />
        <div className="flex flex-wrap items-center gap-3">
          <Chip ok={groups.length > 0} warn={props.waiting}>
            {props.waiting ? 'Lendo grupos…' : `${groups.length} grupo(s) lido(s)`}
          </Chip>
          <button type="button" className={BTN_PRIMARY} disabled={!canWrite || !linked || !robotOk || props.waiting} onClick={props.onRequestGroups}>
            {props.waiting ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Sincronizar grupos
          </button>
          {!linked && <span className="text-[12px] text-[#85817C]">Disponível depois de conectar o WhatsApp.</span>}
        </div>
      </section>

      {/* 3. Vincular */}
      <section className={CARD}>
        <StepTitle n={3} title="Vincular cada cliente a um grupo" done={base.length > 0 && connected.length === base.length} />
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Chip ok={base.length > 0 && connected.length === base.length} warn>
            {connected.length} de {base.length} clientes com grupo
          </Chip>
          <input className={cn(SELECT, 'w-[190px]')} placeholder="Buscar cliente" value={q} onChange={(e) => setQ(e.target.value)} />
          <label className="flex items-center gap-1.5 text-[12px] text-[#CFCBC4]">
            <input type="checkbox" className="h-3.5 w-3.5 accent-[#D7141F]" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} /> Só sem grupo
          </label>
          <label className="flex items-center gap-1.5 text-[12px] text-[#CFCBC4]">
            <input type="checkbox" className="h-3.5 w-3.5 accent-[#D7141F]" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Incluir contas não acompanhadas
          </label>
          <button type="button" className={cn(BTN_GHOST, 'ml-auto')} disabled={!canWrite || !groups.length} onClick={suggest}>
            <Wand2 size={13} /> Sugerir pelo nome
          </button>
        </div>

        <div className="divide-y divide-[#1C1C1F] rounded-[5px] border border-[#222225]">
          {rows.length === 0 && <p className="p-4 text-[12px] text-[#85817C]">Nenhum cliente para mostrar.</p>}
          {rows.map((a) => {
            const saved = targets.get(a.id)
            const isPending = pending.has(a.id)
            const chosenJid = isPending ? pending.get(a.id)?.jid ?? '' : saved?.group_jid ?? ''
            const ranked = rankGroups(nameOf(a), groups).filter((r) => r.score >= 0.34).slice(0, 4)
            const rankedJids = new Set(ranked.map((r) => r.group.jid))
            const known = groups.some((g) => g.jid === chosenJid)
            const taken = (jid: string) => usedJids.has(jid) && usedJids.get(jid) !== a.id
            return (
              <div key={a.id} className="grid items-center gap-2 px-3 py-2 md:grid-cols-[minmax(0,1.2fr)_170px_minmax(0,1.6fr)]">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold text-[#F7F5F1]">{nameOf(a)}</p>
                  {a.clientName && <p className="truncate text-[11px] text-[#85817C]">{a.name}</p>}
                </div>
                <div>
                  {isPending ? (
                    <Chip warn>Aguardando confirmação</Chip>
                  ) : saved?.group_jid ? (
                    <Chip ok>Grupo conectado</Chip>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-[#F59E0B]/40 bg-[#F59E0B]/10 px-2.5 py-1 text-[11px] font-semibold text-[#FBBF24]">
                      <AlertTriangle size={11} /> Sem grupo
                    </span>
                  )}
                </div>
                <select
                  className={cn(SELECT, 'w-full min-w-0', !chosenJid && 'text-[#85817C]')}
                  disabled={!canWrite}
                  value={chosenJid}
                  onChange={(e) => {
                    const g = groups.find((x) => x.jid === e.target.value) ?? null
                    setPending((m) => {
                      const nm = new Map(m)
                      if ((g?.jid ?? null) === (saved?.group_jid ?? null)) nm.delete(a.id)
                      else nm.set(a.id, g)
                      return nm
                    })
                  }}
                >
                  <option value="">{groups.length ? 'Escolher grupo…' : 'Sincronize os grupos primeiro'}</option>
                  {chosenJid && !known && <option value={chosenJid}>{saved?.group_name ?? 'Grupo salvo'}</option>}
                  {ranked.length > 0 && (
                    <optgroup label="Parecidos com o nome do cliente">
                      {ranked.map(({ group, score }) => (
                        <option key={group.jid} value={group.jid}>
                          {group.name} · {Math.round(score * 100)}%{taken(group.jid) ? ' · já usado' : ''}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  <optgroup label="Todos os grupos">
                    {groups
                      .filter((g) => !rankedJids.has(g.jid))
                      .map((g) => (
                        <option key={g.jid} value={g.jid}>
                          {g.name} ({g.participants}){taken(g.jid) ? ' · já usado' : ''}
                        </option>
                      ))}
                  </optgroup>
                </select>
              </div>
            )
          })}
        </div>
        {pending.size > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-3 rounded-[5px] border border-[#D7141F]/40 bg-[#1F0D0F]/60 px-3 py-2.5">
            <span className="text-[13px] text-[#ECE9E3]">
              <b>{pending.size}</b> vínculo(s) aguardando o seu aval
            </span>
            <button type="button" className={cn(BTN_PRIMARY, 'ml-auto')} disabled={busy} onClick={confirm}>
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Link2 size={13} />} Confirmar vínculos
            </button>
            <button type="button" className={BTN_GHOST} disabled={busy} onClick={() => setPending(new Map())}>
              Descartar
            </button>
          </div>
        )}
      </section>

      {/* 4. Agendar + testar */}
      <section className={CARD}>
        <StepTitle n={4} title="Quando enviar o relatório" done={activeSchedules.length > 0} />
        <p className="mb-3 text-[12px] text-[#8E8A86]">Na hora marcada, o robô envia o relatório dos últimos 7 dias no grupo de cada cliente escolhido, um por vez.</p>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-[#85817C]">Dia</div>
            <div className="flex gap-1">
              {DAYS.map((d, i) => (
                <button
                  key={d}
                  type="button"
                  disabled={!canWrite}
                  onClick={() => setDays((cur) => (cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i].sort()))}
                  className={cn('h-[34px] w-[44px] rounded-[5px] border text-[12px] font-semibold', days.includes(i) ? 'border-[#D7141F] bg-[#D7141F]/15 text-white' : 'border-[#2A2A2E] text-[#CFCBC4] hover:border-[#D7141F]/50')}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
          <label className="flex flex-col">
            <span className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-[#85817C]">Começa às</span>
            <input type="time" className={SELECT} value={time} onChange={(e) => setTime(e.target.value)} />
          </label>
          <button type="button" className={BTN_PRIMARY} disabled={!canWrite || busy || !n || !days.length} onClick={createSchedule}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : <CalendarClock size={14} />} Ativar agendamento ({n} cliente{n === 1 ? '' : 's'})
          </button>
        </div>
        {n > 0 && (
          <p className={cn('mt-2 text-[12px]', endsBefore12 ? 'text-[#86EFAC]' : 'text-[#FBBF24]')}>
            {endsBefore12
              ? `Envios de ${time} até ~${hm(endMin)} (antes das 12h), intervalo de ${intervalMin} a ${intervalMax} s entre clientes.`
              : `Com ${n} clientes a fila vai até ~${hm(endMin)}. Comece mais cedo ou escolha menos clientes para terminar antes das 12h.`}
          </p>
        )}
        {connected.length > 0 && (
          <div className="mt-4 border-t border-[#222225] pt-3">
            <div className="mb-2 flex items-center gap-3 text-[12px] text-[#CFCBC4]">
              <b className="text-[11px] uppercase tracking-wider text-[#85817C]">Clientes deste envio</b>
              <button type="button" className="underline hover:text-white" onClick={() => setPicked(null)}>
                Todos
              </button>
              <button type="button" className="underline hover:text-white" onClick={() => setPicked(new Set())}>
                Nenhum
              </button>
            </div>
            <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
              {connected.map((a) => {
                const on = picked ? picked.has(a.id) : true
                return (
                  <label key={a.id} className="flex items-center gap-2 text-[12px] text-[#ECE9E3]">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 accent-[#D7141F]"
                      checked={on}
                      onChange={() =>
                        setPicked((cur) => {
                          const s = new Set(cur ?? connected.map((x) => x.id))
                          if (s.has(a.id)) s.delete(a.id)
                          else s.add(a.id)
                          return s
                        })
                      }
                    />
                    <span className="truncate">{nameOf(a)}</span>
                    <span className="truncate text-[#85817C]">→ {targets.get(a.id)?.group_name}</span>
                  </label>
                )
              })}
            </div>
          </div>
        )}

        {schedules.length > 0 && (
          <ul className="mt-4 space-y-1.5 border-t border-[#222225] pt-3 text-[12px]">
            {schedules.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2 text-[#CFCBC4]">
                <Chip ok={s.active}>{s.active ? 'Ativo' : 'Pausado'}</Chip>
                <span className="font-semibold">{s.name}</span>
                <span className="text-[#8E8A86]">
                  {s.target_ids.length} cliente(s) · próximo envio: {s.active ? fmtNext(s.next_run_at) : '—'}
                </span>
              </li>
            ))}
            <li>
              <button type="button" className="text-[11px] text-[#8E8A86] underline hover:text-white" onClick={props.goSchedules}>
                Editar / pausar em Agendamentos
              </button>
            </li>
          </ul>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-[5px] border border-[#222225] bg-[#0B0B0C] px-3 py-2.5">
          <PlayCircle size={16} className="text-[#D7141F]" />
          <span className="text-[12px] font-semibold text-[#ECE9E3]">Testar agora com 1 cliente</span>
          <select className={cn(SELECT, 'min-w-[180px]')} value={testId} onChange={(e) => setTestId(e.target.value)} disabled={!connected.length}>
            {connected.length === 0 && <option value="">Nenhum cliente com grupo</option>}
            {connected.map((a) => (
              <option key={a.id} value={a.id}>
                {nameOf(a)}
              </option>
            ))}
          </select>
          <button type="button" className={BTN_GHOST} disabled={!canWrite || busy || !testId || !linked} onClick={testNow}>
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Enviar relatório de teste
          </button>
          {!linked && <span className="text-[11px] text-[#85817C]">Conecte o WhatsApp para testar.</span>}
        </div>
      </section>
    </div>
  )
}
