'use client'

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Bot, CalendarDays, Hand, Loader2, MessageCircle, Plus, Save, Send, Settings2, Trash2, X } from 'lucide-react'
import {
  conversationAction,
  deleteCadenceAction,
  deleteQuickReplyAction,
  disconnectGoogleAction,
  saveCadenceAction,
  saveQuickReplyAction,
  saveSettingsAction,
  sendMessageAction,
  setLeadFlagsAction,
  setStageAction,
  taskAction,
} from '../../../app/a/[ws]/sdr/whatsapp/actions'
import { FieldLabel, Toast, cn } from '../ui'

type Stage = { key: string; label: string }
type Lead = {
  id: string
  name: string
  phone: string
  city: string | null
  uf: string | null
  category: string | null
  stage: string
  status: string
  deal_value: number | null
  score: number | null
  needs_human: boolean
  handoff_reason: string | null
  ai_paused: boolean
  last_inbound_at: string | null
  last_outbound_at: string | null
  meeting_at: string | null
  source: string
}
type Cadence = { id: string; name: string; stage: string; active: boolean; steps: { wait_hours: number; body: string }[] }
type Quick = { id: string; stage: string | null; title: string; body: string }
type Tab = 'funil' | 'conversas' | 'config'

const INPUT = 'h-[36px] w-full rounded-[5px] border border-[#2A2A2E] bg-[#0B0B0C] px-3 text-[13px] text-[#ECE9E3] outline-none placeholder:text-[#85817C] focus:border-[#D7141F]'
const AREA = 'w-full rounded-[5px] border border-[#2A2A2E] bg-[#0B0B0C] p-3 text-[13px] text-[#ECE9E3] outline-none placeholder:text-[#85817C] focus:border-[#D7141F]'
const CARD = 'rounded-[6px] border border-[#222225] bg-[#111113] p-4'
const BTN = 'inline-flex items-center gap-1.5 rounded-[5px] border border-[#2A2A2E] px-3 py-1.5 text-[12px] font-semibold text-[#CFCBC4] hover:border-[#D7141F] hover:text-white disabled:opacity-40'
const PRIMARY = 'inline-flex items-center gap-1.5 rounded-[5px] bg-[#D7141F] px-4 py-2 text-[13px] font-semibold text-white hover:bg-[#B5121B] disabled:opacity-40'
const WEEK = [
  { v: 1, l: 'Seg' },
  { v: 2, l: 'Ter' },
  { v: 3, l: 'Qua' },
  { v: 4, l: 'Qui' },
  { v: 5, l: 'Sex' },
  { v: 6, l: 'Sáb' },
  { v: 0, l: 'Dom' },
]
const brl = (v: number | null | undefined) => (v == null ? '' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }))
const when = (iso: string | null) => (iso ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '—')

function Pill({ tone = 'gray', children }: { tone?: 'gray' | 'green' | 'red' | 'amber'; children: React.ReactNode }) {
  const t = { gray: 'bg-[#18181B] text-[#8E8A86]', green: 'bg-[#34D399]/12 text-[#34D399]', red: 'bg-[#FF3B47]/15 text-[#FF6B73]', amber: 'bg-[#F59E0B]/12 text-[#FBBF24]' }[tone]
  return <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.06em]', t)}>{children}</span>
}

function Switch({ on, onChange, disabled, label }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)} className={cn('relative h-[22px] w-[40px] rounded-full transition-colors disabled:opacity-40', on ? 'bg-[#D7141F]' : 'bg-[#2A2A2E]')}>
      <span className={cn('absolute top-[3px] h-4 w-4 rounded-full bg-white transition-all', on ? 'left-[21px]' : 'left-[3px]')} />
    </button>
  )
}

