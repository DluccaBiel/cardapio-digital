'use client'

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, CalendarClock, Loader2, Pause, Play, QrCode, Search, Send, ShieldCheck, Smartphone, X } from 'lucide-react'
import type { Campaign, ProspectLead, WhatsappSession } from '../../../lib/db/disparos'
import {
  createCampaignAction,
  requestSearchAction,
  searchStatusAction,
  setCampaignStatusAction,
  whatsappConnectAction,
  whatsappStatusAction,
} from '../../../app/a/[ws]/disparos/actions'
import { FieldLabel, Toast, cn } from '../ui'
import { PageHeader, Pill } from './shared'

type Props = {
  ws: string
  canManage: boolean
  ready: boolean
  initialSession: WhatsappSession | null
  leads: ProspectLead[]
  campaigns: Campaign[]
}

const INPUT =
  'h-[38px] w-full rounded-[5px] border border-[#2A2A2E] bg-[#0B0B0C] px-3 text-[13px] text-[#ECE9E3] outline-none placeholder:text-[#85817C] focus:border-[#D7141F]'
const CARD = 'rounded-[6px] border border-[#222225] bg-[#111113] p-4 md:p-5'
const BTN_PRIMARY =
  'inline-flex items-center justify-center gap-1.5 rounded-[5px] bg-[#D7141F] px-4 py-2 text-[13px] font-semibold text-white hover:bg-[#B5121B] disabled:opacity-40'
const BTN_GHOST =
  'inline-flex items-center gap-1.5 rounded-[5px] border border-[#2A2A2E] px-3 py-1.5 text-[12px] font-semibold text-[#CFCBC4] hover:border-[#D7141F] hover:text-white disabled:opacity-40'

const DAYS = [
  { v: 1, l: 'Seg' },
  { v: 2, l: 'Ter' },
  { v: 3, l: 'Qua' },
  { v: 4, l: 'Qui' },
  { v: 5, l: 'Sex' },
  { v: 6, l: 'Sáb' },
  { v: 0, l: 'Dom' },
]

const INTERVALS = [
  { key: 'cauteloso', label: 'Cauteloso · 3 a 6 min', min: 180, max: 360 },
  { key: 'seguro', label: 'Seguro · 1 a 3 min (recomendado)', min: 60, max: 180 },
  { key: 'moderado', label: 'Moderado · 45 a 90 s', min: 45, max: 90 },
  { key: 'custom', label: 'Personalizado', min: 0, max: 0 },
] as const

const LEAD_STATUS: Record<ProspectLead['status'], { label: string; tone: 'neutral' | 'green' | 'amber' | 'red' }> = {
  novo: { label: 'Novo', tone: 'green' },
  na_fila: { label: 'Na fila', tone: 'amber' },
  contatado: { label: 'Contatado', tone: 'neutral' },
  respondeu: { label: 'Respondeu', tone: 'green' },
  opt_out: { label: 'Pediu p/ sair', tone: 'red' },
  invalido: { label: 'Sem WhatsApp', tone: 'red' },
}

const CAMPAIGN_STATUS: Record<Campaign['status'], { label: string; tone: 'neutral' | 'green' | 'amber' | 'red' }> = {
  agendada: { label: 'Agendado', tone: 'amber' },
  enviando: { label: 'Enviando', tone: 'green' },
  pausada: { label: 'Pausado', tone: 'neutral' },
  concluida: { label: 'Concluído', tone: 'green' },
  cancelada: { label: 'Cancelado', tone: 'red' },
}

