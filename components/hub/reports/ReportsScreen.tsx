'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import {
  AlertTriangle,
  CalendarClock,
  Check,
  CheckCheck,
  Copy,
  Download,
  ExternalLink,
  History,
  Layers,
  Loader2,
  MessageCircle,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  Send,
  Settings2,
  Smartphone,
  Trash2,
  Users,
  X,
} from 'lucide-react'
import {
  deleteScheduleAction,
  groupsAction,
  historyAction,
  markSentAction,
  previewAction,
  queueSendAction,
  requestGroupsSyncAction,
  saveReportAction,
  saveScheduleAction,
  saveSettingsAction,
  saveTargetAction,
  setReportStatusAction,
  toggleScheduleAction,
} from '@/app/a/[ws]/relatorios/actions'
import { whatsappStatusAction } from '@/app/a/[ws]/disparos/actions'
import type { WhatsappSession } from '@/lib/db/disparos'
import { KIND_LABEL } from '@/lib/reports/blocks'
import { composeReport, headline, int, money, PERIOD_KEYS, PERIOD_LABEL, reportMessage, type PeriodKey, type ReportPayload, type ReportSource, type Show } from '@/lib/reports/format'
import type { GroupView, HistoryRow, ReportsData, ScheduleView, SettingsView, TargetView } from '@/lib/reports/views'
import { FieldLabel, Toast, Toggle, cn } from '@/components/hub/ui'
import { WhatsAppCard } from '@/components/hub/prospect/DisparosScreen'
import { PageHeader, Pill, Segmented } from '@/components/hub/prospect/shared'

const CARD = 'rounded-[6px] border border-[#222225] bg-[#111113] p-4 md:p-5'
const BTN_PRIMARY =
  'inline-flex items-center justify-center gap-1.5 rounded-[5px] bg-[#D7141F] px-4 py-2 text-[13px] font-semibold text-white hover:bg-[#B5121B] disabled:opacity-40'
const BTN_GHOST =
  'inline-flex items-center gap-1.5 rounded-[5px] border border-[#2A2A2E] px-3 py-1.5 text-[12px] font-semibold text-[#CFCBC4] hover:border-[#D7141F] hover:text-white disabled:opacity-40'
const SELECT = 'h-[34px] rounded-[5px] border border-[#2A2A2E] bg-[#0B0B0C] px-2 text-[12px] text-[#ECE9E3] outline-none focus:border-[#D7141F]'

const KIND_COLOR: Record<string, string> = {
  sales: '#22C55E',
  messages: '#38BDF8',
  profile: '#E879F9',
  traffic: '#F59E0B',
  engagement: '#F472B6',
  leads: '#A78BFA',
  awareness: '#94A3B8',
  other: '#94A3B8',
}
const PRESETS = [
  { key: 'safe', label: 'Seguro · 1 a 3 min', min: 60, max: 180 },
  { key: 'safer', label: 'Mais seguro · 2 a 5 min', min: 120, max: 300 },
  { key: 'fast', label: 'Rápido · 30 s a 1,5 min', min: 30, max: 90 },
] as const
const DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const STATUS_TONE: Record<HistoryRow['status'], 'neutral' | 'green' | 'amber' | 'red'> = {
  rascunho: 'neutral',
  agendado: 'amber',
  enviando: 'amber',
  enviado: 'green',
  falhou: 'red',
  cancelado: 'neutral',
}