export function SdrWhatsappScreen(props: {
  ws: string
  canManage: boolean
  canOperate: boolean
  missingMigration: boolean
  initialTab: Tab
  googleStatus: string | null
  initialLead: string | null
  settings: any
  leads: Lead[]
  cadences: Cadence[]
  quickReplies: Quick[]
  google: { appConfigured: boolean; email: string | null; status: string | null; last_error: string | null }
  robot: { online: boolean; whatsapp: string }
  awaitingLeadIds: string[]
  stages: Stage[]
}) {
  const { ws, stages, settings } = props
  const router = useRouter()
  const [tab, setTab] = useState<Tab>(props.initialTab)
  const [openLead, setOpenLead] = useState<string | null>(props.initialLead)
  const [toast, setToast] = useState<string | null>(null)
  const flash = useCallback((t: string) => {
    setToast(t)
    window.setTimeout(() => setToast(null), 4000)
  }, [])

  useEffect(() => {
    const g = props.googleStatus
    if (!g) return
    const msg: Record<string, string> = {
      ok: 'Google Agenda conectado. A IA já pode marcar reuniões.',
      cancelado: 'Conexão com o Google cancelada.',
      nao_configurado: 'Falta configurar GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET no servidor.',
      sem_permissao: 'Só dono ou coordenador conectam o Google Agenda.',
      erro: 'O Google recusou a conexão. Tente de novo.',
      state_invalido: 'A conexão expirou. Clique em conectar de novo.',
    }
    flash(msg[g] ?? `Google: ${g}`)
  }, [props.googleStatus, flash])

  // Atualiza a cada 30 s (novas mensagens, IA, robô)
  useEffect(() => {
    const id = window.setInterval(() => document.visibilityState === 'visible' && router.refresh(), 30_000)
    return () => window.clearInterval(id)
  }, [router])

  const needHuman = props.leads.filter((l) => l.needs_human).length
  const aiOn = Boolean(settings?.ai_enabled)

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 pb-10 pt-5 sm:px-6 md:px-[30px] md:pt-[26px]">
      <div className="mb-5 flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <h1 className="uc-title text-[32px] text-[#F7F5F1] md:text-[40px]">SDR WhatsApp</h1>
          <p className="mt-1 text-[13px] text-[#8E8A86]">Funil, conversas com leads, IA respondendo 24h e cadências de follow-up. Quem envia é o robô do seu PC.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={props.robot.online && props.robot.whatsapp === 'ready' ? 'green' : 'red'}>Robô {props.robot.online ? (props.robot.whatsapp === 'ready' ? 'online' : 'sem WhatsApp') : 'desligado'}</Pill>
          <Pill tone={aiOn ? 'green' : 'gray'}>
            <Bot size={11} /> IA {aiOn ? (settings?.ai_mode === 'auto' ? 'automática' : 'sugere') : 'desligada'}
          </Pill>
          <Pill tone={props.google.status === 'active' ? 'green' : 'gray'}>
            <CalendarDays size={11} /> Agenda {props.google.status === 'active' ? 'conectada' : 'não conectada'}
          </Pill>
          {needHuman > 0 && (
            <Pill tone="red">
              <Hand size={11} /> {needHuman} precisam de você
            </Pill>
          )}
        </div>
      </div>

      {props.missingMigration && (
        <div className="mb-4 rounded-[6px] border border-[#F59E0B]/35 bg-[#F59E0B]/10 px-4 py-3 text-[12px] text-[#FBBF24]">
          Tabelas do SDR ausentes neste banco — aplique a migration <code>20261120120000_sdr_whatsapp.sql</code>.
        </div>
      )}

      <div className="mb-5 flex max-w-full overflow-x-auto rounded-[6px] border border-[#2A2A2E] bg-[#0B0B0C] p-0.5 sm:inline-flex" role="tablist">
        {(
          [
            ['funil', 'Funil'],
            ['conversas', `Conversas${needHuman ? ` (${needHuman})` : ''}`],
            ['config', 'Configurações'],
          ] as const
        ).map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cn('rounded-[5px] px-4 py-1.5 text-[13px] font-semibold', tab === k ? 'bg-[#D7141F] text-white' : 'text-[#8E8A86] hover:text-[#ECE9E3]')}>
            {l}
          </button>
        ))}
      </div>

      {tab === 'funil' && (
        <Funnel
          {...props}
          onOpen={(id: string) => {
            setOpenLead(id)
            setTab('conversas')
          }}
          flash={flash}
        />
      )}
      {tab === 'conversas' && <Conversations {...props} openLead={openLead} setOpenLead={setOpenLead} flash={flash} />}
      {tab === 'config' && <Config {...props} flash={flash} />}
      <Toast message={toast} />
    </div>
  )
}

// ===========================================================================
// Funil (kanban)
// ===========================================================================
function Funnel({ ws, stages, leads, canOperate, awaitingLeadIds, onOpen, flash }: any) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [q, setQ] = useState('')
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    return (leads as Lead[]).filter((l) => l.status !== 'opt_out' && (!t || l.name.toLowerCase().includes(t) || l.phone.includes(t) || (l.city ?? '').toLowerCase().includes(t)))
  }, [leads, q])
  const move = (id: string, stage: string) =>
    start(async () => {
      const r = await setStageAction(ws, id, stage)
      if (!r.ok) return flash(r.error)
      router.refresh()
    })
  return (
    <>
      <input className={cn(INPUT, 'mb-4 max-w-[360px]')} placeholder="Buscar por nome, telefone ou cidade" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="flex gap-3 overflow-x-auto pb-3">
        {(stages as Stage[]).map((s) => {
          const col = shown.filter((l) => l.stage === s.key)
          const total = col.reduce((t, l) => t + (l.deal_value ?? 0), 0)
          return (
            <section key={s.key} className="w-[260px] shrink-0 rounded-[6px] border border-[#222225] bg-[#0E0E10]" aria-label={`Etapa ${s.label}`}>
              <header className="flex items-center justify-between border-b border-[#1C1C1F] px-3 py-2.5">
                <span className="font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-[#CFCBC4]">
                  {s.label} <span className="text-[#8E8A86]">{col.length}</span>
                </span>
                {total > 0 && <span className="font-mono text-[11px] text-[#34D399]">{brl(total)}</span>}
              </header>
              <div className="max-h-[64vh] space-y-2 overflow-y-auto p-2">
                {col.slice(0, 120).map((l) => (
                  <article key={l.id} className="rounded-[5px] border border-[#222225] bg-[#111113] p-2.5 text-[12px]">
                    <button type="button" onClick={() => onOpen(l.id)} className="block w-full text-left">
                      <span className="block font-semibold text-[#ECE9E3]">{l.name}</span>
                      <span className="block text-[11px] text-[#85817C]">{[l.city, l.category].filter(Boolean).join(' · ') || `+${l.phone}`}</span>
                    </button>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {l.needs_human && <Pill tone="red">Precisa de você</Pill>}
                      {(awaitingLeadIds as string[]).includes(l.id) && <Pill tone="amber">IA aguardando</Pill>}
                      {l.ai_paused && <Pill>Você assumiu</Pill>}
                      {l.meeting_at && <Pill tone="green">Reunião {when(l.meeting_at)}</Pill>}
                      {l.deal_value != null && <Pill tone="green">{brl(l.deal_value)}</Pill>}
                    </div>
                    {canOperate && (
                      <select aria-label={`Mover ${l.name}`} disabled={pending} value={l.stage} onChange={(e) => move(l.id, e.target.value)} className="mt-2 h-[28px] w-full rounded-[4px] border border-[#2A2A2E] bg-[#0B0B0C] px-2 text-[11px] text-[#CFCBC4]">
                        {(stages as Stage[]).map((x) => (
                          <option key={x.key} value={x.key}>
                            {x.label}
                          </option>
                        ))}
                      </select>
                    )}
                  </article>
                ))}
                {col.length === 0 && <p className="px-1 py-6 text-center text-[11px] text-[#6E6A66]">Vazio</p>}
                {col.length > 120 && <p className="px-1 py-2 text-center text-[11px] text-[#8E8A86]">+{col.length - 120} (use a busca)</p>}
              </div>
            </section>
          )
        })}
      </div>
    </>
  )
}

