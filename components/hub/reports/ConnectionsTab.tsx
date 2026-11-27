'use client'

import { useMemo, useState, useTransition } from 'react'
import { AlertTriangle, CalendarClock, Check, Link2, Loader2, RefreshCw, Unlink, Wand2 } from 'lucide-react'
import { saveScheduleAction } from '@/app/a/[ws]/relatorios/actions'
import { matchGroups } from '@/lib/reports/group-match'
import type { GroupView, ReportsData, ScheduleView, SettingsView, TargetView } from '@/lib/reports/views'
import { cn } from '@/components/hub/ui'

const CARD = 'rounded-[6px] border border-[#222225] bg-[#111113] p-4 md:p-5'
const BTN_PRIMARY = 'inline-flex items-center justify-center gap-1.5 rounded-[5px] bg-[#D7141F] px-4 py-2 text-[13px] font-semibold text-white hover:bg-[#B5121B] disabled:opacity-40'
const BTN_GHOST = 'inline-flex items-center gap-1.5 rounded-[5px] border border-[#2A2A2E] px-3 py-1.5 text-[12px] font-semibold text-[#CFCBC4] hover:border-[#D7141F] hover:text-white disabled:opacity-40'
const SELECT = 'h-[34px] rounded-[5px] border border-[#2A2A2E] bg-[#0B0B0C] px-2 text-[12px] text-[#ECE9E3] outline-none focus:border-[#D7141F]'
const DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

const fmtNext = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '—'