const fmtDateTime = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '—'
const fmtTime = (iso: string) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
const br = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`
const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 40) || 'relatorio'

type PreviewState = { state: 'loading' | 'ok' | 'error'; source?: ReportSource; error?: string }
type Tab = 'gerador' | 'historico' | 'agendamentos' | 'modelos'

export function ReportsScreen({
  ws,
  workspaceName,
  canWrite,
  canManageWhatsapp,
  initialSession,
  data,
}: {
  ws: string
  workspaceName: string
  canWrite: boolean
  canManageWhatsapp: boolean
  initialSession: WhatsappSession | null
  data: ReportsData
}) {
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<number | undefined>(undefined)
  const flash = useCallback((t: string) => {
    setToast(t)
    window.clearTimeout(toastTimer.current) // aviso novo não some com o timer do anterior
    toastTimer.current = window.setTimeout(() => setToast(null), 6000)
  }, [])
  const [tab, setTab] = useState<Tab>('gerador')

  // ---- WhatsApp: status real (robô) + grupos -------------------------------------------
  const [session, setSession] = useState<WhatsappSession | null>(initialSession)
  const [workerOnline, setWorkerOnline] = useState<boolean | null>(null)
  const [groups, setGroups] = useState<GroupView[]>(data.groups)
  const [groupsSyncedAt, setGroupsSyncedAt] = useState<string | null>(data.groupsSyncedAt)
  const [groupsRequestedAt, setGroupsRequestedAt] = useState<string | null>(null)
  useEffect(() => {
    if (!canManageWhatsapp) return
    let alive = true
    const tick = async () => {
      const r = await whatsappStatusAction(ws).catch(() => null)
      if (!alive || !r || !r.ok) return
      setSession(r.session)
      setWorkerOnline(r.workerOnline)
    }
    tick()
    const id = window.setInterval(tick, 4000)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [ws, canManageWhatsapp])
  const waiting = Boolean(groupsRequestedAt && (!groupsSyncedAt || Date.parse(groupsRequestedAt) > Date.parse(groupsSyncedAt)))
  const ready = session?.status === 'ready'
  // Grupos do número conectado (em Disparos ou aqui): o robô lê sozinho ao conectar; a tela acompanha.
  useEffect(() => {
    let alive = true
    const tick = async () => {
      const r = await groupsAction(ws).catch(() => null)
      if (!alive || !r || !r.ok) return
      setGroups(r.groups)
      setGroupsSyncedAt(r.syncedAt)
      setGroupsRequestedAt(r.requestedAt)
    }
    tick()
    const id = window.setInterval(tick, waiting || (ready && groups.length === 0) ? 3000 : 20000)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [ws, waiting, ready, groups.length])
  const requestGroups = useCallback(
    async (quiet = false) => {
      const r = await requestGroupsSyncAction(ws)
      if (!r.ok) return quiet ? undefined : flash(r.error)
      setGroupsRequestedAt(new Date().toISOString())
      if (!quiet) flash('Pedido enviado ao robô — os grupos aparecem em instantes.')
    },
    [ws, flash],
  )
  // Acabou de conectar (ou ainda sem grupos): pede a leitura uma vez, sem clique.
  const autoAsked = useRef(false)
  useEffect(() => {
    if (!ready || !canManageWhatsapp || !canWrite || autoAsked.current) return
    if (groups.length === 0 || !groupsSyncedAt) {
      autoAsked.current = true
      requestGroups(true)
    }
  }, [ready, canManageWhatsapp, canWrite, groups.length, groupsSyncedAt, requestGroups])

  // ---- Modelo (blocos, período, intervalo) ----------------------------------------------
  const [settings, setSettings] = useState<SettingsView>(data.settings)
  const [period, setPeriod] = useState<PeriodKey>(data.settings.period)
  const [compare, setCompare] = useState(data.settings.compare)

  // ---- Configuração por conta ---------------------------------------------------------------
  const [targets, setTargets] = useState<Map<string, TargetView>>(() => new Map(data.targets.map((t) => [t.ad_account_id, t])))
  const targetOf = useCallback(
    (accountId: string): TargetView => targets.get(accountId) ?? { id: '', ad_account_id: accountId, group_jid: null, group_name: null, campaign_mode: 'merged', campaign_ids: [] },
    [targets],
  )
  const saveTarget = async (accountId: string, patch: Partial<TargetView>) => {
    const cur = { ...targetOf(accountId), ...patch }
    setTargets((m) => new Map(m).set(accountId, cur))
    const r = await saveTargetAction(ws, { adAccountId: accountId, groupJid: cur.group_jid, groupName: cur.group_name, campaignMode: cur.campaign_mode, campaignIds: cur.campaign_ids })
    if (!r.ok) return flash(r.error)
    setTargets((m) => new Map(m).set(accountId, r.target))
  }

  // ---- Prévias reais (Meta) -----------------------------------------------------------------
  const [previews, setPreviews] = useState<Map<string, PreviewState>>(new Map())
  const gen = useRef(0)
  const loadPreviews = useCallback(
    async (ids: string[]) => {
      const run = ++gen.current
      setPreviews((m) => {
        const n = new Map(m)
        for (const id of ids) n.set(id, { state: 'loading' })
        return n
      })
      const chunks: string[][] = []
      for (let i = 0; i < ids.length; i += 4) chunks.push(ids.slice(i, i + 4))
      let next = 0
      await Promise.all(
        [0, 1].map(async () => {
          while (next < chunks.length) {
            const chunk = chunks[next++]!
            const r = await previewAction(ws, { accountIds: chunk, period, compare }).catch(() => null)
            if (run !== gen.current) return
            setPreviews((m) => {
              const n = new Map(m)
              for (const id of chunk) {
                const it = r && r.ok ? r.items.find((x) => x.adAccountId === id) : null
                n.set(id, it?.source ? { state: 'ok', source: it.source } : { state: 'error', error: it?.error ?? (r && !r.ok ? r.error : 'Falha ao consultar a Meta.') })
              }
              return n
            })
          }
        }),
      )
    },
    [ws, period, compare],
  )
  useEffect(() => {
    if (data.ready && data.accounts.length) loadPreviews(data.accounts.map((a) => a.id))
  }, [loadPreviews, data.ready, data.accounts])

  const [edited, setEdited] = useState<Map<string, string>>(new Map())
  const [savedId, setSavedId] = useState<Map<string, string>>(new Map())
  useEffect(() => {
    setEdited(new Map())
    setSavedId(new Map())
  }, [period, compare])

  const payloadOf = useCallback(
    (accountId: string): ReportPayload | null => {
      const p = previews.get(accountId)
      if (p?.state !== 'ok' || !p.source) return null
      const t = targetOf(accountId)
      return composeReport(p.source, { mode: t.campaign_mode, selected: t.campaign_ids, show: settings.show })
    },
    [previews, targetOf, settings.show],
  )
  const messageOf = (accountId: string, p: ReportPayload) => edited.get(accountId) ?? reportMessage(p)

  const [focus, setFocus] = useState<string | null>(data.accounts[0]?.id ?? null)
  const [checked, setChecked] = useState<Set<string>>(new Set())

  // ---- Histórico ---------------------------------------------------------------------------------
  const [history, setHistory] = useState<HistoryRow[]>(data.history)
  const refreshHistory = useCallback(async () => {
    const r = await historyAction(ws).catch(() => null)
    if (r?.ok) setHistory(r.rows)
  }, [ws])
  const live = history.some((h) => h.status === 'agendado' || h.status === 'enviando')
  useEffect(() => {
    if (!live) return
    const id = window.setInterval(refreshHistory, 8000)
    return () => window.clearInterval(id)
  }, [live, refreshHistory])

  const [schedules, setSchedules] = useState<ScheduleView[]>(data.schedules)

  if (!data.ready) {
    return (
      <div className="mx-auto w-full max-w-[1400px] px-4 pb-10 pt-5 sm:px-6 md:px-[30px] md:pt-[26px]">
        <PageHeader title="Relatórios" description="Relatórios reais da Meta enviados nos grupos do WhatsApp dos clientes." />
        <div className="rounded-[6px] border border-[#F59E0B]/35 bg-[#F59E0B]/10 px-4 py-3 text-[12px] text-[#FBBF24]">
          As tabelas de relatórios ainda não existem neste banco — aplique a migration <code>20261122120000_reports_whatsapp.sql</code>.
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 pb-28 pt-5 sm:px-6 md:px-[30px] md:pt-[26px]">
      <PageHeader
        title="Relatórios"
        description="Métricas reais do Gerenciador de Anúncios por objetivo, enviadas no grupo do WhatsApp de cada cliente."
        actions={
          <Segmented<Tab>
            ariaLabel="Seção"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'gerador', label: 'Gerador' },
              { value: 'historico', label: `Histórico${history.length ? ` (${history.length})` : ''}` },
              { value: 'agendamentos', label: 'Agendamentos' },
              { value: 'modelos', label: 'Modelos' },
            ]}
          />
        }
      />

      <WhatsappBar
        ws={ws}
        canManage={canManageWhatsapp}
        session={session}
        setSession={setSession}
        workerOnline={workerOnline}
        groups={groups}
        linkedTo={(jid) =>
          data.accounts
            .filter((a) => targets.get(a.id)?.group_jid === jid)
            .map((a) => a.clientName ?? a.name)
        }
        groupsSyncedAt={groupsSyncedAt}
        waiting={waiting}
        onRequestGroups={() => requestGroups()}
        canWrite={canWrite}
        flash={flash}
      />

      {tab === 'gerador' && (
        <Generator
          ws={ws}
          data={data}
          canWrite={canWrite}
          groups={groups}
          period={period}
          setPeriod={setPeriod}
          compare={compare}
          setCompare={setCompare}
          previews={previews}
          reload={() => loadPreviews(data.accounts.map((a) => a.id))}
          reloadOne={(id) => loadPreviews([id])}
          targetOf={targetOf}
          saveTarget={saveTarget}
          payloadOf={payloadOf}
          messageOf={messageOf}
          setEdited={(id, text) => setEdited((m) => new Map(m).set(id, text))}
          resetEdited={(id) =>
            setEdited((m) => {
              const n = new Map(m)
              n.delete(id)
              return n
            })
          }
          savedId={savedId}
          setSavedId={(id, rid) => setSavedId((m) => new Map(m).set(id, rid))}
          focus={focus}
          setFocus={setFocus}
          checked={checked}
          setChecked={setChecked}
          settings={settings}
          onHistory={(row) => setHistory((h) => [row, ...h.filter((x) => x.id !== row.id)])}
          refreshHistory={refreshHistory}
          linked={session?.status === 'ready' || session?.status === 'syncing'}
          flash={flash}
        />
      )}
      {tab === 'historico' && <HistoryTab ws={ws} rows={history} canWrite={canWrite} refresh={refreshHistory} flash={flash} />}
      {tab === 'agendamentos' && (
        <SchedulesTab
          ws={ws}
          accounts={data.accounts}
          targets={targets}
          setTargets={setTargets}
          schedules={schedules}
          setSchedules={setSchedules}
          settings={settings}
          whatsapp={data.whatsapp}
          canWrite={canWrite}
          flash={flash}
        />
      )}
      {tab === 'modelos' && <TemplatesTab ws={ws} settings={settings} setSettings={setSettings} canWrite={canWrite} flash={flash} sample={focus ? payloadOf(focus) : null} />}

      <Toast message={toast} />
    </div>
  )
}

// =============================================================================================
// WhatsApp: status real + grupos
// =============================================================================================
function WhatsappBar(props: {
  ws: string
  canManage: boolean
  canWrite: boolean
  session: WhatsappSession | null
  setSession: React.Dispatch<React.SetStateAction<WhatsappSession | null>>
  workerOnline: boolean | null
  groups: GroupView[]
  linkedTo: (jid: string) => string[]
  groupsSyncedAt: string | null
  waiting: boolean
  onRequestGroups: () => void
  flash: (t: string) => void
}) {
  const { session, workerOnline } = props
  const st = session?.status ?? 'disconnected'
  const ready = st === 'ready'
  const linked = ready || st === 'syncing'
  const [open, setOpen] = useState(false)
  const [showGroups, setShowGroups] = useState(false)
  const [q, setQ] = useState('')
  useEffect(() => {
    if (ready) setOpen(false)
  }, [ready])

  const groupList = (
    <section className={cn(CARD, 'mb-5')}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="uc-title flex items-center gap-2 text-[16px] text-[#F7F5F1]">
          <Users size={16} className="text-[#D7141F]" /> Grupos do WhatsApp ({props.groups.length})
        </h2>
        <input className={cn(SELECT, 'w-[240px]')} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar grupo" aria-label="Buscar grupo" />
      </div>
      {props.groups.length === 0 ? (
        <p className="text-[12px] text-[#8E8A86]">
          {props.waiting ? 'O robô está lendo os grupos do número conectado…' : 'Nenhum grupo ainda. Conecte o WhatsApp (aqui ou em Disparos) com o robô ligado — os grupos aparecem sozinhos.'}
        </p>
      ) : (
        <ul className="grid max-h-[320px] gap-1 overflow-y-auto md:grid-cols-2">
          {props.groups
            .filter((g) => g.name.toLowerCase().includes(q.trim().toLowerCase()))
            .map((g) => {
              const who = props.linkedTo(g.jid)
              return (
                <li key={g.jid} className="flex items-center justify-between gap-2 rounded-[5px] border border-[#1C1C1F] bg-[#0B0B0C] px-3 py-2 text-[12px]">
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-[#ECE9E3]">{g.name || g.jid}</span>
                    <span className="font-mono text-[10px] text-[#85817C]">{g.participants} participante(s)</span>
                  </span>
                  {who.length ? <span className="truncate text-[11px] text-[#4ADE80]">→ {who.join(', ')}</span> : <span className="text-[11px] text-[#85817C]">sem cliente</span>}
                </li>
              )
            })}
        </ul>
      )}
      <p className="mt-2 text-[11px] text-[#85817C]">Para vincular, escolha o grupo na linha do cliente, no Gerador.</p>
    </section>
  )

  if (!props.canManage) {
    return (
      <>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-[6px] border border-[#2A2A2E] bg-[#111113] px-4 py-3 text-[12px] text-[#8E8A86]">
          <span>{props.groups.length} grupo(s) do WhatsApp disponíveis. Somente dono ou coordenador conectam o WhatsApp.</span>
          <button type="button" className={BTN_GHOST} onClick={() => setShowGroups((v) => !v)}>
            <Users size={13} /> {showGroups ? 'Ocultar grupos' : 'Ver grupos'}
          </button>
        </div>
        {showGroups && groupList}
      </>
    )
  }

  return (
    <>
      <section className={cn(CARD, 'mb-5 flex flex-wrap items-center justify-between gap-3 py-3 md:py-3')}>
        <div className="flex flex-wrap items-center gap-3">
          <Smartphone size={18} className="text-[#D7141F]" />
          <div>
            <p className="text-[13px] font-semibold text-[#ECE9E3]">
              {linked ? `${session?.display_name || 'WhatsApp'} · ${session?.phone ? `+${session.phone}` : ''}` : 'WhatsApp não conectado'}
            </p>
            <p className="text-[11px] text-[#8E8A86]">
              {ready
                ? props.waiting && props.groups.length === 0
                  ? 'Lendo os grupos do número…'
                  : `${props.groups.length} grupo(s) · atualizados ${props.groupsSyncedAt ? fmtDateTime(props.groupsSyncedAt) : 'ainda não'}`
                : st === 'syncing'
                  ? session?.sync_detail || 'Sincronizando conversas…'
                  : st === 'qr'
                    ? 'Aguardando a leitura do QR code'
                    : session?.last_error || 'Conecte para listar os grupos e enviar os relatórios'}
            </p>
          </div>
          {ready ? <Pill tone="green">Pronto</Pill> : linked ? <Pill tone="amber">Sincronizando</Pill> : session?.desired_state === 'connected' ? <Pill tone="amber">Conectando</Pill> : <Pill>Desconectado</Pill>}
          {workerOnline === false && <Pill tone="red">Robô desligado</Pill>}
          {workerOnline && <Pill tone="green">Robô online</Pill>}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={BTN_GHOST} onClick={() => setShowGroups((v) => !v)}>
            <Users size={13} /> {showGroups ? 'Ocultar grupos' : `Grupos (${props.groups.length})`}
          </button>
          {ready && props.canWrite && (
            <button type="button" className={BTN_GHOST} onClick={props.onRequestGroups} disabled={props.waiting || !workerOnline}>
              {props.waiting ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} {props.waiting ? 'Lendo grupos…' : 'Atualizar grupos'}
            </button>
          )}
          <button type="button" className={ready ? BTN_GHOST : cn(BTN_PRIMARY, 'bg-[#16A34A] hover:bg-[#15803D]')} onClick={() => setOpen((v) => !v)}>
            {open ? <X size={13} /> : <Smartphone size={13} />} {open ? 'Fechar' : linked ? 'Ver conexão' : 'Conectar WhatsApp'}
          </button>
        </div>
      </section>
      {open && <WhatsAppCard ws={props.ws} session={session} setSession={props.setSession} workerOnline={workerOnline} flash={props.flash} />}
      {showGroups && groupList}
    </>
  )
}

// =============================================================================================
// Gerador
// =============================================================================================
type GenProps = {
  ws: string
  data: ReportsData
  canWrite: boolean
  groups: GroupView[]
  period: PeriodKey
  setPeriod: (p: PeriodKey) => void
  compare: boolean
  setCompare: (v: boolean) => void
  previews: Map<string, PreviewState>
  reload: () => void
  reloadOne: (id: string) => void
  targetOf: (id: string) => TargetView
  saveTarget: (id: string, patch: Partial<TargetView>) => Promise<void>
  payloadOf: (id: string) => ReportPayload | null
  messageOf: (id: string, p: ReportPayload) => string
  setEdited: (id: string, text: string) => void
  resetEdited: (id: string) => void
  savedId: Map<string, string>
  setSavedId: (id: string, reportId: string) => void
  focus: string | null
  setFocus: (id: string) => void
  checked: Set<string>
  setChecked: React.Dispatch<React.SetStateAction<Set<string>>>
  settings: SettingsView
  onHistory: (row: HistoryRow) => void
  refreshHistory: () => Promise<void>
  linked: boolean
  flash: (t: string) => void
}

function Generator(g: GenProps) {
  const { data, previews } = g
  const [filter, setFilter] = useState('')
  const loading = Array.from(previews.values()).filter((p) => p.state === 'loading').length
  const shown = data.accounts.filter((a) => `${a.clientName ?? ''} ${a.name}`.toLowerCase().includes(filter.trim().toLowerCase()))
  const focusAcc = data.accounts.find((a) => a.id === g.focus) ?? null

  if (data.accounts.length === 0) {
    return (
      <section className={CARD}>
        <p className="text-[13px] text-[#8E8A86]">
          Nenhuma conta de anúncio da Meta conectada. Conecte o Facebook em <b>Configurações → Integrações</b> e sincronize as contas.
        </p>
      </section>
    )
  }

  const toggleAll = () => {
    const eligible = data.accounts.filter((a) => g.targetOf(a.id).group_jid && previews.get(a.id)?.state === 'ok').map((a) => a.id)
    g.setChecked((s) => (s.size === eligible.length ? new Set() : new Set(eligible)))
  }

  return (
    <>
      <section className={cn(CARD, 'mb-4 flex flex-wrap items-end gap-4')}>
        <label className="flex flex-col">
          <FieldLabel>Período</FieldLabel>
          <select className={SELECT} value={g.period} onChange={(e) => g.setPeriod(e.target.value as PeriodKey)}>
            {PERIOD_KEYS.map((k) => (
              <option key={k} value={k}>
                {PERIOD_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-col">
          <FieldLabel>Comparar com o período anterior</FieldLabel>
          <div className="flex h-[34px] items-center">
            <Toggle checked={g.compare} onChange={g.setCompare} label="Comparar" size="sm" />
          </div>
        </div>
        <label className="flex min-w-[200px] flex-1 flex-col">
          <FieldLabel>Buscar cliente</FieldLabel>
          <input className={SELECT} value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Nome do cliente ou conta" />
        </label>
        <button type="button" className={BTN_GHOST} onClick={g.reload} disabled={loading > 0}>
          {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} {loading ? `Consultando a Meta (${loading})…` : 'Gerar prévias de novo'}
        </button>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_480px]">
        <section className={cn(CARD, 'p-0 md:p-0')}>
          <div className="flex items-center justify-between border-b border-[#222225] px-4 py-3">
            <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-[#8E8A86]">{data.accounts.length} conta(s) conectada(s)</p>
            {g.canWrite && (
              <button type="button" className="text-[12px] font-semibold text-[#CFCBC4] hover:text-white" onClick={toggleAll}>
                Selecionar todos com grupo
              </button>
            )}
          </div>
          <ul className="divide-y divide-[#1C1C1F]">
            {shown.map((a) => (
              <AccountRow key={a.id} g={g} accountId={a.id} title={a.clientName ?? a.name} subtitle={a.clientName ? a.name : a.externalId} watched={a.watched} />
            ))}
          </ul>
        </section>

        <div className="xl:sticky xl:top-4 xl:max-h-[calc(100vh-110px)] xl:self-start xl:overflow-y-auto">{focusAcc ? <Detail g={g} accountId={focusAcc.id} /> : null}</div>
      </div>

      {g.canWrite && <DispatchBar g={g} />}
    </>
  )
}

function AccountRow({ g, accountId, title, subtitle, watched }: { g: GenProps; accountId: string; title: string; subtitle: string; watched: boolean }) {
  const p = g.previews.get(accountId)
  const t = g.targetOf(accountId)
  const payload = g.payloadOf(accountId)
  const withSpend = p?.source?.campaigns.filter((c) => c.spend > 0 || c.status === 'ACTIVE') ?? []
  const [showCampaigns, setShowCampaigns] = useState(false)
  const selectable = Boolean(t.group_jid && p?.state === 'ok')

  return (
    <li className={cn('px-4 py-3 transition-colors', g.focus === accountId ? 'bg-[#16161A]' : 'hover:bg-[#141416]')}>
      <div className="flex flex-wrap items-start gap-3">
        {g.canWrite && (
          <input
            type="checkbox"
            aria-label={`Selecionar ${title}`}
            className="mt-1 h-4 w-4 accent-[#D7141F]"
            disabled={!selectable}
            title={selectable ? 'Incluir no disparo' : 'Vincule um grupo e aguarde a prévia'}
            checked={g.checked.has(accountId)}
            onChange={(e) =>
              g.setChecked((s) => {
                const n = new Set(s)
                if (e.target.checked) n.add(accountId)
                else n.delete(accountId)
                return n
              })
            }
          />
        )}
        <button type="button" onClick={() => g.setFocus(accountId)} className="min-w-[180px] flex-1 text-left">
          <p className="flex items-center gap-2 text-[14px] font-semibold text-[#ECE9E3]">
            {title} {watched && <span className="rounded bg-[#D7141F]/15 px-1.5 font-mono text-[9px] uppercase text-[#F0333D]">acompanhada</span>}
          </p>
          <p className="font-mono text-[11px] text-[#85817C]">{subtitle}</p>
          <p className="mt-1 text-[12px]">
            {!p || p.state === 'loading' ? (
              <span className="inline-flex items-center gap-1.5 text-[#8E8A86]">
                <Loader2 size={12} className="animate-spin" /> consultando a Meta…
              </span>
            ) : p.state === 'error' ? (
              <span className="text-[#F0333D]">{p.error}</span>
            ) : payload ? (
              <span className="text-[#CFCBC4]">
                <b className="text-[#F7F5F1]">{money(payload.totals.spend)}</b> · {headline(payload)}
                {payload.blocks.length > 1 && <span className="text-[#85817C]"> · +{payload.blocks.length - 1} bloco(s)</span>}
              </span>
            ) : null}
          </p>
        </button>

        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Grupo do WhatsApp"
            className={cn(SELECT, 'max-w-[220px]', !t.group_jid && 'text-[#85817C]')}
            value={t.group_jid ?? ''}
            disabled={!g.canWrite}
            onChange={(e) => {
              const grp = g.groups.find((x) => x.jid === e.target.value)
              if (!e.target.value) g.setChecked((s) => { const n = new Set(s); n.delete(accountId); return n })
              g.saveTarget(accountId, { group_jid: grp?.jid ?? null, group_name: grp?.name ?? null })
            }}
          >
            <option value="">{g.groups.length ? 'Escolher grupo…' : 'Sem grupos (conecte o WhatsApp)'}</option>
            {t.group_jid && !g.groups.some((x) => x.jid === t.group_jid) && <option value={t.group_jid}>{t.group_name ?? 'Grupo salvo'}</option>}
            {g.groups.map((x) => (
              <option key={x.jid} value={x.jid}>
                {x.name || x.jid} · {x.participants}
              </option>
            ))}
          </select>
          {withSpend.length > 1 && (
            <>
              <Segmented<'merged' | 'separate'>
                ariaLabel="Campanhas"
                value={t.campaign_mode}
                onChange={(v) => g.canWrite && g.saveTarget(accountId, { campaign_mode: v })}
                options={[
                  { value: 'merged', label: 'Juntar' },
                  { value: 'separate', label: 'Separar' },
                ]}
              />
              <button type="button" className={BTN_GHOST} onClick={() => setShowCampaigns((v) => !v)}>
                <Layers size={13} /> {t.campaign_ids.length ? `${t.campaign_ids.length} de ${withSpend.length}` : `Todas (${withSpend.length})`}
              </button>
            </>
          )}
        </div>
      </div>

      {showCampaigns && p?.source && (
        <div className="mt-3 space-y-1.5 rounded-[5px] border border-[#222225] bg-[#0B0B0C] p-3">
          <p className="text-[11px] text-[#8E8A86]">Marque as campanhas do relatório (nenhuma marcada = todas com investimento).</p>
          {withSpend.map((c) => (
            <label key={c.id} className="flex cursor-pointer items-center gap-2 text-[12px] text-[#CFCBC4]">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-[#D7141F]"
                disabled={!g.canWrite}
                checked={t.campaign_ids.includes(c.id)}
                onChange={(e) => g.saveTarget(accountId, { campaign_ids: e.target.checked ? [...t.campaign_ids, c.id] : t.campaign_ids.filter((x) => x !== c.id) })}
              />
              <span className="h-2 w-2 rounded-full" style={{ background: KIND_COLOR[c.kind] }} />
              <span className="flex-1 truncate">{c.name}</span>
              <span className="font-mono text-[11px] text-[#85817C]">
                {KIND_LABEL[c.kind].title} · {money(c.spend)} · {int(c.result)}
              </span>
              {c.status === 'ACTIVE' && <Pill tone="green">ativa</Pill>}
            </label>
          ))}
        </div>
      )}
    </li>
  )
}

function Detail({ g, accountId }: { g: GenProps; accountId: string }) {
  const p = g.previews.get(accountId)
  const payload = g.payloadOf(accountId)
  const t = g.targetOf(accountId)
  const [busy, start] = useTransition()
  const [downloading, setDownloading] = useState(false)
  if (!payload) {
    return (
      <section className={CARD}>
        <p className="text-[13px] text-[#8E8A86]">
          {p?.state === 'error' ? p.error : (
            <span className="inline-flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" /> Consultando a Meta…
            </span>
          )}
        </p>
        {p?.state === 'error' && (
          <button type="button" className={cn(BTN_GHOST, 'mt-3')} onClick={() => g.reloadOne(accountId)}>
            <RefreshCw size={13} /> Tentar de novo
          </button>
        )}
      </section>
    )
  }
  const message = g.messageOf(accountId, payload)
  const saved = g.savedId.get(accountId)

  const download = async () => {
    setDownloading(true)
    try {
      const res = await fetch('/api/reports/card', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? 'Falha ao gerar a imagem.')
      const url = URL.createObjectURL(await res.blob())
      const a = document.createElement('a')
      a.href = url
      a.download = `relatorio-${slug(payload.title)}-${payload.period.since}.png`
      a.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 5000)
    } catch (e) {
      g.flash(e instanceof Error ? e.message : 'Falha ao gerar a imagem.')
    } finally {
      setDownloading(false)
    }
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message)
      g.flash('Mensagem copiada.')
    } catch {
      g.flash('O navegador bloqueou a cópia — selecione o texto e copie.')
    }
  }
  const save = (sent: boolean) =>
    start(async () => {
      if (sent && saved) {
        const r = await markSentAction(g.ws, saved)
        if (!r.ok) return g.flash(r.error)
        await g.refreshHistory()
        return g.flash('Marcado como enviado.')
      }
      const r = await saveReportAction(g.ws, { payload, message, sent })
      if (!r.ok) return g.flash(r.error)
      g.setSavedId(accountId, r.report.id)
      g.onHistory(r.report)
      g.flash(sent ? 'Relatório salvo como enviado no histórico.' : 'Relatório salvo no histórico.')
    })
  const sendNow = () =>
    start(async () => {
      const r = await queueSendAction(g.ws, { items: [{ payload, message }], intervalMin: 20, intervalMax: 20 })
      if (!r.ok) return g.flash(r.error)
      await g.refreshHistory()
      g.flash(`Na fila do robô — sai em instantes no grupo ${t.group_name ?? ''}.`)
    })

  return (
    <section className={cn(CARD, 'space-y-4')}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="uc-title text-[18px] text-[#F7F5F1]">Prévia</h2>
        <span className="font-mono text-[11px] text-[#85817C]">{t.group_name ? `→ ${t.group_name}` : 'sem grupo vinculado'}</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className={BTN_GHOST} onClick={download} disabled={downloading}>
          {downloading ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} Baixar imagem
        </button>
        <button type="button" className={BTN_GHOST} onClick={copy}>
          <Copy size={13} /> Copiar mensagem
        </button>
        <a className={BTN_GHOST} href={`https://api.whatsapp.com/send?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer noopener">
          <ExternalLink size={13} /> Abrir no WhatsApp
        </a>
        {g.canWrite && (
          <button type="button" className={BTN_GHOST} onClick={() => save(false)} disabled={busy || Boolean(saved)}>
            <Save size={13} /> {saved ? 'Salvo' : 'Salvar relatório'}
          </button>
        )}
        {g.canWrite && (
          <button type="button" className={BTN_GHOST} onClick={() => save(true)} disabled={busy}>
            <CheckCheck size={13} /> Marcar como enviado
          </button>
        )}
        {g.canWrite && (
          <button
            type="button"
            className={cn(BTN_PRIMARY, 'px-3 py-1.5 text-[12px]')}
            onClick={sendNow}
            disabled={busy || !t.group_jid || !g.linked}
            title={!t.group_jid ? 'Escolha o grupo do cliente na lista' : !g.linked ? 'Conecte o WhatsApp' : undefined}
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Enviar no grupo
          </button>
        )}
      </div>

      <ReportCardPreview p={payload} />


      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <FieldLabel>Mensagem do WhatsApp</FieldLabel>
          {g.canWrite && (
            <button type="button" className="text-[11px] text-[#8E8A86] hover:text-white" onClick={() => g.resetEdited(accountId)}>
              Restaurar texto
            </button>
          )}
        </div>
        <textarea
          value={message}
          readOnly={!g.canWrite}
          onChange={(e) => g.setEdited(accountId, e.target.value.slice(0, 4000))}
          rows={10}
          className="w-full resize-y rounded-[5px] border border-[#2A2A2E] bg-[#0B0B0C] p-3 font-mono text-[12px] leading-relaxed text-[#ECE9E3] outline-none focus:border-[#D7141F]"
        />
      </div>
    </section>
  )
}