// ===========================================================================
// Conversas
// ===========================================================================
function Conversations({ ws, leads, stages, canOperate, quickReplies, openLead, setOpenLead, flash }: any) {
  const router = useRouter()
  const [filter, setFilter] = useState<'atencao' | 'recentes' | 'todos'>('atencao')
  const [view, setView] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [text, setText] = useState('')
  const [pending, start] = useTransition()
  const list = useMemo(() => {
    const all = (leads as Lead[]).filter((l) => l.last_inbound_at || l.last_outbound_at || l.needs_human)
    if (filter === 'atencao') return all.filter((l) => l.needs_human || (l.last_inbound_at && (!l.last_outbound_at || l.last_inbound_at > l.last_outbound_at)))
    if (filter === 'recentes') return [...all].sort((a, b) => (b.last_inbound_at ?? b.last_outbound_at ?? '').localeCompare(a.last_inbound_at ?? a.last_outbound_at ?? '')).slice(0, 80)
    return leads as Lead[]
  }, [leads, filter])

  const load = useCallback(
    async (id: string) => {
      setLoading(true)
      const r = await conversationAction(ws, id)
      setLoading(false)
      if (!r.ok) return flash(r.error)
      setView(r.view)
    },
    [ws, flash],
  )
  useEffect(() => {
    if (!openLead) return
    load(openLead)
    const id = window.setInterval(() => load(openLead), 15_000)
    return () => window.clearInterval(id)
  }, [openLead, load])

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, ok?: string) =>
    start(async () => {
      const r = await fn()
      if (!r.ok) return flash(r.error ?? 'Não consegui.')
      if (ok) flash(ok)
      if (openLead) await load(openLead)
      router.refresh()
    })

  const l = view?.lead
  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <aside className={cn(CARD, 'p-0')}>
        <div className="flex gap-1 border-b border-[#1C1C1F] p-2">
          {(
            [
              ['atencao', 'Precisam de resposta'],
              ['recentes', 'Recentes'],
              ['todos', 'Todos'],
            ] as const
          ).map(([k, t]) => (
            <button key={k} type="button" onClick={() => setFilter(k)} className={cn('rounded-[4px] px-2.5 py-1 text-[11px] font-semibold', filter === k ? 'bg-[#D7141F] text-white' : 'text-[#8E8A86] hover:text-white')}>
              {t}
            </button>
          ))}
        </div>
        <ul className="max-h-[70vh] overflow-y-auto">
          {list.slice(0, 200).map((x: Lead) => (
            <li key={x.id}>
              <button type="button" onClick={() => setOpenLead(x.id)} className={cn('block w-full border-b border-[#18181B] px-3 py-2.5 text-left text-[12px] hover:bg-[#131315]', openLead === x.id && 'bg-[#1F0D0F]')}>
                <span className="flex items-center justify-between gap-2">
                  <b className="truncate text-[#ECE9E3]">{x.name}</b>
                  <span className="shrink-0 text-[10px] text-[#85817C]">{when(x.last_inbound_at ?? x.last_outbound_at)}</span>
                </span>
                <span className="mt-0.5 flex flex-wrap gap-1">
                  <Pill>{(stages as Stage[]).find((s) => s.key === x.stage)?.label ?? x.stage}</Pill>
                  {x.needs_human && <Pill tone="red">Você</Pill>}
                </span>
              </button>
            </li>
          ))}
          {list.length === 0 && <li className="px-3 py-8 text-center text-[12px] text-[#85817C]">Nenhuma conversa aqui.</li>}
        </ul>
      </aside>

      <section className={cn(CARD, 'min-h-[60vh]')}>
        {!openLead && <p className="py-20 text-center text-[13px] text-[#85817C]">Escolha uma conversa.</p>}
        {openLead && !view && loading && <Loader2 className="mx-auto mt-20 animate-spin text-[#D7141F]" />}
        {l && (
          <>
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-[18px] font-semibold text-[#F7F5F1]">{l.name}</h2>
                <p className="text-[12px] text-[#85817C]">
                  +{l.phone}
                  {l.city ? ` · ${l.city}${l.uf ? `/${l.uf}` : ''}` : ''}
                  {l.score != null ? ` · chance ${l.score}%` : ''}
                </p>
              </div>
              {canOperate && (
                <div className="flex flex-wrap items-center gap-2">
                  <select aria-label="Etapa" value={l.stage} onChange={(e) => act(() => setStageAction(ws, l.id, e.target.value), 'Etapa alterada.')} className="h-[32px] rounded-[5px] border border-[#2A2A2E] bg-[#0B0B0C] px-2 text-[12px] text-[#ECE9E3]">
                    {(stages as Stage[]).map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                  <button type="button" className={BTN} onClick={() => act(() => setLeadFlagsAction(ws, l.id, { ai_paused: !l.ai_paused }), l.ai_paused ? 'IA de volta neste lead.' : 'Você assumiu: a IA não responde este lead.')}>
                    <Bot size={13} /> {l.ai_paused ? 'Devolver para a IA' : 'Assumir conversa'}
                  </button>
                </div>
              )}
            </div>

            {l.needs_human && (
              <div className="mb-3 flex items-center justify-between gap-3 rounded-[5px] border border-[#FF3B47]/45 bg-[#FF3B47]/10 px-3 py-2 text-[12px] text-[#FFB3B8]">
                <span className="flex items-center gap-2">
                  <AlertTriangle size={14} /> {l.handoff_reason || 'O lead precisa de você.'}
                </span>
                {canOperate && (
                  <button type="button" className={BTN} onClick={() => act(() => setLeadFlagsAction(ws, l.id, { needs_human: false }), 'Resolvido.')}>
                    Resolvido
                  </button>
                )}
              </div>
            )}
            {view.cadence && (
              <p className="mb-3 text-[12px] text-[#8E8A86]">
                Follow-up “{view.cadence.name}” · passo {view.cadence.step}/{view.cadence.total} · próximo {view.cadence.next_run_at ? when(view.cadence.next_run_at) : 'aguardando envio'}
              </p>
            )}

            {view.tasks
              .filter((t: any) => t.status === 'aguardando_aprovacao')
              .map((t: any) => (
                <Approval key={t.id} task={t} disabled={!canOperate || pending} onApprove={(b: string) => act(() => taskAction(ws, t.id, 'approve', b), 'Enviando pelo robô…')} onCancel={() => act(() => taskAction(ws, t.id, 'cancel'), 'Descartado.')} />
              ))}

            <div className="mb-3 max-h-[46vh] space-y-2 overflow-y-auto rounded-[6px] bg-[#0B0B0C] p-3">
              {view.messages.map((m: any) => (
                <div key={m.id} className={cn('max-w-[78%] rounded-[8px] px-3 py-2 text-[13px]', m.direction === 'in' ? 'bg-[#18181B] text-[#ECE9E3]' : 'ml-auto bg-[#2A0E11] text-[#FFE4E6]')}>
                  <p className="whitespace-pre-wrap">{m.body}</p>
                  <p className="mt-1 text-right text-[10px] opacity-60">
                    {m.direction === 'out' ? ({ ai: 'IA', human: 'Você', cadence: 'Cadência', system: 'Sistema' } as Record<string, string>)[m.sent_by] ?? '' : 'Lead'} · {when(m.created_at)}
                  </p>
                </div>
              ))}
              {view.messages.length === 0 && <p className="py-6 text-center text-[12px] text-[#85817C]">Sem mensagens registradas ainda.</p>}
              {view.tasks
                .filter((t: any) => ['pendente', 'enviando', 'falhou'].includes(t.status))
                .map((t: any) => (
                  <div key={t.id} className="ml-auto max-w-[78%] rounded-[8px] border border-dashed border-[#3A3A3F] px-3 py-2 text-[12px] text-[#CFCBC4]">
                    <p className="whitespace-pre-wrap">{t.body}</p>
                    <p className="mt-1 flex items-center justify-end gap-2 text-[10px] opacity-70">
                      {t.status === 'falhou' ? `falhou: ${t.error ?? ''}` : `na fila do robô · ${when(t.scheduled_at)}${t.respects_window ? ' (horário de envio)' : ''}`}
                      {canOperate && t.status !== 'enviando' && (
                        <button type="button" className="underline" onClick={() => act(() => taskAction(ws, t.id, 'cancel'), 'Cancelado.')}>
                          cancelar
                        </button>
                      )}
                    </p>
                  </div>
                ))}
            </div>

            {canOperate && l.status !== 'opt_out' && (
              <div>
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {(quickReplies as Quick[])
                    .filter((q) => !q.stage || q.stage === l.stage)
                    .map((q) => (
                      <button key={q.id} type="button" className={BTN} onClick={() => setText(q.body.replace(/\{nome\}/gi, l.name))}>
                        {q.title}
                      </button>
                    ))}
                </div>
                <div className="flex gap-2">
                  <textarea className={AREA} rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Escreva uma mensagem… (o robô envia em instantes)" />
                  <button
                    type="button"
                    className={PRIMARY}
                    disabled={pending || !text.trim()}
                    onClick={() =>
                      act(async () => {
                        const r = await sendMessageAction(ws, l.id, text)
                        if (r.ok) setText('')
                        return r
                      }, 'Na fila do robô.')
                    }
                  >
                    <Send size={14} /> Enviar
                  </button>
                </div>
              </div>
            )}
            {l.status === 'opt_out' && <p className="text-[12px] text-[#FF6B73]">Este lead pediu para não receber mensagens (opt-out).</p>}
          </>
        )}
      </section>
    </div>
  )
}