function todaySP(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

function fmtPhone(p: string | null | undefined): string {
  if (!p) return ''
  const d = p.replace(/^55/, '')
  return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : d.length === 10 ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}` : p
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
}

export function DisparosScreen({ ws, canManage, ready, initialSession, leads: initialLeads, campaigns }: Props) {
  const [toast, setToast] = useState<string | null>(null)
  const flash = useCallback((t: string) => {
    setToast(t)
    window.setTimeout(() => setToast(null), 4000)
  }, [])

  // Público: leads conhecidos + novos desta busca, com seleção
  const [leads, setLeads] = useState<ProspectLead[]>(initialLeads)
  useEffect(() => setLeads(initialLeads), [initialLeads])
  const [selected, setSelected] = useState<Set<string>>(new Set())

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 pb-10 pt-5 sm:px-6 md:px-[30px] md:pt-[26px]">
      <PageHeader title="Disparos WhatsApp" description="Conecte seu WhatsApp pelo QR code, deixe a IA montar o público e agende os envios com intervalo seguro." />

      {!ready && (
        <div className="mb-4 rounded-[6px] border border-[#F59E0B]/35 bg-[#F59E0B]/10 px-4 py-3 text-[12px] text-[#FBBF24]">
          As tabelas de disparo ainda não existem neste banco — aplique a migration <code>20261118120000_whatsapp_disparos.sql</code>.
        </div>
      )}
      {!canManage && (
        <div className="mb-4 rounded-[6px] border border-[#2A2A2E] bg-[#111113] px-4 py-3 text-[12px] text-[#8E8A86]">
          Somente dono ou coordenador conectam o WhatsApp e criam disparos. Você pode acompanhar os envios abaixo.
        </div>
      )}

      {ready && canManage && <WhatsAppCard ws={ws} initial={initialSession} flash={flash} />}
      {ready && canManage && <AudienceCard ws={ws} leads={leads} setLeads={setLeads} selected={selected} setSelected={setSelected} flash={flash} />}
      {ready && canManage && <CampaignForm ws={ws} selected={selected} leads={leads} onCreated={() => setSelected(new Set())} flash={flash} />}
      {ready && <CampaignList ws={ws} campaigns={campaigns} canManage={canManage} flash={flash} />}

      <Toast message={toast} />
    </div>
  )
}

// ===========================================================================
// 1) Conexão WhatsApp (QR → vinculado → sincronização)
// ===========================================================================
function WhatsAppCard({ ws, initial, flash }: { ws: string; initial: WhatsappSession | null; flash: (t: string) => void }) {
  const [session, setSession] = useState<WhatsappSession | null>(initial)
  const [workerOnline, setWorkerOnline] = useState<boolean | null>(null)
  const [pending, start] = useTransition()

  useEffect(() => {
    let alive = true
    const tick = async () => {
      const r = await whatsappStatusAction(ws).catch(() => null)
      if (!alive || !r || !r.ok) return
      setSession(r.session)
      setWorkerOnline(r.workerOnline)
    }
    tick()
    const id = window.setInterval(tick, 3000)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [ws])

  const wants = session?.desired_state === 'connected'
  const st = session?.status ?? 'disconnected'
  const linked = st === 'syncing' || st === 'ready'

  function request(connect: boolean) {
    start(async () => {
      const r = await whatsappConnectAction(ws, connect)
      if (!r.ok) return flash(r.error)
      setSession((s) => ({ ...(s ?? ({} as WhatsappSession)), desired_state: connect ? 'connected' : 'disconnected', last_error: null }))
      flash(connect ? 'Pedido enviado ao robô — o QR code aparece em instantes.' : 'Desconectando…')
    })
  }

  return (
    <section className={cn(CARD, 'mb-6')}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="uc-title flex items-center gap-2 text-[18px] text-[#F7F5F1]">
          <Smartphone size={18} className="text-[#D7141F]" /> Conexão do WhatsApp
        </h2>
        <div className="flex items-center gap-2">
          {linked ? <Pill tone="green">Vinculado</Pill> : wants ? <Pill tone="amber">Conectando</Pill> : <Pill>Desconectado</Pill>}
          {workerOnline === false && <Pill tone="red">Robô desligado</Pill>}
          {workerOnline && <Pill tone="green">Robô online</Pill>}
        </div>
      </div>

      {workerOnline === false && (
        <div className="mb-4 rounded-[5px] border border-[#D7141F]/40 bg-[#1F0D0F]/60 p-3 text-[12px] leading-relaxed text-[#FFB199]">
          O robô de envio não está rodando no seu computador. Abra um terminal na pasta do projeto e rode{' '}
          <code className="rounded bg-black/40 px-1.5 py-0.5 text-[#ECE9E3]">npm run worker</code>. Ele precisa ficar aberto para conectar e
          disparar.
        </div>
      )}

      <div className="grid gap-5 md:grid-cols-[320px_1fr]">
        <div className="flex min-h-[220px] items-center justify-center rounded-[6px] border border-dashed border-[#2A2A2E] bg-[#0B0B0C] p-3">
          {st === 'qr' && session?.qr_data_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={session.qr_data_url} alt="QR code para vincular o WhatsApp" width={280} height={280} className="rounded bg-white p-2" />
          ) : linked ? (
            <div className="text-center">
              <ShieldCheck size={44} className="mx-auto text-[#4ADE80]" />
              <p className="mt-2 text-[14px] font-semibold text-[#ECE9E3]">{session?.display_name || 'WhatsApp vinculado'}</p>
              <p className="font-mono text-[12px] text-[#8E8A86]">{fmtPhone(session?.phone)}</p>
            </div>
          ) : wants ? (
            <div className="text-center text-[12px] text-[#8E8A86]">
              <Loader2 size={28} className="mx-auto mb-2 animate-spin text-[#D7141F]" />
              {st === 'connecting' ? 'QR lido — vinculando…' : 'Gerando QR code…'}
            </div>
          ) : (
            <div className="text-center text-[12px] text-[#85817C]">
              <QrCode size={44} className="mx-auto mb-2 text-[#3A3A3F]" />
              O QR code aparece aqui
            </div>
          )}
        </div>

        <div className="flex flex-col justify-between gap-4">
          {st === 'qr' ? (
            <ol className="list-decimal space-y-1.5 pl-5 text-[13px] text-[#CFCBC4]">
              <li>Abra o WhatsApp no celular do número que vai disparar.</li>
              <li>
                Toque em <b>⋮ / Configurações → Aparelhos conectados → Conectar aparelho</b>.
              </li>
              <li>Aponte a câmera para o QR code ao lado (ele se renova sozinho a cada ~20 s).</li>
            </ol>
          ) : linked ? (
            <div>
              <FieldLabel>Status da sincronização</FieldLabel>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-[#1C1C1F]">
                <div
                  className={cn('h-full rounded-full transition-all', st === 'ready' ? 'bg-[#22C55E]' : 'bg-[#F59E0B]')}
                  style={{ width: `${st === 'ready' ? 100 : Math.max(5, session?.sync_progress ?? 5)}%` }}
                />
              </div>
              <p className="mt-2 text-[13px] text-[#ECE9E3]">
                {st === 'ready' ? 'Sincronização concluída — pronto para enviar.' : session?.sync_detail || 'Sincronizando conversas…'}
              </p>
              <p className="mt-1 font-mono text-[11px] text-[#85817C]">Vinculado em {fmtDateTime(session?.connected_at ?? null)}</p>
            </div>
          ) : (
            <p className="text-[13px] leading-relaxed text-[#8E8A86]">
              Conexão <b className="text-[#ECE9E3]">não oficial</b>, igual ao WhatsApp Web: basta ler o QR code com o celular. Use um número
              que você pode arriscar — o WhatsApp pode restringir números que enviam muitas mensagens para quem não os tem salvos.
            </p>
          )}

          {session?.last_error && !linked && <p className="text-[12px] text-[#F0333D]">{session.last_error}</p>}

          <div className="flex flex-wrap gap-2">
            {!wants ? (
              <button type="button" onClick={() => request(true)} disabled={pending} className={cn(BTN_PRIMARY, 'bg-[#16A34A] hover:bg-[#15803D]')}>
                <QrCode size={15} /> Conectar WhatsApp
              </button>
            ) : (
              <button type="button" onClick={() => request(false)} disabled={pending} className={BTN_GHOST}>
                <X size={13} /> {linked ? 'Desvincular' : 'Cancelar'}
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

// ===========================================================================
// 2) Público — agente de prospecção (empresas food novas)
// ===========================================================================
function AudienceCard({
  ws,
  leads,
  setLeads,
  selected,
  setSelected,
  flash,
}: {
  ws: string
  leads: ProspectLead[]
  setLeads: (f: (l: ProspectLead[]) => ProspectLead[]) => void
  selected: Set<string>
  setSelected: (s: Set<string>) => void
  flash: (t: string) => void
}) {
  const [city, setCity] = useState('')
  const [uf, setUf] = useState('')
  const [requesting, start] = useTransition()
  const [searchId, setSearchId] = useState<string | null>(null)
  const [progress, setProgress] = useState<string | null>(null)
  const [summary, setSummary] = useState<string | null>(null)
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set())
  const [view, setView] = useState<'novos' | 'disponiveis' | 'todos'>('disponiveis')
  const pending = requesting || searchId !== null

  // Acompanha a pesquisa feita pelo robô local até concluir.
  useEffect(() => {
    if (!searchId) return
    let alive = true
    const tick = async () => {
      const r = await searchStatusAction(ws, searchId).catch(() => null)
      if (!alive || !r) return
      if (!r.ok) {
        setSearchId(null)
        return flash(r.error)
      }
      const s = r.search
      if (s.status === 'pendente') setProgress('Pedido na fila — aguardando o robô do seu computador começar…')
      else if (s.status === 'buscando') setProgress(s.detail || 'O agente está varrendo a cidade…')
      else {
        setSearchId(null)
        setProgress(null)
        if (s.status === 'erro') return flash(s.detail || 'A pesquisa falhou.')
        const ids = new Set(r.fresh.map((l) => l.id))
        setLeads((prev) => [...r.fresh, ...prev.filter((p) => !ids.has(p.id))])
        setFreshIds(ids)
        setSelected(new Set(ids)) // novos já entram como público
        setView('novos')
        const where = s.label || [s.city, s.uf].filter(Boolean).join('/')
        setSummary(
          s.created_count > 0
            ? `${where}: ${s.found} empresas food com telefone · ${s.created_count} novas adicionadas ao público · ${s.found - s.created_count} já conhecidas ou clientes.`
            : `${where}: ${s.found} empresas encontradas, nenhuma nova (todas já estavam na sua base). Tente outra cidade vizinha.`,
        )
      }
    }
    tick()
    const id = window.setInterval(tick, 3000)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [searchId, ws, flash, setLeads, setSelected])

  const shown = useMemo(() => {
    if (view === 'novos') return leads.filter((l) => freshIds.has(l.id))
    if (view === 'disponiveis') return leads.filter((l) => l.status === 'novo')
    return leads
  }, [leads, view, freshIds])

  const selectable = (l: ProspectLead) => l.status !== 'opt_out' && l.status !== 'invalido'

  function search() {
    start(async () => {
      setSummary(null)
      const r = await requestSearchAction(ws, { city, uf })
      if (!r.ok) return flash(r.error)
      setProgress('Pedido enviado ao robô…')
      setSearchId(r.search.id)
    })
  }

  function toggle(id: string) {
    const s = new Set(selected)
    if (s.has(id)) s.delete(id)
    else s.add(id)
    setSelected(s)
  }
  const allShownSelected = shown.filter(selectable).length > 0 && shown.filter(selectable).every((l) => selected.has(l.id))
  function toggleAll() {
    const s = new Set(selected)
    for (const l of shown.filter(selectable)) {
      if (allShownSelected) s.delete(l.id)
      else s.add(l.id)
    }
    setSelected(s)
  }

  return (
    <section className={cn(CARD, 'mb-6')}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="uc-title flex items-center gap-2 text-[18px] text-[#F7F5F1]">
          <Search size={18} className="text-[#D7141F]" /> Público · Agente de prospecção IA
        </h2>
        <Pill tone="amber">Nicho: Food</Pill>
      </div>
      <p className="mb-4 text-[12px] leading-relaxed text-[#8E8A86]">
        O agente procura restaurantes, lanchonetes, bares, cafés, padarias e docerias <b className="text-[#CFCBC4]">com telefone</b> na cidade
        (dados abertos do OpenStreetMap, sem chave do Google). Só entram empresas que ainda não estão na sua base nem são clientes — e as novas
        já vão direto para o público do disparo.
      </p>

      <form
        className="mb-4 grid gap-3 sm:grid-cols-[1fr_90px_auto]"
        onSubmit={(e) => {
          e.preventDefault()
          if (city.trim().length >= 2) search()
        }}
      >
        <label>
          <FieldLabel>Cidade</FieldLabel>
          <input className={INPUT} value={city} onChange={(e) => setCity(e.target.value)} placeholder="Ex.: Campinas" maxLength={80} />
        </label>
        <label>
          <FieldLabel>UF</FieldLabel>
          <input className={cn(INPUT, 'uppercase')} value={uf} onChange={(e) => setUf(e.target.value.slice(0, 2))} placeholder="SP" maxLength={2} />
        </label>
        <div className="flex items-end">
          <button type="submit" disabled={pending || city.trim().length < 2} className={cn(BTN_PRIMARY, 'h-[38px] w-full sm:w-auto')}>
            {pending ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
            {pending ? 'Pesquisando…' : 'Buscar empresas novas'}
          </button>
        </div>
      </form>
      {pending && (
        <p className="mb-3 flex items-center gap-2 text-[12px] text-[#8E8A86]">
          <Loader2 size={13} className="animate-spin text-[#D7141F]" />
          {progress ?? 'Enviando pedido…'} Pode levar alguns minutos — os servidores de mapas são gratuitos e às vezes lentos.
        </p>
      )}
      {summary && <p className="mb-3 rounded-[5px] bg-[#0B0B0C] px-3 py-2 text-[12px] text-[#CFCBC4]">{summary}</p>}

      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-[6px] border border-[#2A2A2E] bg-[#0B0B0C] p-0.5">
          {(
            [
              ['novos', `Desta busca (${freshIds.size})`],
              ['disponiveis', `Nunca contatados (${leads.filter((l) => l.status === 'novo').length})`],
              ['todos', `Todos (${leads.length})`],
            ] as const
          ).map(([v, l]) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={cn('rounded-[5px] px-3 py-1.5 text-[12px] font-semibold', view === v ? 'bg-[#D7141F] text-white' : 'text-[#8E8A86] hover:text-[#ECE9E3]')}
            >
              {l}
            </button>
          ))}
        </div>
        <p className="font-mono text-[12px] text-[#ECE9E3]">
          <b className="text-[#4ADE80]">{selected.size}</b> no público do disparo
        </p>
      </div>

      <div className="max-h-[360px] overflow-auto rounded-[6px] border border-[#222225]">
        <table className="w-full min-w-[640px] border-collapse text-left">
          <thead className="sticky top-0 z-10 bg-[#0E0E10] [&_th]:bg-[#0E0E10]">
            <tr className="border-b border-[#1C1C1F] bg-[#0E0E10] font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-[#8E8A86]">
              <th className="w-10 px-3 py-2.5">
                <input type="checkbox" aria-label="Selecionar todos" checked={allShownSelected} onChange={toggleAll} className="accent-[#D7141F]" />
              </th>
              <th className="px-3 py-2.5">Empresa</th>
              <th className="px-3 py-2.5">Tipo</th>
              <th className="px-3 py-2.5">Telefone</th>
              <th className="px-3 py-2.5">Cidade</th>
              <th className="px-3 py-2.5">Status</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((l) => (
              <tr key={l.id} className="border-b border-[#18181B] bg-[#111113] text-[12px] last:border-b-0 hover:bg-[#131315]">
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label={`Selecionar ${l.name}`}
                    disabled={!selectable(l)}
                    checked={selected.has(l.id)}
                    onChange={() => toggle(l.id)}
                    className="accent-[#D7141F]"
                  />
                </td>
                <td className="px-3 py-2 font-semibold text-[#ECE9E3]">
                  {l.name}
                  {l.address && <span className="block text-[11px] font-normal text-[#85817C]">{l.address}</span>}
                </td>
                <td className="px-3 py-2 text-[#CFCBC4]">{l.category ?? '—'}</td>
                <td className="px-3 py-2 font-mono text-[#CFCBC4]">{fmtPhone(l.phone)}</td>
                <td className="px-3 py-2 text-[#CFCBC4]">{[l.city, l.uf].filter(Boolean).join('/') || '—'}</td>
                <td className="px-3 py-2">
                  <Pill tone={LEAD_STATUS[l.status].tone}>{LEAD_STATUS[l.status].label}</Pill>
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={6} className="bg-[#111113] px-3 py-10 text-center text-[12px] text-[#85817C]">
                  {leads.length === 0 ? 'Busque uma cidade para o agente montar o público.' : 'Nada nesta visão.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-[#85817C]">Dados © colaboradores do OpenStreetMap (ODbL).</p>
    </section>
  )
}

// ===========================================================================
// 3) Mensagem + agenda + intervalo
// ===========================================================================
function CampaignForm({
  ws,
  selected,
  leads,
  onCreated,
  flash,
}: {
  ws: string
  selected: Set<string>
  leads: ProspectLead[]
  onCreated: () => void
  flash: (t: string) => void
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [name, setName] = useState('')
  const [message, setMessage] = useState('')
  const [startDate, setStartDate] = useState(todaySP())
  const [days, setDays] = useState<Set<number>>(new Set([1, 2, 3, 4, 5]))
  const [windowStart, setWindowStart] = useState('09:00')
  const [windowEnd, setWindowEnd] = useState('18:00')
  const [preset, setPreset] = useState<(typeof INTERVALS)[number]['key']>('seguro')
  const [customMin, setCustomMin] = useState(60)
  const [customMax, setCustomMax] = useState(180)
  const [dailyLimit, setDailyLimit] = useState(40)

  const p = INTERVALS.find((i) => i.key === preset)!
  const min = preset === 'custom' ? customMin : p.min
  const max = preset === 'custom' ? customMax : p.max
  const audience = leads.filter((l) => selected.has(l.id)).length
  const perDayByWindow = (() => {
    const [h1, m1] = windowStart.split(':').map(Number)
    const [h2, m2] = windowEnd.split(':').map(Number)
    const minutes = h2! * 60 + m2! - (h1! * 60 + m1!)
    return minutes > 0 && max > 0 ? Math.floor((minutes * 60) / ((min + max) / 2 + 4)) : 0
  })()
  const perDay = Math.max(0, Math.min(dailyLimit, perDayByWindow))
  const daysNeeded = perDay > 0 ? Math.ceil(audience / perDay) : 0
  const preview = message.replace(/\{nome\}/gi, leads.find((l) => selected.has(l.id))?.name ?? 'Restaurante Exemplo')

  function toggleDay(d: number) {
    const s = new Set(days)
    if (s.has(d)) s.delete(d)
    else s.add(d)
    setDays(s)
  }

  function submit() {
    start(async () => {
      const r = await createCampaignAction(ws, {
        name: name.trim() || `Disparo food · ${new Intl.DateTimeFormat('pt-BR').format(new Date())}`,
        message,
        start_date: startDate,
        days_of_week: Array.from(days),
        window_start: windowStart,
        window_end: windowEnd,
        interval_min_seconds: min,
        interval_max_seconds: max,
        daily_limit: dailyLimit,
        lead_ids: Array.from(selected),
      })
      if (!r.ok) return flash(r.error)
      flash(`Disparo agendado para ${r.total} empresa(s).`)
      setMessage('')
      setName('')
      onCreated()
      router.refresh()
    })
  }

  const invalid = audience === 0 || !message.trim() || days.size === 0 || windowEnd <= windowStart || min < 20 || max < min

  return (
    <section className={cn(CARD, 'mb-6')}>
      <h2 className="uc-title mb-4 flex items-center gap-2 text-[18px] text-[#F7F5F1]">
        <CalendarClock size={18} className="text-[#D7141F]" /> Mensagem e agendamento
      </h2>

      <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <label className="block">
            <FieldLabel>Nome do disparo (opcional)</FieldLabel>
            <input className={INPUT} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Food Campinas — novembro" maxLength={120} />
          </label>
          <label className="block">
            <FieldLabel>Mensagem · use {'{nome}'} para o nome da empresa</FieldLabel>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={7}
              maxLength={2000}
              placeholder={'Olá, {nome}! Tudo bem?\nSou da Undercut, ajudamos restaurantes a vender mais no delivery…\n\nSe não quiser receber mensagens, responda SAIR.'}
              className="w-full rounded-[5px] border border-[#2A2A2E] bg-[#0B0B0C] p-3 text-[13px] text-[#ECE9E3] outline-none placeholder:text-[#85817C] focus:border-[#D7141F]"
            />
            <span className="mt-1 block text-right font-mono text-[10px] text-[#85817C]">{message.length}/2000</span>
          </label>
          {message.trim() && (
            <div>
              <FieldLabel>Prévia</FieldLabel>
              <div className="whitespace-pre-wrap rounded-[8px] bg-[#0B3D2E] px-3 py-2 text-[13px] text-[#E7FFE9]">{preview}</div>
            </div>
          )}
          {!/sair/i.test(message) && message.trim() && (
            <p className="text-[11px] text-[#FBBF24]">Dica: inclua “responda SAIR para não receber mais” — o robô respeita o pedido automaticamente (LGPD).</p>
          )}
        </div>

        <div className="space-y-4">
          <div>
            <FieldLabel>Dias da semana</FieldLabel>
            <div className="flex flex-wrap gap-1.5">
              {DAYS.map((d) => (
                <button
                  key={d.v}
                  type="button"
                  aria-pressed={days.has(d.v)}
                  onClick={() => toggleDay(d.v)}
                  className={cn(
                    'h-[34px] w-[46px] rounded-[5px] border text-[12px] font-semibold',
                    days.has(d.v) ? 'border-[#D7141F] bg-[#D7141F] text-white' : 'border-[#2A2A2E] text-[#8E8A86] hover:text-[#ECE9E3]',
                  )}
                >
                  {d.l}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <label>
              <FieldLabel>Começa em</FieldLabel>
              <input type="date" className={INPUT} value={startDate} min={todaySP()} onChange={(e) => setStartDate(e.target.value)} />
            </label>
            <label>
              <FieldLabel>Das</FieldLabel>
              <input type="time" className={INPUT} value={windowStart} onChange={(e) => setWindowStart(e.target.value)} />
            </label>
            <label>
              <FieldLabel>Até</FieldLabel>
              <input type="time" className={INPUT} value={windowEnd} onChange={(e) => setWindowEnd(e.target.value)} />
            </label>
          </div>
          <label className="block">
            <FieldLabel>Intervalo entre cada envio</FieldLabel>
            <select className={cn(INPUT, 'cursor-pointer')} value={preset} onChange={(e) => setPreset(e.target.value as typeof preset)}>
              {INTERVALS.map((i) => (
                <option key={i.key} value={i.key}>
                  {i.label}
                </option>
              ))}
            </select>
          </label>
          {preset === 'custom' && (
            <div className="grid grid-cols-2 gap-2">
              <label>
                <FieldLabel>Mínimo (segundos)</FieldLabel>
                <input type="number" min={20} max={3600} className={INPUT} value={customMin} onChange={(e) => setCustomMin(Number(e.target.value))} />
              </label>
              <label>
                <FieldLabel>Máximo (segundos)</FieldLabel>
                <input type="number" min={20} max={3600} className={INPUT} value={customMax} onChange={(e) => setCustomMax(Number(e.target.value))} />
              </label>
            </div>
          )}
          <label className="block">
            <FieldLabel>Limite de envios por dia (número inteiro)</FieldLabel>
            <input type="number" min={1} max={300} className={INPUT} value={dailyLimit} onChange={(e) => setDailyLimit(Number(e.target.value))} />
          </label>

          <div className="rounded-[5px] border border-[#2A2A2E] bg-[#0B0B0C] p-3 text-[12px] leading-relaxed text-[#CFCBC4]">
            <p>
              Público: <b className="text-[#ECE9E3]">{audience}</b> empresa(s) · intervalo aleatório de <b>{min}</b> a <b>{max}</b> s
            </p>
            <p>
              ≈ <b>{perDay}</b> envios/dia → {audience > 0 && perDay > 0 ? <b>{daysNeeded} dia(s) de disparo</b> : '—'}
            </p>
            {(min < 45 || dailyLimit > 80) && (
              <p className="mt-1 flex gap-1.5 text-[#FBBF24]">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" /> Ritmo agressivo: aumenta o risco de o WhatsApp bloquear o número.
              </p>
            )}
          </div>

          <button type="button" onClick={submit} disabled={pending || invalid} className={cn(BTN_PRIMARY, 'w-full py-2.5')}>
            {pending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Agendar disparo
          </button>
          {audience === 0 && <p className="text-center text-[11px] text-[#85817C]">Selecione o público acima (a busca da IA já seleciona as empresas novas).</p>}
        </div>
      </div>

      <div className="mt-5 flex gap-3 rounded-[6px] border border-[#D7141F]/40 bg-[#1F0D0F]/60 p-4">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-[#F0333D]" />
        <div className="text-[12px] leading-relaxed text-[#FFB199]">
          <p className="font-bold text-[#F0333D]">Para não perder o número</p>
          Conexão não oficial: o WhatsApp pode banir números que mandam muitas mensagens para quem não tem o contato salvo. Comece com 20–40 por
          dia num número “aquecido” (com conversas reais), mantenha intervalos longos, personalize com {'{nome}'} e sempre ofereça a opção SAIR.
          Respostas “SAIR/PARAR” tiram a empresa do público automaticamente.
        </div>
      </div>
    </section>
  )
}

// ===========================================================================
// 4) Disparos agendados
// ===========================================================================
function CampaignList({ ws, campaigns, canManage, flash }: { ws: string; campaigns: Campaign[]; canManage: boolean; flash: (t: string) => void }) {
  const router = useRouter()
  const [pending, start] = useTransition()

  // Atualiza o progresso enquanto houver disparo ativo.
  const active = campaigns.some((c) => c.status === 'enviando' || c.status === 'agendada')
  useEffect(() => {
    if (!active) return
    const id = window.setInterval(() => router.refresh(), 15_000)
    return () => window.clearInterval(id)
  }, [active, router])

  function set(id: string, status: 'pausada' | 'agendada' | 'cancelada') {
    if (status === 'cancelada' && !window.confirm('Cancelar este disparo? Os envios pendentes não serão feitos.')) return
    start(async () => {
      const r = await setCampaignStatusAction(ws, id, status)
      if (!r.ok) return flash(r.error)
      router.refresh()
    })
  }

  const dayLabel = (d: number[]) => DAYS.filter((x) => d.includes(x.v)).map((x) => x.l).join(', ')

  return (
    <section>
      <h2 className="uc-title mb-3 text-[18px] text-[#F7F5F1]">Disparos agendados</h2>
      <div className="overflow-x-auto rounded-[6px] border border-[#222225]">
        <table className="w-full min-w-[820px] border-collapse text-left">
          <thead>
            <tr className="border-b border-[#1C1C1F] bg-[#0E0E10] font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-[#8E8A86]">
              <th className="px-3 py-2.5">Disparo</th>
              <th className="px-3 py-2.5">Status</th>
              <th className="px-3 py-2.5">Progresso</th>
              <th className="px-3 py-2.5">Agenda</th>
              <th className="px-3 py-2.5">Próximo envio</th>
              {canManage && <th className="px-3 py-2.5 text-right">Ações</th>}
            </tr>
          </thead>
          <tbody>
            {campaigns.map((c) => {
              const pct = c.total > 0 ? Math.round(((c.sent_count + c.failed_count) / c.total) * 100) : 0
              return (
                <tr key={c.id} className="border-b border-[#18181B] bg-[#111113] align-top text-[12px] last:border-b-0">
                  <td className="px-3 py-2.5">
                    <span className="font-semibold text-[#ECE9E3]">{c.name}</span>
                    <span className="block max-w-[280px] truncate text-[11px] text-[#85817C]">{c.message}</span>
                    {c.last_error && <span className="block text-[11px] text-[#F0333D]">{c.last_error}</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    <Pill tone={CAMPAIGN_STATUS[c.status].tone}>{CAMPAIGN_STATUS[c.status].label}</Pill>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="mb-1 h-1.5 w-[140px] overflow-hidden rounded-full bg-[#1C1C1F]">
                      <div className="h-full bg-[#22C55E]" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="font-mono text-[11px] text-[#CFCBC4]">
                      {c.sent_count}/{c.total} enviados{c.failed_count > 0 ? ` · ${c.failed_count} falhas` : ''}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-[11px] text-[#CFCBC4]">
                    {dayLabel(c.days_of_week)} · {c.window_start.slice(0, 5)}–{c.window_end.slice(0, 5)}
                    <span className="block text-[#85817C]">
                      a partir de {c.start_date.split('-').reverse().join('/')} · {c.interval_min_seconds}–{c.interval_max_seconds}s · máx {c.daily_limit}/dia
                    </span>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[11px] text-[#CFCBC4]">{c.status === 'enviando' || c.status === 'agendada' ? fmtDateTime(c.next_send_at) : '—'}</td>
                  {canManage && (
                    <td className="px-3 py-2.5 text-right">
                      <div className="inline-flex gap-1.5">
                        {(c.status === 'agendada' || c.status === 'enviando') && (
                          <button type="button" disabled={pending} onClick={() => set(c.id, 'pausada')} className={BTN_GHOST}>
                            <Pause size={12} /> Pausar
                          </button>
                        )}
                        {c.status === 'pausada' && (
                          <button type="button" disabled={pending} onClick={() => set(c.id, 'agendada')} className={BTN_GHOST}>
                            <Play size={12} /> Retomar
                          </button>
                        )}
                        {(c.status === 'agendada' || c.status === 'enviando' || c.status === 'pausada') && (
                          <button type="button" disabled={pending} onClick={() => set(c.id, 'cancelada')} className={BTN_GHOST}>
                            <X size={12} /> Cancelar
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              )
            })}
            {campaigns.length === 0 && (
              <tr>
                <td colSpan={canManage ? 6 : 5} className="bg-[#111113] px-3 py-10 text-center text-[12px] text-[#85817C]">
                  Nenhum disparo ainda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