/** Mesmo desenho do PNG (lib/reports/card.tsx), em HTML. */
function ReportCardPreview({ p }: { p: ReportPayload }) {
  const blocks = p.show.byObjective ? p.blocks.slice(0, 4) : []
  const ads = p.show.topCreatives ? p.topAds.slice(0, 3) : []
  const Delta = ({ v, invert = false }: { v: number | null; invert?: boolean }) =>
    v == null ? null : (
      <span className={cn('ml-1.5 font-mono text-[10px]', v === 0 ? 'text-[#8E8A86]' : (invert ? v < 0 : v > 0) ? 'text-[#4ADE80]' : 'text-[#F87171]')}>
        {v > 0 ? '▲' : v < 0 ? '▼' : '='} {Math.abs(v)}%
      </span>
    )
  return (
    <div className="flex aspect-[4/5] flex-col overflow-hidden rounded-[8px] border border-[#2A2A2E] bg-[#0B0B0C] p-5">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 font-mono text-[9px] tracking-[0.2em] text-[#8E8A86]">
          <span className="h-4 w-1.5 bg-[#D7141F]" /> RELATÓRIO DE TRÁFEGO
        </span>
        <span className="truncate pl-2 text-[9px] text-[#8E8A86]">{p.workspaceName}</span>
      </div>
      <p className="mt-3 truncate text-[24px] font-extrabold leading-tight text-[#F7F5F1]">{p.title}</p>
      <p className="text-[11px] text-[#CFCBC4]">
        {p.periodLabel}
        {p.previousLabel ? ` · comparado a ${p.previousLabel}` : ''}
      </p>
      {p.show.general && (
        <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
          <div className="rounded-[6px] border border-[#2A2A2E] bg-[#151517] px-3 py-2">
            <p className="text-[10px] text-[#8E8A86]">Investimento</p>
            <p className="text-[19px] font-extrabold text-[#F7F5F1]">
              {money(p.totals.spend)}
              <Delta v={p.totals.spendDelta} />
            </p>
          </div>
          <div className="rounded-[6px] border border-[#2A2A2E] bg-[#151517] px-3 py-2">
            <p className="text-[10px] text-[#8E8A86]">Alcance</p>
            <p className="text-[19px] font-extrabold text-[#F7F5F1]">{int(p.totals.reach)}</p>
          </div>
        </div>
      )}
      {blocks.length > 0 && (
        <div className={cn('mt-2 grid gap-2', blocks.length > 1 && 'grid-cols-2')}>
          {blocks.map((b) => (
            <div key={b.key} className="rounded-[6px] border border-[#2A2A2E] bg-[#151517] px-3 py-2" style={{ borderTop: `3px solid ${KIND_COLOR[b.kind]}` }}>
              <div className="flex justify-between gap-2 text-[10px] text-[#CFCBC4]">
                <span className="truncate">{b.title}</span>
                <span className="text-[#8E8A86]">{money(b.spend)}</span>
              </div>
              <p className="text-[20px] font-extrabold text-[#F7F5F1]">
                {int(b.result)}
                <Delta v={b.deltaResult} />
              </p>
              <p className="text-[10px]" style={{ color: KIND_COLOR[b.kind] }}>
                {b.resultLabel}
              </p>
              {b.costPerResult != null && (
                <p className="text-[10px] text-[#CFCBC4]">
                  {b.costLabel}: {money(b.costPerResult)}
                  <Delta v={b.deltaCost} invert />
                </p>
              )}
              {b.kind === 'sales' && b.revenue > 0 && (
                <p className="text-[10px] text-[#4ADE80]">
                  Faturamento {money(b.revenue)} · ROAS {(b.roas ?? 0).toFixed(2).replace('.', ',')}x
                </p>
              )}
            </div>
          ))}
        </div>
      )}
      {p.show.byObjective && blocks.length === 0 && <p className="mt-3 text-[12px] text-[#8E8A86]">Sem campanhas com investimento no período.</p>}
      {ads.length > 0 && (
        <div className="mt-2">
          <p className="mb-1 text-[10px] text-[#8E8A86]">Melhores anúncios</p>
          <div className="grid grid-cols-3 gap-2">
            {ads.map((a, i) => (
              <div key={a.id} className="flex items-center gap-1.5 rounded-[5px] border border-[#2A2A2E] bg-[#151517] p-1.5">
                {a.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.thumbnail} alt="" className="h-8 w-8 rounded object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <span className="flex h-8 w-8 items-center justify-center rounded bg-[#2A2A2E] text-[10px] text-[#8E8A86]">{i + 1}º</span>
                )}
                <div className="min-w-0">
                  <p className="text-[12px] font-bold text-[#F7F5F1]">{int(a.result)}</p>
                  <p className="truncate text-[9px] text-[#8E8A86]">{a.name}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="flex-1" />
      <div className="mt-2 flex items-center justify-between border-t border-[#2A2A2E] pt-2 text-[10px] text-[#8E8A86]">
        <span>
          {p.show.balance
            ? p.balance.debt > 0
              ? `Pagamento pendente: ${money(p.balance.debt)}`
              : p.balance.kind === 'pix'
                ? `Saldo Pix: ${money(p.balance.available)}${p.balance.daysLeft != null ? ` · ~${p.balance.daysLeft} dias` : ''}`
                : p.balance.kind === 'card'
                  ? 'Pagamento no cartão'
                  : ''
            : ''}
        </span>
        <span className="font-mono tracking-[0.2em] text-[#D7141F]">UNDERCUT</span>
      </div>
    </div>
  )
}

function DispatchBar({ g }: { g: GenProps }) {
  const [preset, setPreset] = useState<string>(() => PRESETS.find((p) => p.min === g.settings.intervalMin && p.max === g.settings.intervalMax)?.key ?? 'custom')
  const [min, setMin] = useState(g.settings.intervalMin)
  const [max, setMax] = useState(g.settings.intervalMax)
  const [busy, start] = useTransition()
  const n = g.checked.size
  const avg = (min + max) / 2
  const minutes = Math.ceil(((n - 1) * avg) / 60)

  const fire = () =>
    start(async () => {
      const items = Array.from(g.checked)
        .map((id) => {
          const payload = g.payloadOf(id)
          return payload ? { payload, message: g.messageOf(id, payload) } : null
        })
        .filter((x): x is { payload: ReportPayload; message: string } => x !== null)
      if (!items.length) return g.flash('Selecione relatórios com prévia pronta.')
      const r = await queueSendAction(g.ws, { items, intervalMin: min, intervalMax: max })
      if (!r.ok) return g.flash(r.error)
      g.setChecked(new Set())
      await g.refreshHistory()
      g.flash(
        `${r.queued} relatório(s) na fila: de ${fmtTime(r.firstAt)} até ~${fmtTime(r.lastAt)}.${r.skipped.length ? ` Sem grupo: ${r.skipped.join(', ')}.` : ''}${g.linked ? '' : ' Conecte o WhatsApp para o robô enviar.'}`,
      )
    })

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[#2A2A2E] bg-[#0B0B0C]/95 px-4 py-3 backdrop-blur md:left-[var(--sidebar-w,0px)]">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-3">
        <p className="text-[13px] text-[#ECE9E3]">
          <b>{n}</b> selecionado(s)
          {n > 1 && <span className="text-[#8E8A86]"> · leva ~{minutes} min</span>}
        </p>
        <select
          aria-label="Intervalo entre envios"
          className={SELECT}
          value={preset}
          onChange={(e) => {
            setPreset(e.target.value)
            const p = PRESETS.find((x) => x.key === e.target.value)
            if (p) {
              setMin(p.min)
              setMax(p.max)
            }
          }}
        >
          {PRESETS.map((p) => (
            <option key={p.key} value={p.key}>
              Intervalo: {p.label}
            </option>
          ))}
          <option value="custom">Intervalo personalizado</option>
        </select>
        {preset === 'custom' && (
          <span className="flex items-center gap-1 text-[12px] text-[#8E8A86]">
            <input type="number" min={20} max={3600} value={min} onChange={(e) => setMin(Math.max(20, Number(e.target.value) || 20))} className={cn(SELECT, 'w-[72px]')} aria-label="Mínimo em segundos" />
            a
            <input type="number" min={20} max={3600} value={max} onChange={(e) => setMax(Math.max(20, Number(e.target.value) || 20))} className={cn(SELECT, 'w-[72px]')} aria-label="Máximo em segundos" />s
          </span>
        )}
        {preset === 'fast' && <span className="text-[11px] text-[#FBBF24]">Mais risco para o número.</span>}
        <div className="flex-1" />
        <button type="button" className={BTN_PRIMARY} onClick={fire} disabled={busy || n === 0 || max < min}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Disparar nos grupos
        </button>
      </div>
    </div>
  )
}

// =============================================================================================
// Histórico
// =============================================================================================
function HistoryTab({ ws, rows, canWrite, refresh, flash }: { ws: string; rows: HistoryRow[]; canWrite: boolean; refresh: () => Promise<void>; flash: (t: string) => void }) {
  const [busy, start] = useTransition()
  const act = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, done: string) =>
    start(async () => {
      const r = await fn()
      if (!r.ok) return flash(r.error)
      await refresh()
      flash(done)
    })
  if (!rows.length) {
    return (
      <section className={CARD}>
        <p className="flex items-center gap-2 text-[13px] text-[#8E8A86]">
          <History size={15} /> Nenhum relatório ainda. Gere no Gerador e salve ou dispare nos grupos.
        </p>
      </section>
    )
  }
  return (
    <section className={cn(CARD, 'overflow-x-auto p-0 md:p-0')}>
      <table className="w-full min-w-[820px] text-left text-[12px]">
        <thead className="border-b border-[#222225] font-mono text-[10px] uppercase tracking-[0.1em] text-[#8E8A86]">
          <tr>
            <th className="px-4 py-2.5">Criado</th>
            <th className="px-2 py-2.5">Cliente</th>
            <th className="px-2 py-2.5">Período</th>
            <th className="px-2 py-2.5">Grupo</th>
            <th className="px-2 py-2.5">Status</th>
            <th className="px-4 py-2.5 text-right">Ações</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#1C1C1F]">
          {rows.map((r) => (
            <tr key={r.id} className="text-[#CFCBC4]">
              <td className="px-4 py-2.5 font-mono text-[11px]">{fmtDateTime(r.created_at)}</td>
              <td className="px-2 py-2.5 font-semibold text-[#ECE9E3]">
                {r.title}
                {r.schedule_id && <CalendarClock size={12} className="ml-1 inline text-[#8E8A86]" aria-label="Agendado" />}
              </td>
              <td className="px-2 py-2.5 font-mono text-[11px]">
                {br(r.period_since)} a {br(r.period_until)}
              </td>
              <td className="px-2 py-2.5">{r.group_name ?? '—'}</td>
              <td className="px-2 py-2.5">
                <Pill tone={STATUS_TONE[r.status]}>{r.status}</Pill>
                <p className="mt-0.5 font-mono text-[10px] text-[#85817C]">
                  {r.status === 'enviado' ? fmtDateTime(r.sent_at) : r.status === 'agendado' ? `sai ${fmtDateTime(r.scheduled_at)}` : ''}
                </p>
                {r.error && <p className="mt-0.5 max-w-[240px] text-[10px] text-[#F0333D]">{r.error}</p>}
              </td>
              <td className="px-4 py-2.5">
                <div className="flex flex-wrap justify-end gap-1.5">
                  <a className={BTN_GHOST} href={`/api/reports/${r.id}/card`} target="_blank" rel="noreferrer" title="Ver imagem">
                    <Download size={12} /> PNG
                  </a>
                  <button
                    type="button"
                    className={BTN_GHOST}
                    onClick={() => navigator.clipboard.writeText(r.message).then(() => flash('Mensagem copiada.'), () => flash('Não consegui copiar.'))}
                  >
                    <Copy size={12} />
                  </button>
                  <a className={BTN_GHOST} href={`https://api.whatsapp.com/send?text=${encodeURIComponent(r.message)}`} target="_blank" rel="noreferrer noopener" title="Abrir no WhatsApp">
                    <MessageCircle size={12} />
                  </a>
                  {canWrite && r.status === 'agendado' && (
                    <button type="button" className={BTN_GHOST} disabled={busy} onClick={() => act(() => setReportStatusAction(ws, r.id, 'cancel'), 'Envio cancelado.')}>
                      <X size={12} /> Cancelar
                    </button>
                  )}
                  {canWrite && ['falhou', 'cancelado', 'rascunho'].includes(r.status) && r.group_name && (
                    <button type="button" className={BTN_GHOST} disabled={busy} onClick={() => act(() => setReportStatusAction(ws, r.id, 'retry'), 'Na fila do robô.')}>
                      <RotateCcw size={12} /> {r.status === 'rascunho' ? 'Enviar' : 'Reenviar'}
                    </button>
                  )}
                  {canWrite && ['rascunho', 'falhou', 'cancelado'].includes(r.status) && (
                    <button type="button" className={BTN_GHOST} disabled={busy} onClick={() => act(() => markSentAction(ws, r.id), 'Marcado como enviado.')}>
                      <Check size={12} /> Enviado
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

// =============================================================================================
// Agendamentos
// =============================================================================================
type Draft = { id?: string; name: string; active: boolean; days: number[]; time: string; period: PeriodKey; compare: boolean; accountIds: string[]; intervalMin: number; intervalMax: number }

function SchedulesTab({
  ws,
  accounts,
  targets,
  setTargets,
  schedules,
  setSchedules,
  settings,
  whatsapp,
  canWrite,
  flash,
}: {
  ws: string
  accounts: ReportsData['accounts']
  targets: Map<string, TargetView>
  setTargets: React.Dispatch<React.SetStateAction<Map<string, TargetView>>>
  schedules: ScheduleView[]
  setSchedules: React.Dispatch<React.SetStateAction<ScheduleView[]>>
  settings: SettingsView
  whatsapp: ReportsData['whatsapp']
  canWrite: boolean
  flash: (t: string) => void
}) {
  const blank: Draft = { name: 'Relatório semanal', active: true, days: [1], time: '09:00', period: '7d', compare: false, accountIds: [], intervalMin: settings.intervalMin, intervalMax: settings.intervalMax }
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, start] = useTransition()
  const byTargetId = useMemo(() => new Map(Array.from(targets.values()).map((t) => [t.id, t])), [targets])
  const accName = (id: string) => {
    const a = accounts.find((x) => x.id === id)
    return a ? a.clientName ?? a.name : 'Conta removida'
  }

  const edit = (s: ScheduleView) =>
    setDraft({
      id: s.id,
      name: s.name,
      active: s.active,
      days: s.days_of_week,
      time: s.send_time.slice(0, 5),
      period: s.period_key,
      compare: s.compare,
      accountIds: s.target_ids.map((id) => byTargetId.get(id)?.ad_account_id).filter((x): x is string => Boolean(x)),
      intervalMin: s.interval_min_seconds,
      intervalMax: s.interval_max_seconds,
    })
  const save = () =>
    start(async () => {
      if (!draft) return
      const r = await saveScheduleAction(ws, draft)
      if (!r.ok) return flash(r.error)
      setTargets((m) => {
        const n = new Map(m)
        for (const t of r.targets) n.set(t.ad_account_id, t)
        return n
      })
      setSchedules((list) => (draft.id ? list.map((x) => (x.id === r.schedule.id ? r.schedule : x)) : [...list, r.schedule]))
      setDraft(null)
      flash(r.schedule.next_run_at ? `Agendado — próximo envio ${fmtDateTime(r.schedule.next_run_at)}.` : 'Agendamento salvo (pausado).')
    })

  return (
    <div className="space-y-4">
      <section className={CARD}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="uc-title flex items-center gap-2 text-[18px] text-[#F7F5F1]">
            <CalendarClock size={18} className="text-[#D7141F]" /> Disparo automático
          </h2>
          {canWrite && !draft && (
            <button type="button" className={BTN_PRIMARY} onClick={() => setDraft(blank)}>
              Novo agendamento
            </button>
          )}
        </div>
        <p className="text-[12px] text-[#8E8A86]">
          No dia e hora marcados o robô pede ao Undercut os números da Meta (por padrão, os <b className="text-[#CFCBC4]">últimos 7 dias</b>), gera o relatório
          de cada cliente e envia no <b className="text-[#CFCBC4]">grupo de WhatsApp</b> vinculado a ele, um por vez, com o intervalo escolhido.
        </p>
        <div
          className={cn(
            'mt-3 flex flex-wrap items-center justify-between gap-2 rounded-[5px] border px-3 py-2 text-[12px]',
            whatsapp.workerOnline && (whatsapp.status === 'ready' || whatsapp.status === 'syncing')
              ? 'border-[#16A34A]/40 bg-[#0F291E]/60 text-[#86EFAC]'
              : 'border-[#D7141F]/40 bg-[#1F0D0F]/60 text-[#FFB199]',
          )}
        >
          <span>
            {!whatsapp.workerOnline
              ? 'Robô desligado — os relatórios agendados NÃO serão enviados até o robô ligar.'
              : whatsapp.status === 'ready' || whatsapp.status === 'syncing'
                ? `WhatsApp conectado${whatsapp.phone ? ` (${whatsapp.phone})` : ''} — os envios agendados sairão de verdade.`
                : 'Robô ligado, mas o WhatsApp não está conectado — conecte pelo QR code.'}
          </span>
          <a href={`/a/${ws}/disparos`} className="font-semibold underline underline-offset-2 hover:text-white">
            Conectar / ver status
          </a>
        </div>
      </section>

      {draft && (
        <section className={cn(CARD, 'space-y-4')}>
          <div className="grid gap-4 md:grid-cols-[1fr_auto_auto]">
            <label className="flex flex-col">
              <FieldLabel>Nome</FieldLabel>
              <input className={SELECT} value={draft.name} maxLength={120} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </label>
            <label className="flex flex-col">
              <FieldLabel>Horário</FieldLabel>
              <input type="time" className={SELECT} value={draft.time} onChange={(e) => setDraft({ ...draft, time: e.target.value })} />
            </label>
            <label className="flex flex-col">
              <FieldLabel>Período do relatório</FieldLabel>
              <select className={SELECT} value={draft.period} onChange={(e) => setDraft({ ...draft, period: e.target.value as PeriodKey })}>
                {PERIOD_KEYS.map((k) => (
                  <option key={k} value={k}>
                    {PERIOD_LABEL[k]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div>
            <FieldLabel>Dias</FieldLabel>
            <div className="flex flex-wrap gap-1.5">
              {DAYS.map((d, i) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDraft({ ...draft, days: draft.days.includes(i) ? draft.days.filter((x) => x !== i) : [...draft.days, i] })}
                  className={cn('rounded-[5px] border px-3 py-1.5 text-[12px] font-semibold', draft.days.includes(i) ? 'border-[#D7141F] bg-[#D7141F] text-white' : 'border-[#2A2A2E] text-[#8E8A86]')}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-5">
            <span className="flex items-center gap-2 text-[12px] text-[#CFCBC4]">
              <Toggle size="sm" checked={draft.compare} onChange={(v) => setDraft({ ...draft, compare: v })} label="Comparar" /> Comparar com o período anterior
            </span>
            <label className="flex items-center gap-2 text-[12px] text-[#CFCBC4]">
              Intervalo
              <select
                className={SELECT}
                value={PRESETS.find((p) => p.min === draft.intervalMin && p.max === draft.intervalMax)?.key ?? 'safe'}
                onChange={(e) => {
                  const p = PRESETS.find((x) => x.key === e.target.value)!
                  setDraft({ ...draft, intervalMin: p.min, intervalMax: p.max })
                }}
              >
                {PRESETS.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <FieldLabel>Clientes ({draft.accountIds.length})</FieldLabel>
              <button
                type="button"
                className="text-[11px] text-[#8E8A86] hover:text-white"
                onClick={() => setDraft({ ...draft, accountIds: accounts.filter((a) => targets.get(a.id)?.group_jid).map((a) => a.id) })}
              >
                Todos com grupo
              </button>
            </div>
            <div className="grid max-h-[280px] gap-1 overflow-y-auto rounded-[5px] border border-[#222225] bg-[#0B0B0C] p-2 md:grid-cols-2">
              {accounts.map((a) => {
                const t = targets.get(a.id)
                return (
                  <label key={a.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[12px] text-[#CFCBC4] hover:bg-[#141416]">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 accent-[#D7141F]"
                      checked={draft.accountIds.includes(a.id)}
                      onChange={(e) => setDraft({ ...draft, accountIds: e.target.checked ? [...draft.accountIds, a.id] : draft.accountIds.filter((x) => x !== a.id) })}
                    />
                    <span className="flex-1 truncate">{a.clientName ?? a.name}</span>
                    {t?.group_jid ? (
                      <span className="truncate font-mono text-[10px] text-[#4ADE80]">{t.group_name}</span>
                    ) : (
                      <span className="flex items-center gap-1 font-mono text-[10px] text-[#FBBF24]">
                        <AlertTriangle size={10} /> sem grupo
                      </span>
                    )}
                  </label>
                )
              })}
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" className={BTN_PRIMARY} onClick={save} disabled={busy || !draft.days.length || !draft.accountIds.length || !draft.name.trim()}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Salvar agendamento
            </button>
            <button type="button" className={BTN_GHOST} onClick={() => setDraft(null)}>
              Cancelar
            </button>
          </div>
        </section>
      )}

      {schedules.map((s) => (
        <section key={s.id} className={cn(CARD, 'flex flex-wrap items-start justify-between gap-3')}>
          <div className="min-w-[220px] flex-1">
            <p className="flex items-center gap-2 text-[14px] font-semibold text-[#ECE9E3]">
              {s.name} {s.active ? <Pill tone="green">ativo</Pill> : <Pill>pausado</Pill>}
            </p>
            <p className="mt-1 text-[12px] text-[#CFCBC4]">
              {s.days_of_week.map((d) => DAYS[d]).join(', ')} às {s.send_time.slice(0, 5)} · {PERIOD_LABEL[s.period_key]} · intervalo {Math.round(s.interval_min_seconds / 60 * 10) / 10}–
              {Math.round(s.interval_max_seconds / 60 * 10) / 10} min
            </p>
            <p className="mt-1 flex items-center gap-1 text-[12px] text-[#8E8A86]">
              <Users size={12} /> {s.target_ids.map((id) => accName(byTargetId.get(id)?.ad_account_id ?? '')).join(', ')}
            </p>
            <p className="mt-1 font-mono text-[11px] text-[#85817C]">
              Próximo: {fmtDateTime(s.next_run_at)} · último: {fmtDateTime(s.last_run_at)}
            </p>
            {s.last_error && <p className="mt-1 text-[11px] text-[#FBBF24]">{s.last_error}</p>}
          </div>
          {canWrite && (
            <div className="flex gap-1.5">
              <button
                type="button"
                className={BTN_GHOST}
                disabled={busy}
                onClick={() =>
                  start(async () => {
                    const r = await toggleScheduleAction(ws, s.id, !s.active)
                    if (!r.ok) return flash(r.error)
                    setSchedules((l) => l.map((x) => (x.id === s.id ? r.schedule : x)))
                  })
                }
              >
                {s.active ? <Pause size={12} /> : <Play size={12} />} {s.active ? 'Pausar' : 'Ativar'}
              </button>
              <button type="button" className={BTN_GHOST} onClick={() => edit(s)}>
                <Settings2 size={12} /> Editar
              </button>
              <button
                type="button"
                className={BTN_GHOST}
                disabled={busy}
                onClick={() =>
                  window.confirm(`Apagar o agendamento "${s.name}"?`) &&
                  start(async () => {
                    const r = await deleteScheduleAction(ws, s.id)
                    if (!r.ok) return flash(r.error)
                    setSchedules((l) => l.filter((x) => x.id !== s.id))
                  })
                }
              >
                <Trash2 size={12} />
              </button>
            </div>
          )}
        </section>
      ))}
    </div>
  )
}

// =============================================================================================
// Modelos
// =============================================================================================
function TemplatesTab({
  ws,
  settings,
  setSettings,
  canWrite,
  flash,
  sample,
}: {
  ws: string
  settings: SettingsView
  setSettings: (s: SettingsView) => void
  canWrite: boolean
  flash: (t: string) => void
  sample: ReportPayload | null
}) {
  const [draft, setDraft] = useState<SettingsView>(settings)
  const [busy, start] = useTransition()
  const BLOCKS: { key: keyof Show; label: string; hint: string }[] = [
    { key: 'general', label: 'Visão geral', hint: 'Investimento e alcance, com variação' },
    { key: 'byObjective', label: 'Resultados por objetivo', hint: 'Vendas (compras/ROAS), mensagens (conversas), perfil (visitas)…' },
    { key: 'topCreatives', label: 'Melhores anúncios', hint: 'Top 3 por resultado, com miniatura' },
    { key: 'balance', label: 'Saldo da conta', hint: 'Pix (saldo e dias) ou cartão; pendência' },
  ]
  const preview = sample ? composeReport(sample, { mode: sample.mode, selected: sample.selected, show: draft.show }) : null

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_480px]">
      <section className={cn(CARD, 'space-y-5')}>
        <h2 className="uc-title text-[18px] text-[#F7F5F1]">Modelo do relatório</h2>
        <div className="space-y-2">
          {BLOCKS.map((b) => (
            <div key={b.key} className="flex items-center justify-between gap-3 rounded-[5px] border border-[#222225] bg-[#0B0B0C] px-3 py-2.5">
              <div>
                <p className="text-[13px] font-semibold text-[#ECE9E3]">{b.label}</p>
                <p className="text-[11px] text-[#8E8A86]">{b.hint}</p>
              </div>
              <Toggle checked={draft.show[b.key]} disabled={!canWrite} onChange={(v) => setDraft({ ...draft, show: { ...draft.show, [b.key]: v } })} label={b.label} />
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-4">
          <label className="flex flex-col">
            <FieldLabel>Período padrão</FieldLabel>
            <select className={SELECT} value={draft.period} disabled={!canWrite} onChange={(e) => setDraft({ ...draft, period: e.target.value as PeriodKey })}>
              {PERIOD_KEYS.map((k) => (
                <option key={k} value={k}>
                  {PERIOD_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col">
            <FieldLabel>Intervalo padrão entre envios</FieldLabel>
            <select
              className={SELECT}
              disabled={!canWrite}
              value={PRESETS.find((p) => p.min === draft.intervalMin && p.max === draft.intervalMax)?.key ?? 'safe'}
              onChange={(e) => {
                const p = PRESETS.find((x) => x.key === e.target.value)!
                setDraft({ ...draft, intervalMin: p.min, intervalMax: p.max })
              }}
            >
              {PRESETS.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-col">
            <FieldLabel>Comparar</FieldLabel>
            <div className="flex h-[34px] items-center">
              <Toggle size="sm" checked={draft.compare} disabled={!canWrite} onChange={(v) => setDraft({ ...draft, compare: v })} label="Comparar" />
            </div>
          </div>
        </div>
        {canWrite && (
          <button
            type="button"
            className={BTN_PRIMARY}
            disabled={busy}
            onClick={() =>
              start(async () => {
                const r = await saveSettingsAction(ws, draft)
                if (!r.ok) return flash(r.error)
                setSettings(draft)
                flash('Modelo salvo — vale para o Gerador e os agendamentos.')
              })
            }
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Salvar modelo
          </button>
        )}
      </section>
      <section className={CARD}>
        <FieldLabel>Prévia da mensagem</FieldLabel>
        {preview ? (
          <pre className="whitespace-pre-wrap rounded-[5px] border border-[#222225] bg-[#0B0B0C] p-3 font-mono text-[12px] leading-relaxed text-[#ECE9E3]">{reportMessage(preview)}</pre>
        ) : (
          <p className="text-[12px] text-[#8E8A86]">A prévia aparece quando o Gerador terminar de consultar a primeira conta.</p>
        )}
      </section>
    </div>
  )
}