function Approval({ task, disabled, onApprove, onCancel }: any) {
  const [body, setBody] = useState(task.body)
  return (
    <div className="mb-3 rounded-[6px] border border-[#F59E0B]/40 bg-[#F59E0B]/8 p-3">
      <p className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-[#FBBF24]">
        <Bot size={13} /> Sugestão da IA aguardando você
      </p>
      <textarea className={AREA} rows={3} value={body} onChange={(e) => setBody(e.target.value)} />
      <div className="mt-2 flex gap-2">
        <button type="button" className={PRIMARY} disabled={disabled} onClick={() => onApprove(body)}>
          <Send size={13} /> Enviar
        </button>
        <button type="button" className={BTN} disabled={disabled} onClick={onCancel}>
          <X size={13} /> Descartar
        </button>
      </div>
    </div>
  )
}

// ===========================================================================
// Configurações
// ===========================================================================
function Days({ value, onChange, disabled }: { value: number[]; onChange: (v: number[]) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1">
      {WEEK.map((d) => (
        <button
          key={d.v}
          type="button"
          disabled={disabled}
          aria-pressed={value.includes(d.v)}
          onClick={() => onChange(value.includes(d.v) ? value.filter((x) => x !== d.v) : [...value, d.v])}
          className={cn('h-[30px] w-[42px] rounded-[4px] border text-[12px] font-semibold', value.includes(d.v) ? 'border-[#D7141F] bg-[#D7141F] text-white' : 'border-[#2A2A2E] text-[#8E8A86]')}
        >
          {d.l}
        </button>
      ))}
    </div>
  )
}

function Config({ ws, settings, canManage, canOperate, google, cadences, quickReplies, stages, flash }: any) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const s0 = settings ?? {}
  const [f, setF] = useState(() => ({
    ai_enabled: Boolean(s0.ai_enabled),
    ai_mode: s0.ai_mode ?? 'auto',
    ai_max_replies_per_lead_day: s0.ai_max_replies_per_lead_day ?? 12,
    ai_reply_delay_seconds: s0.ai_reply_delay_seconds ?? 45,
    playbook: s0.playbook ?? '',
    prices: s0.prices ?? '',
    forbidden: s0.forbidden ?? '',
    outreach_days: s0.outreach_days ?? [1, 2, 3, 4, 5, 6],
    outreach_start: String(s0.outreach_start ?? '09:00').slice(0, 5),
    outreach_end: String(s0.outreach_end ?? '20:00').slice(0, 5),
    daily_new_contacts: s0.daily_new_contacts ?? 50,
    interval_min_seconds: s0.interval_min_seconds ?? 60,
    interval_max_seconds: s0.interval_max_seconds ?? 180,
    prospect_enabled: Boolean(s0.prospect_enabled),
    cities: ((s0.prospect_cities ?? []) as { city: string; uf: string | null }[]).map((c) => `${c.city}${c.uf ? `/${c.uf}` : ''}`).join('\n'),
    prospect_every_hours: s0.prospect_every_hours ?? 24,
    meeting_minutes: s0.meeting_minutes ?? 30,
    meeting_days: s0.meeting_days ?? [1, 2, 3, 4, 5],
    meeting_start: String(s0.meeting_start ?? '10:00').slice(0, 5),
    meeting_end: String(s0.meeting_end ?? '17:00').slice(0, 5),
  }))
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }))
  const ro = !canManage

  const save = () =>
    start(async () => {
      const { cities, ...rest } = f
      const prospect_cities = cities
        .split('\n')
        .map((line: string) => line.trim())
        .filter(Boolean)
        .map((line: string) => {
          const [city, uf] = line.split('/').map((p) => p.trim())
          return { city: city ?? '', uf: uf ? uf.toUpperCase() : null }
        })
      const r = await saveSettingsAction(ws, { ...rest, prospect_cities })
      if (!r.ok) return flash(r.error)
      flash('Configurações salvas. O robô aplica em até 1 minuto.')
      router.refresh()
    })

  return (
    <div className="space-y-5">
      {ro && <p className="text-[12px] text-[#8E8A86]">Só dono ou coordenador alteram as configurações.</p>}

      <section className={CARD}>
        <h2 className="mb-3 flex items-center gap-2 text-[15px] font-semibold text-[#F7F5F1]">
          <Bot size={16} className="text-[#D7141F]" /> IA respondendo leads (24h)
        </h2>
        <div className="mb-3 flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-[13px] text-[#ECE9E3]">
            <Switch on={f.ai_enabled} disabled={ro} onChange={(v) => set({ ai_enabled: v })} label="Ligar IA" /> IA ligada
          </label>
          <select disabled={ro} value={f.ai_mode} onChange={(e) => set({ ai_mode: e.target.value })} className={cn(INPUT, 'w-auto')} aria-label="Modo da IA">
            <option value="auto">Responde sozinha</option>
            <option value="suggest">Só sugere (você aprova)</option>
          </select>
          <label className="text-[12px] text-[#8E8A86]">
            Máx. respostas/lead/dia{' '}
            <input type="number" min={1} max={100} disabled={ro} className={cn(INPUT, 'ml-1 inline-block w-[80px]')} value={f.ai_max_replies_per_lead_day} onChange={(e) => set({ ai_max_replies_per_lead_day: Number(e.target.value) })} />
          </label>
          <label className="text-[12px] text-[#8E8A86]">
            Espera antes de responder (s){' '}
            <input type="number" min={0} max={900} disabled={ro} className={cn(INPUT, 'ml-1 inline-block w-[80px]')} value={f.ai_reply_delay_seconds} onChange={(e) => set({ ai_reply_delay_seconds: Number(e.target.value) })} />
          </label>
        </div>
        <div className="grid gap-3 lg:grid-cols-3">
          <label>
            <FieldLabel>Roteiro (quem você é, o que oferece, como qualificar)</FieldLabel>
            <textarea disabled={ro} rows={8} className={AREA} value={f.playbook} onChange={(e) => set({ playbook: e.target.value })} placeholder="Ex.: Somos a Undercut, assessoria de marketing para restaurantes em Campinas. Fazemos anúncios no Instagram/Facebook e otimização de cardápio no iFood. Pergunte quantos pedidos fazem por dia, se já anunciam e quem decide…" />
          </label>
          <label>
            <FieldLabel>Preços e condições que a IA pode falar</FieldLabel>
            <textarea disabled={ro} rows={8} className={AREA} value={f.prices} onChange={(e) => set({ prices: e.target.value })} placeholder="Ex.: Plano Start R$ 1.500/mês (gestão de anúncios). Verba de anúncio à parte, mínimo R$ 600/mês. Sem fidelidade." />
          </label>
          <label>
            <FieldLabel>Nunca falar / prometer</FieldLabel>
            <textarea disabled={ro} rows={8} className={AREA} value={f.forbidden} onChange={(e) => set({ forbidden: e.target.value })} placeholder="Ex.: Não dar desconto. Não prometer número de pedidos. Não falar de concorrentes." />
          </label>
        </div>
      </section>

      <section className={CARD}>
        <h2 className="mb-3 flex items-center gap-2 text-[15px] font-semibold text-[#F7F5F1]">
          <MessageCircle size={16} className="text-[#D7141F]" /> Mensagens que você inicia (1º contato e follow-up)
        </h2>
        <div className="grid gap-4 md:grid-cols-[auto_1fr]">
          <div>
            <FieldLabel>Dias</FieldLabel>
            <Days value={f.outreach_days} disabled={ro} onChange={(v) => set({ outreach_days: v })} />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <label>
              <FieldLabel>Das</FieldLabel>
              <input type="time" disabled={ro} className={INPUT} value={f.outreach_start} onChange={(e) => set({ outreach_start: e.target.value })} />
            </label>
            <label>
              <FieldLabel>Até</FieldLabel>
              <input type="time" disabled={ro} className={INPUT} value={f.outreach_end} onChange={(e) => set({ outreach_end: e.target.value })} />
            </label>
            <label>
              <FieldLabel>Novos contatos/dia</FieldLabel>
              <input type="number" min={0} max={300} disabled={ro} className={INPUT} value={f.daily_new_contacts} onChange={(e) => set({ daily_new_contacts: Number(e.target.value) })} />
            </label>
            <label>
              <FieldLabel>Intervalo mín. (s)</FieldLabel>
              <input type="number" min={20} max={3600} disabled={ro} className={INPUT} value={f.interval_min_seconds} onChange={(e) => set({ interval_min_seconds: Number(e.target.value) })} />
            </label>
            <label>
              <FieldLabel>Intervalo máx. (s)</FieldLabel>
              <input type="number" min={20} max={3600} disabled={ro} className={INPUT} value={f.interval_max_seconds} onChange={(e) => set({ interval_max_seconds: Number(e.target.value) })} />
            </label>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-[#85817C]">Respostas a quem escreveu primeiro saem a qualquer hora. Comece com 30–50 novos contatos/dia num número “aquecido”.</p>
      </section>

      <section className={CARD}>
        <h2 className="mb-3 text-[15px] font-semibold text-[#F7F5F1]">Prospecção contínua (food)</h2>
        <div className="grid gap-4 md:grid-cols-[1fr_260px]">
          <label>
            <FieldLabel>Cidades (uma por linha, “Cidade/UF”) — o agente pesquisa em rodízio</FieldLabel>
            <textarea disabled={ro} rows={4} className={AREA} value={f.cities} onChange={(e) => set({ cities: e.target.value })} placeholder={'Campinas/SP\nValinhos/SP\nVinhedo/SP'} />
          </label>
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-[13px] text-[#ECE9E3]">
              <Switch on={f.prospect_enabled} disabled={ro} onChange={(v) => set({ prospect_enabled: v })} label="Ligar prospecção contínua" /> Prospectar sozinho
            </label>
            <label>
              <FieldLabel>Nova pesquisa a cada (horas)</FieldLabel>
              <input type="number" min={1} max={168} disabled={ro} className={INPUT} value={f.prospect_every_hours} onChange={(e) => set({ prospect_every_hours: Number(e.target.value) })} />
            </label>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-[#85817C]">Empresas novas com WhatsApp entram no funil e recebem o 1º contato (cadência da etapa “Novo”), respeitando horário e limite diário.</p>
      </section>

      <section className={CARD}>
        <h2 className="mb-3 flex items-center gap-2 text-[15px] font-semibold text-[#F7F5F1]">
          <CalendarDays size={16} className="text-[#D7141F]" /> Reuniões (Google Agenda)
        </h2>
        <div className="mb-3 flex flex-wrap items-center gap-3 text-[13px]">
          {google.status === 'active' ? (
            <>
              <Pill tone="green">Conectado</Pill> <span className="text-[#CFCBC4]">{google.email}</span>
              {canManage && (
                <button
                  type="button"
                  className={BTN}
                  onClick={() =>
                    start(async () => {
                      const r = await disconnectGoogleAction(ws)
                      flash(r.ok ? 'Google Agenda desconectado.' : r.error)
                      router.refresh()
                    })
                  }
                >
                  Desconectar
                </button>
              )}
            </>
          ) : (
            <>
              <Pill tone={google.status === 'error' ? 'red' : 'gray'}>{google.status === 'error' ? 'Reconectar' : 'Não conectado'}</Pill>
              {google.last_error && <span className="text-[12px] text-[#FF6B73]">{google.last_error}</span>}
              {canManage && (google.appConfigured ? <a className={PRIMARY} href={`/api/google/oauth/start?ws=${encodeURIComponent(ws)}`}>Conectar Google Agenda</a> : <span className="text-[12px] text-[#FBBF24]">Falta GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET no servidor.</span>)}
            </>
          )}
        </div>
        <div className="grid gap-4 md:grid-cols-[auto_1fr]">
          <div>
            <FieldLabel>Dias de reunião</FieldLabel>
            <Days value={f.meeting_days} disabled={ro} onChange={(v) => set({ meeting_days: v })} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <label>
              <FieldLabel>Das</FieldLabel>
              <input type="time" disabled={ro} className={INPUT} value={f.meeting_start} onChange={(e) => set({ meeting_start: e.target.value })} />
            </label>
            <label>
              <FieldLabel>Até</FieldLabel>
              <input type="time" disabled={ro} className={INPUT} value={f.meeting_end} onChange={(e) => set({ meeting_end: e.target.value })} />
            </label>
            <label>
              <FieldLabel>Duração (min)</FieldLabel>
              <input type="number" min={10} max={180} disabled={ro} className={INPUT} value={f.meeting_minutes} onChange={(e) => set({ meeting_minutes: Number(e.target.value) })} />
            </label>
          </div>
        </div>
      </section>

      {canManage && (
        <button type="button" className={PRIMARY} disabled={pending} onClick={save}>
          {pending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Salvar configurações
        </button>
      )}

      <CadencesEditor ws={ws} cadences={cadences} stages={stages} canEdit={canOperate} canDelete={canManage} flash={flash} />
      <QuickEditor ws={ws} quick={quickReplies} stages={stages} canEdit={canOperate} canDelete={canManage} flash={flash} />
    </div>
  )
}

function CadencesEditor({ ws, cadences, stages, canEdit, canDelete, flash }: any) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [list, setList] = useState<Cadence[]>(cadences)
  useEffect(() => setList(cadences), [cadences])
  const upd = (i: number, patch: Partial<Cadence>) => setList((l) => l.map((c, j) => (j === i ? { ...c, ...patch } : c)))
  const save = (c: Cadence) =>
    start(async () => {
      const r = await saveCadenceAction(ws, { ...(c.id.startsWith('novo') ? {} : { id: c.id }), name: c.name, stage: c.stage, active: c.active, steps: c.steps.map((s) => ({ wait_hours: Number(s.wait_hours) || 0, body: s.body })) })
      flash(r.ok ? 'Cadência salva.' : r.error)
      if (r.ok) router.refresh()
    })
  return (
    <section className={CARD}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold text-[#F7F5F1]">
          <Settings2 size={16} className="text-[#D7141F]" /> Cadências de follow-up por etapa
        </h2>
        {canEdit && (
          <button type="button" className={BTN} onClick={() => setList((l) => [...l, { id: `novo-${Date.now()}`, name: 'Nova cadência', stage: 'contatado', active: false, steps: [{ wait_hours: 24, body: 'Oi, {nome}! …' }] }])}>
            <Plus size={13} /> Nova
          </button>
        )}
      </div>
      <p className="mb-3 text-[11px] text-[#85817C]">Cada passo espera X horas depois do envio anterior. A cadência para sozinha quando o lead responde, muda de etapa ou pede para sair. Use {'{nome}'}.</p>
      <div className="space-y-3">
        {list.map((c, i) => (
          <div key={c.id} className="rounded-[6px] border border-[#222225] bg-[#0E0E10] p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <input disabled={!canEdit} className={cn(INPUT, 'w-[220px]')} value={c.name} onChange={(e) => upd(i, { name: e.target.value })} aria-label="Nome da cadência" />
              <select disabled={!canEdit} className={cn(INPUT, 'w-[160px]')} value={c.stage} onChange={(e) => upd(i, { stage: e.target.value })} aria-label="Etapa">
                {(stages as Stage[])
                  .filter((s) => !['cliente', 'perdido'].includes(s.key))
                  .map((s) => (
                    <option key={s.key} value={s.key}>
                      Etapa: {s.label}
                    </option>
                  ))}
              </select>
              <label className="flex items-center gap-2 text-[12px] text-[#CFCBC4]">
                <Switch on={c.active} disabled={!canEdit} onChange={(v) => upd(i, { active: v })} label="Ativa" /> Ativa
              </label>
              {canEdit && (
                <button type="button" className={PRIMARY} disabled={pending} onClick={() => save(c)}>
                  <Save size={13} /> Salvar
                </button>
              )}
              {canDelete && !c.id.startsWith('novo') && (
                <button
                  type="button"
                  className={BTN}
                  disabled={pending}
                  onClick={() =>
                    window.confirm(`Apagar a cadência "${c.name}"?`) &&
                    start(async () => {
                      const r = await deleteCadenceAction(ws, c.id)
                      flash(r.ok ? 'Cadência apagada.' : r.error)
                      router.refresh()
                    })
                  }
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>
            {c.steps.map((s, k) => (
              <div key={k} className="mb-2 grid gap-2 sm:grid-cols-[110px_1fr_auto]">
                <label className="text-[11px] text-[#8E8A86]">
                  Passo {k + 1} · após (h)
                  <input disabled={!canEdit} type="number" min={0} className={INPUT} value={s.wait_hours} onChange={(e) => upd(i, { steps: c.steps.map((x, j) => (j === k ? { ...x, wait_hours: Number(e.target.value) } : x)) })} />
                </label>
                <textarea disabled={!canEdit} rows={2} className={AREA} value={s.body} onChange={(e) => upd(i, { steps: c.steps.map((x, j) => (j === k ? { ...x, body: e.target.value } : x)) })} aria-label={`Mensagem do passo ${k + 1}`} />
                {canEdit && c.steps.length > 1 && (
                  <button type="button" className={BTN} aria-label="Remover passo" onClick={() => upd(i, { steps: c.steps.filter((_, j) => j !== k) })}>
                    <X size={13} />
                  </button>
                )}
              </div>
            ))}
            {canEdit && c.steps.length < 12 && (
              <button type="button" className={BTN} onClick={() => upd(i, { steps: [...c.steps, { wait_hours: 48, body: '' }] })}>
                <Plus size={13} /> Passo
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

function QuickEditor({ ws, quick, stages, canEdit, canDelete, flash }: any) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [draft, setDraft] = useState({ stage: '', title: '', body: '' })
  return (
    <section className={CARD}>
      <h2 className="mb-3 text-[15px] font-semibold text-[#F7F5F1]">Respostas rápidas (aparecem no painel do WhatsApp Web)</h2>
      <div className="mb-3 space-y-2">
        {(quick as Quick[]).map((q) => (
          <div key={q.id} className="flex items-start justify-between gap-3 rounded-[5px] border border-[#222225] bg-[#0E0E10] px-3 py-2 text-[12px]">
            <div>
              <b className="text-[#ECE9E3]">{q.title}</b> <span className="text-[#8E8A86]">· {q.stage ? (stages as Stage[]).find((s) => s.key === q.stage)?.label : 'todas as etapas'}</span>
              <p className="mt-0.5 whitespace-pre-wrap text-[#CFCBC4]">{q.body}</p>
            </div>
            {canDelete && (
              <button
                type="button"
                className={BTN}
                disabled={pending}
                aria-label={`Apagar ${q.title}`}
                onClick={() =>
                  start(async () => {
                    const r = await deleteQuickReplyAction(ws, q.id)
                    flash(r.ok ? 'Apagada.' : r.error)
                    router.refresh()
                  })
                }
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        ))}
      </div>
      {canEdit && (
        <div className="grid gap-2 md:grid-cols-[180px_200px_1fr_auto]">
          <select className={INPUT} value={draft.stage} onChange={(e) => setDraft({ ...draft, stage: e.target.value })} aria-label="Etapa da resposta">
            <option value="">Todas as etapas</option>
            {(stages as Stage[]).map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
          <input className={INPUT} placeholder="Título" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          <input className={INPUT} placeholder="Texto (use {nome})" value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
          <button
            type="button"
            className={PRIMARY}
            disabled={pending || !draft.title.trim() || !draft.body.trim()}
            onClick={() =>
              start(async () => {
                const r = await saveQuickReplyAction(ws, { stage: draft.stage || null, title: draft.title, body: draft.body })
                flash(r.ok ? 'Resposta rápida criada.' : r.error)
                if (r.ok) {
                  setDraft({ stage: '', title: '', body: '' })
                  router.refresh()
                }
              })
            }
          >
            <Plus size={13} /> Adicionar
          </button>
        </div>
      )}
    </section>
  )
}