export function ConnectionsTab(props: {
  ws: string
  accounts: ReportsData['accounts']
  groups: GroupView[]
  targets: Map<string, TargetView>
  setTargets: React.Dispatch<React.SetStateAction<Map<string, TargetView>>>
  saveTarget: (accountId: string, patch: Partial<TargetView>) => Promise<void>
  schedules: ScheduleView[]
  setSchedules: React.Dispatch<React.SetStateAction<ScheduleView[]>>
  settings: SettingsView
  whatsapp: ReportsData['whatsapp']
  linked: boolean
  workerOnline: boolean | null
  waiting: boolean
  onRequestGroups: () => void
  canWrite: boolean
  flash: (t: string) => void
  goSchedules: () => void
}) {
  const { ws, accounts, groups, targets, setTargets, saveTarget, schedules, setSchedules, settings, canWrite, flash } = props
  const [q, setQ] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [onlyMissing, setOnlyMissing] = useState(false)
  const [busy, start] = useTransition()
  const [days, setDays] = useState<number[]>([1])
  const [time, setTime] = useState('09:00')

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase()
    return accounts
      .filter((a) => showAll || a.watched)
      .filter((a) => !term || (a.clientName ?? a.name).toLowerCase().includes(term))
      .filter((a) => !onlyMissing || !targets.get(a.id)?.group_jid)
  }, [accounts, q, showAll, onlyMissing, targets])
  const base = accounts.filter((a) => showAll || a.watched)
  const connected = base.filter((a) => targets.get(a.id)?.group_jid)
  const takenBy = useMemo(() => {
    const m = new Map<string, string>()
    for (const a of accounts) {
      const j = targets.get(a.id)?.group_jid
      if (j) m.set(j, a.id)
    }
    return m
  }, [accounts, targets])

  const robotOk = props.workerOnline ?? props.whatsapp.workerOnline
  const waOk = props.linked || (props.whatsapp.status === 'ready' || props.whatsapp.status === 'syncing')

  const autoLink = () => {
    const missing = base.filter((a) => !targets.get(a.id)?.group_jid)
    const hits = matchGroups(
      missing.map((a) => ({ id: a.id, name: a.clientName ?? a.name })),
      groups.filter((g) => !takenBy.has(g.jid)),
    )
    if (!hits.length) return flash('Não achei grupos com nome parecido. Escolha manualmente na lista.')
    start(async () => {
      for (const h of hits) await saveTarget(h.id, { group_jid: h.group.jid, group_name: h.group.name })
      flash(`${hits.length} cliente(s) conectado(s) ao grupo de nome parecido. Confira a lista.`)
    })
  }

  const hasSchedule = schedules.find((s) => s.active && s.days_of_week.length)
  const createSchedule = () =>
    start(async () => {
      const ids = connected.map((a) => a.id)
      if (!ids.length) return flash('Conecte ao menos um cliente a um grupo antes de agendar.')
      if (!days.length) return flash('Escolha pelo menos um dia.')
      const r = await saveScheduleAction(ws, {
        name: `Relatório semanal · ${days.map((d) => DAYS[d]).join(', ')} ${time}`,
        active: true,
        days,
        time,
        period: '7d',
        compare: false,
        accountIds: ids,
        intervalMin: settings.intervalMin,
        intervalMax: settings.intervalMax,
      })
      if (!r.ok) return flash(r.error)
      setTargets((m) => {
        const n = new Map(m)
        for (const t of r.targets) n.set(t.ad_account_id, t)
        return n
      })
      setSchedules((list) => [...list, r.schedule])
      flash(r.schedule.next_run_at ? `Agendado! Próximo envio: ${fmtNext(r.schedule.next_run_at)}.` : 'Agendamento salvo.')
    })

  const Chip = ({ ok, children }: { ok: boolean; children: React.ReactNode }) => (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold', ok ? 'border-[#16A34A]/40 bg-[#0F291E]/60 text-[#86EFAC]' : 'border-[#D7141F]/40 bg-[#1F0D0F]/60 text-[#FFB199]')}>
      <span className={cn('h-1.5 w-1.5 rounded-full', ok ? 'bg-[#4ADE80]' : 'bg-[#F0333D]')} />
      {children}
    </span>
  )

  return (
    <div className="space-y-4">
      {/* 1. Status */}
      <section className={CARD}>
        <div className="flex flex-wrap items-center gap-2">
          <Chip ok={robotOk}>{robotOk ? 'Robô ligado' : 'Robô desligado'}</Chip>
          <Chip ok={waOk}>{waOk ? `WhatsApp conectado${props.whatsapp.phone ? ` · ${props.whatsapp.phone}` : ''}` : 'WhatsApp não conectado'}</Chip>
          <Chip ok={groups.length > 0}>{groups.length} grupo(s) lidos</Chip>
          <Chip ok={base.length > 0 && connected.length === base.length}>
            {connected.length} de {base.length} clientes com grupo
          </Chip>
          <div className="ml-auto flex gap-2">
            <button type="button" className={BTN_GHOST} disabled={!canWrite || !waOk || !robotOk || props.waiting} onClick={props.onRequestGroups}>
              {props.waiting ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Atualizar grupos
            </button>
            <button type="button" className={BTN_PRIMARY} disabled={!canWrite || busy || !groups.length || connected.length === base.length} onClick={autoLink}>
              <Wand2 size={13} /> Conectar por nome
            </button>
          </div>
        </div>
        {(!robotOk || !waOk) && (
          <p className="mt-3 rounded-[5px] border border-[#F59E0B]/35 bg-[#F59E0B]/10 px-3 py-2 text-[12px] text-[#FBBF24]">
            {!robotOk ? 'Ligue o robô no seu computador (iniciar-robo.cmd)' : 'Conecte o WhatsApp lendo o QR code'} para os grupos aparecerem aqui.{' '}
            <a href={`/a/${ws}/disparos`} className="font-semibold underline underline-offset-2">
              Abrir Disparos
            </a>
          </p>
        )}
      </section>

      {/* 2. Agendar */}
      <section className={CARD}>
        <h2 className="uc-title mb-1 flex items-center gap-2 text-[17px] text-[#F7F5F1]">
          <CalendarClock size={18} className="text-[#D7141F]" /> Quando enviar
        </h2>
        <p className="mb-3 text-[12px] text-[#8E8A86]">O robô envia o relatório dos últimos 7 dias no grupo de cada cliente conectado, um por vez, com o intervalo seguro.</p>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-[#85817C]">Dias</div>
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
            <span className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-[#85817C]">Horário</span>
            <input type="time" className={SELECT} value={time} onChange={(e) => setTime(e.target.value)} />
          </label>
          <button type="button" className={BTN_PRIMARY} disabled={!canWrite || busy || !connected.length || !days.length} onClick={createSchedule}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Agendar para {connected.length} cliente(s)
          </button>
        </div>
        {time >= '12:00' && days.includes(1) && <p className="mt-2 text-[11px] text-[#FBBF24]">Atenção: esse horário é depois das 12h.</p>}
        {schedules.length > 0 && (
          <ul className="mt-4 space-y-1.5 border-t border-[#222225] pt-3 text-[12px]">
            {schedules.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2 text-[#CFCBC4]">
                <Chip ok={s.active}>{s.active ? 'Ativo' : 'Pausado'}</Chip>
                <span className="font-semibold">{s.name}</span>
                <span className="text-[#8E8A86]">
                  {s.days_of_week.map((d) => DAYS[d]).join(', ')} às {s.send_time.slice(0, 5)} · {s.target_ids.length} cliente(s) · próximo: {s.active ? fmtNext(s.next_run_at) : '—'}
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
        {!hasSchedule && schedules.length === 0 && <p className="mt-3 text-[11px] text-[#85817C]">Nenhum agendamento ainda.</p>}
      </section>

      {/* 3. Clientes ↔ grupos */}
      <section className={CARD}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="uc-title mr-2 flex items-center gap-2 text-[17px] text-[#F7F5F1]">
            <Link2 size={17} className="text-[#D7141F]" /> Cliente → grupo do WhatsApp
          </h2>
          <input className={cn(SELECT, 'w-[200px]')} placeholder="Buscar cliente" value={q} onChange={(e) => setQ(e.target.value)} />
          <label className="flex items-center gap-1.5 text-[12px] text-[#CFCBC4]">
            <input type="checkbox" className="h-3.5 w-3.5 accent-[#D7141F]" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} /> Só sem grupo
          </label>
          <label className="flex items-center gap-1.5 text-[12px] text-[#CFCBC4]">
            <input type="checkbox" className="h-3.5 w-3.5 accent-[#D7141F]" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Mostrar contas não acompanhadas
          </label>
        </div>
        <div className="divide-y divide-[#1C1C1F] rounded-[5px] border border-[#222225]">
          {rows.length === 0 && <p className="p-4 text-[12px] text-[#85817C]">Nenhum cliente para mostrar.</p>}
          {rows.map((a) => {
            const t = targets.get(a.id)
            const jid = t?.group_jid ?? ''
            const known = groups.some((g) => g.jid === jid)
            return (
              <div key={a.id} className="grid items-center gap-2 px-3 py-2 md:grid-cols-[minmax(0,1.2fr)_150px_minmax(0,1.5fr)_auto]">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold text-[#F7F5F1]">{a.clientName ?? a.name}</p>
                  {a.clientName && <p className="truncate text-[11px] text-[#85817C]">{a.name}</p>}
                </div>
                <div>
                  {jid ? (
                    <Chip ok>Grupo conectado</Chip>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-[#F59E0B]/40 bg-[#F59E0B]/10 px-2.5 py-1 text-[11px] font-semibold text-[#FBBF24]">
                      <AlertTriangle size={11} /> Sem grupo
                    </span>
                  )}
                </div>
                <select
                  className={cn(SELECT, 'w-full min-w-0', !jid && 'text-[#85817C]')}
                  disabled={!canWrite}
                  value={jid}
                  onChange={(e) => {
                    const g = groups.find((x) => x.jid === e.target.value)
                    saveTarget(a.id, { group_jid: g?.jid ?? null, group_name: g?.name ?? null })
                  }}
                >
                  <option value="">{groups.length ? 'Escolher grupo…' : 'Sem grupos — conecte o WhatsApp'}</option>
                  {jid && !known && <option value={jid}>{t?.group_name ?? 'Grupo salvo'}</option>}
                  {groups.map((g) => (
                    <option key={g.jid} value={g.jid}>
                      {g.name} ({g.participants}){takenBy.has(g.jid) && takenBy.get(g.jid) !== a.id ? ' · já usado' : ''}
                    </option>
                  ))}
                </select>
                <button type="button" className={BTN_GHOST} disabled={!canWrite || !jid} onClick={() => saveTarget(a.id, { group_jid: null, group_name: null })} title="Desconectar do grupo">
                  <Unlink size={12} />
                </button>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}
