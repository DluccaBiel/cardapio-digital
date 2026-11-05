'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  CalendarDays,
  Camera,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Clock,
  Copy,
  Download,
  FileText,
  GripVertical,
  Info,
  Link2,
  ListFilter,
  Plus,
  Search,
  Share2,
  SlidersHorizontal,
  Sparkles,
  StickyNote,
  Upload,
  Users,
  X,
} from 'lucide-react'
import { currentISOWeek, formatBRL, shortDate } from '@/lib/format'
import type { MockClient, MockTag, Situation } from '@/lib/mock'
import { cn, FieldLabel, Modal, TextInput, TextSelect, Toast, Toggle } from '@/components/hub/ui'

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
const DAY = 86_400_000

const SITUATION_LABEL: Record<Situation, string> = { ativo: 'Ativo', onboarding: 'Onboarding', stand_by: 'Stand-by', churn: 'Churn' }
const SITUATION_CHIP: Record<Situation, string> = {
  ativo: 'border-[#34D399]/60 bg-[#0D1320] text-[#34D399]',
  onboarding: 'border-[#3D8EFF]/60 bg-[#0D1320] text-[#6EA8FF]',
  stand_by: 'border-[#2A3549] bg-[#0D1320] text-[#C9D3E3]',
  churn: 'border-[#2A3549] bg-[#0D1320] text-[#C9D3E3]',
}
const SITUATION_PILL: Record<Situation, string> = {
  ativo: 'border-[#2A3549] bg-[#161C26] text-[#34D399]',
  onboarding: 'border-[#3D8EFF]/50 bg-[#3D8EFF]/10 text-[#6EA8FF]',
  stand_by: 'border-[#2A3549] bg-[#161C26] text-[#C9D3E3]',
  churn: 'border-[#F87171]/45 bg-[#F87171]/10 text-[#FCA5A5]',
}
const CAMPAIGN_LABEL: Record<string, string> = {
  nao_definido: '— Estado —',
  planejamento: 'Planejamento',
  ativo: 'Ativo',
  pausado: 'Pausado',
  encerrado: 'Encerrado',
}
const CREATIVE_LABEL: Record<string, string> = {
  nao_definido: '— Não definido —',
  em_producao: 'Em produção',
  estatico_pronto: 'Estático pronto',
  video_pronto: 'Vídeo pronto',
  em_aprovacao: 'Em aprovação',
}
const DELIVERY_LABEL: Record<string, string> = {
  pendente: '— Entrega —',
  estatico_pronto: 'Estático pronto',
  video_pronto: 'Vídeo pronto',
  sem_criativo: 'Sem criativo',
  entregue: 'Entregue',
}

type ColumnId =
  | 'client'
  | 'situation'
  | 'tags'
  | 'spend'
  | 'balance'
  | 'termination'
  | 'lastChange'
  | 'pix'
  | 'campaign'
  | 'routine'
  | 'creative'
  | 'delivery'

type SortKey =
  | 'name'
  | 'situation'
  | 'spendMonth'
  | 'balance'
  | 'termination'
  | 'lastChange'
  | 'campaignState'
  | 'creativeStatus'
  | 'deliveryState'
  | 'editor'

const COLUMNS: { id: ColumnId; label: string; width: number; sortKey?: SortKey }[] = [
  { id: 'client', label: 'Cliente', width: 210, sortKey: 'name' },
  { id: 'situation', label: 'Situação', width: 148, sortKey: 'situation' },
  { id: 'tags', label: 'Tags', width: 168 },
  { id: 'spend', label: 'Gasto no mês', width: 148, sortKey: 'spendMonth' },
  { id: 'balance', label: 'Saldo e dias', width: 198, sortKey: 'balance' },
  { id: 'termination', label: 'Término', width: 105, sortKey: 'termination' },
  { id: 'lastChange', label: 'Última alteração', width: 140, sortKey: 'lastChange' },
  { id: 'pix', label: 'Status Pix', width: 140 },
  { id: 'campaign', label: 'Estado da campanha', width: 164, sortKey: 'campaignState' },
  { id: 'routine', label: 'Rotina da semana', width: 240 },
  { id: 'creative', label: 'Status do criativo', width: 190, sortKey: 'creativeStatus' },
  { id: 'delivery', label: 'Entrega / Editor', width: 300, sortKey: 'editor' },
]

const ROUTINES = [
  { key: 'report', label: 'Relatório', Icon: FileText },
  { key: 'upload', label: 'Upload', Icon: Upload },
  { key: 'ia', label: 'IA', Icon: Sparkles },
  { key: 'share', label: 'Compartilhar', Icon: Share2 },
  { key: 'note', label: 'Nota', Icon: StickyNote },
  { key: 'camera', label: 'Câmera', Icon: Camera },
]

const PERIODS = [
  { key: 'today', label: 'Hoje' },
  { key: 'yesterday', label: 'Ontem' },
  { key: 'last7', label: 'Última semana' },
  { key: 'prev7', label: 'Sem. anterior' },
  { key: 'last30', label: '30 dias' },
  { key: 'custom', label: 'Personalizado' },
]

function daysSince(iso: string) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / DAY)
}

function relativeLabel(iso: string) {
  const days = daysSince(iso)
  if (days <= 0) return 'hoje'
  if (days === 1) return 'ontem'
  return `há ${days} dias`
}

function monthShift(iso: string, delta: number) {
  const date = new Date(`${iso}T12:00:00Z`)
  date.setUTCMonth(date.getUTCMonth() + delta)
  return `${date.toISOString().slice(0, 7)}-01`
}

function monthTitle(iso: string) {
  const date = new Date(`${iso}T12:00:00Z`)
  return `${MESES[date.getUTCMonth()]} De ${date.getUTCFullYear()}`
}

export function OverviewScreen({
  initialClients,
  initialTags,
  initialQuery = '',
  workspaceName,
}: {
  initialClients: MockClient[]
  initialTags: MockTag[]
  initialQuery?: string
  workspaceName: string
}) {
  const week = currentISOWeek()
  const [clients, setClients] = useState<MockClient[]>(initialClients)
  const [tags, setTags] = useState<MockTag[]>(initialTags)
  const [month, setMonth] = useState(() => `${new Date().toISOString().slice(0, 7)}-01`)
  const [query, setQuery] = useState(initialQuery)
  const [situation, setSituation] = useState('')
  const [alertFilter, setAlertFilter] = useState('')
  const [campaign, setCampaign] = useState('')
  const [delivery, setDelivery] = useState('')
  const [editor, setEditor] = useState('')
  const [weekPending, setWeekPending] = useState(false)
  const [period, setPeriod] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' } | null>(null)
  const [order, setOrder] = useState<ColumnId[]>(COLUMNS.map((column) => column.id))
  const [hidden, setHidden] = useState<ColumnId[]>([])
  const [dragColumn, setDragColumn] = useState<ColumnId | null>(null)
  const [popover, setPopover] = useState<'filters' | 'columns' | null>(null)
  const [progress, setProgress] = useState(0)
  const [thumb, setThumb] = useState(0.28)
  const [toast, setToast] = useState<string | null>(null)
  const [newClientOpen, setNewClientOpen] = useState(false)
  const [pixFor, setPixFor] = useState<MockClient | null>(null)
  const [tagFor, setTagFor] = useState<MockClient | null>(null)
  const [linksFor, setLinksFor] = useState<MockClient | null>(null)

  const bodyRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 4200)
    return () => clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    const body = bodyRef.current
    if (!body || body.scrollWidth === 0) return
    setThumb(Math.min(1, Math.max(0.12, body.clientWidth / body.scrollWidth)))
  }, [])

  const visibleColumns = order.filter((id) => !hidden.includes(id))
  const tableWidth = visibleColumns.reduce((total, id) => total + (COLUMNS.find((column) => column.id === id)?.width ?? 0), 0)

  const editors = useMemo(() => Array.from(new Set(clients.map((client) => client.editor).filter(Boolean))), [clients])

  const counts = useMemo(() => {
    const base: Record<Situation, number> = { ativo: 0, onboarding: 0, stand_by: 0, churn: 0 }
    for (const client of clients) base[client.situation] += 1
    return base
  }, [clients])

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    return clients.filter((client) => {
      if (term && !client.name.toLowerCase().includes(term) && !client.segment.toLowerCase().includes(term)) return false
      if (situation && client.situation !== situation) return false
      if (alertFilter === 'com' && !client.alert) return false
      if (alertFilter === 'sem' && client.alert) return false
      if (campaign && client.campaignState !== campaign) return false
      if (delivery && client.deliveryState !== delivery) return false
      if (editor && client.editor !== editor) return false
      if (weekPending && client.routine.length >= ROUTINES.length) return false
      if (period && period !== 'custom') {
        const days = daysSince(client.lastChange)
        if (period === 'today' && days > 0) return false
        if (period === 'yesterday' && days !== 1) return false
        if (period === 'last7' && days > 7) return false
        if (period === 'prev7' && (days < 7 || days > 14)) return false
        if (period === 'last30' && days > 30) return false
      }
      return true
    })
  }, [clients, query, situation, alertFilter, campaign, delivery, editor, weekPending, period])

  const sorted = useMemo(() => {
    if (!sort) return filtered
    const multiplier = sort.dir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      const valueA = a[sort.key]
      const valueB = b[sort.key]
      if (valueA === null || valueA === undefined) return 1
      if (valueB === null || valueB === undefined) return -1
      if (typeof valueA === 'number' && typeof valueB === 'number') return (valueA - valueB) * multiplier
      return String(valueA).localeCompare(String(valueB), 'pt-BR') * multiplier
    })
  }, [filtered, sort])

  const activeClients = clients.filter((client) => client.situation === 'ativo').length
  const watchedSpend = clients.reduce((total, client) => total + client.spendMonth, 0)
  const pendingCount = clients.filter((client) => client.routine.length < ROUTINES.length).length

  const update = (clientId: string, patch: Partial<MockClient>) => {
    setClients((current) => current.map((client) => (client.id === clientId ? { ...client, ...patch } : client)))
  }

  const syncScroll = () => {
    const body = bodyRef.current
    const header = headerRef.current
    if (!body || !header) return
    header.scrollLeft = body.scrollLeft
    const max = body.scrollWidth - body.clientWidth
    setProgress(max > 0 ? Math.min(1, body.scrollLeft / max) : 0)
    if (body.scrollWidth > 0) setThumb(Math.min(1, Math.max(0.12, body.clientWidth / body.scrollWidth)))
  }

  const scrollBy = (amount: number) => {
    bodyRef.current?.scrollBy({ left: amount, behavior: 'smooth' })
  }

  const toggleSort = (key?: SortKey) => {
    if (!key) return
    setSort((current) =>
      current?.key === key ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' },
    )
  }

  const moveColumn = (target: ColumnId) => {
    if (!dragColumn || dragColumn === target) return
    setOrder((current) => {
      const next = [...current]
      const from = next.indexOf(dragColumn)
      const to = next.indexOf(target)
      next.splice(from, 1)
      next.splice(to, 0, dragColumn)
      return next
    })
    setDragColumn(null)
  }

  const exportCsv = () => {
    const headers = visibleColumns.map((id) => COLUMNS.find((column) => column.id === id)?.label ?? id)
    const rows = sorted.map((client) => visibleColumns.map((id) => csvValue(client, id)))
    const escape = (value: string) => `"${value.replace(/"/g, '""')}"`
    const content = `\uFEFF${headers.map(escape).join(';')}\n${rows.map((row) => row.map(escape).join(';')).join('\n')}`
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'clientes-demo.csv'
    link.click()
    URL.revokeObjectURL(url)
    setToast('CSV gerado com os dados fictícios da demonstração.')
  }

  const copy = async (value: string, message = 'Copiado.') => {
    try {
      await navigator.clipboard.writeText(value)
      setToast(message)
    } catch {
      setToast('Não foi possível copiar neste navegador.')
    }
  }

  const clearFilters = () => {
    setQuery('')
    setSituation('')
    setAlertFilter('')
    setCampaign('')
    setDelivery('')
    setEditor('')
    setWeekPending(false)
    setPeriod('')
    setPopover(null)
  }

  return (
    <div className="mx-auto w-full max-w-[1720px] px-4 pb-10 pt-5 sm:px-6 md:px-[30px] md:pt-[26px]">
      <h1 className="sr-only">Visão geral — {workspaceName}</h1>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-7">
        <KpiCard
          label="Clientes ativos"
          value={String(activeClients)}
          sub={`${clients.length} no total cadastrado`}
          icon={<Users size={18} strokeWidth={1.8} />}
        />
        <KpiCard
          label={`Gasto (${monthTitle(month).toLowerCase()})`}
          value={formatBRL(watchedSpend)}
          sub="Soma de contas monitoradas"
          icon={<span className="text-[18px] font-bold">$</span>}
        />
      </div>

      <div className="mt-5 flex flex-col gap-4 xl:mt-6 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex h-[48px] items-center rounded-xl border border-[#26314A] bg-[#0D1320] px-1.5">
              <button
                type="button"
                onClick={() => setMonth((current) => monthShift(current, -1))}
                aria-label="Mês anterior"
                className="rounded-lg p-2 text-[#7F8CA3] transition-colors hover:bg-white/[0.04] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3D8EFF]"
              >
                <ChevronLeft size={17} />
              </button>
              <span className="mx-2 flex items-center gap-2 text-[14px] font-semibold text-[#E8EDF7]">
                <CalendarDays size={16} className="text-[#3D8EFF]" />
                {monthTitle(month)}
              </span>
              <button
                type="button"
                onClick={() => setMonth((current) => monthShift(current, 1))}
                aria-label="Próximo mês"
                className="rounded-lg p-2 text-[#7F8CA3] transition-colors hover:bg-white/[0.04] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3D8EFF]"
              >
                <ChevronRight size={17} />
              </button>
            </div>
          </div>

          <div className="mt-2.5 flex flex-wrap gap-2">
            {PERIODS.map((item) => {
              const active = period === item.key
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => {
                    setPeriod(active ? '' : item.key)
                    if (item.key === 'custom') setToast('Período personalizado chega na próxima fase.')
                  }}
                  className={cn(
                    'flex h-[30px] items-center gap-1.5 rounded-lg border px-3 text-[12px] font-medium transition-colors',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3D8EFF]',
                    active
                      ? 'border-[#3D8EFF] bg-[#3D8EFF]/10 text-[#6EA8FF]'
                      : 'border-[#26314A] bg-[#0D1320] text-[#C9D3E3] hover:border-[#3D8EFF]/50 hover:text-white',
                  )}
                >
                  {item.key === 'last30' && <Clock size={13} />}
                  {item.key === 'custom' && <SlidersHorizontal size={13} />}
                  {item.label}
                </button>
              )
            })}
          </div>

          <button
            type="button"
            onClick={() => setNewClientOpen(true)}
            className="mt-2 flex h-[40px] items-center gap-2 rounded-lg bg-[#3D8EFF] px-4 text-[13px] font-bold text-[#06101F] transition-colors hover:bg-[#6EA8FF] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#6EA8FF] focus-visible:ring-offset-2 focus-visible:ring-offset-[#070B12]"
          >
            <Plus size={17} strokeWidth={2.4} />
            Novo cliente
          </button>
        </div>

        <div className="flex flex-col items-start gap-2 xl:items-end">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 hidden text-[11px] font-bold uppercase tracking-[0.12em] text-[#8A97AC] sm:inline">Situação:</span>
            {(Object.keys(SITUATION_LABEL) as Situation[]).map((key) => {
              const active = situation === key
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setSituation(active ? '' : key)}
                  className={cn(
                    'flex h-[36px] items-center gap-2 rounded-full border px-4 text-[13px] font-semibold transition-colors',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3D8EFF]',
                    SITUATION_CHIP[key],
                    active ? 'ring-1 ring-inset ring-current' : 'opacity-90 hover:opacity-100',
                  )}
                >
                  {SITUATION_LABEL[key]}
                  <span className="text-[11px] font-bold text-[#C9D3E3]/70">{counts[key]}</span>
                </button>
              )
            })}
          </div>

          <button
            type="button"
            aria-pressed={weekPending}
            onClick={() => setWeekPending((value) => !value)}
            className={cn(
              'flex h-[38px] items-center gap-3 rounded-full border px-4 text-[13px] transition-colors',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3D8EFF]',
              weekPending
                ? 'border-[#3D8EFF] bg-[#3D8EFF]/10 text-[#6EA8FF]'
                : 'border-[#26314A] bg-[#0D1320] text-[#C9D3E3] hover:border-[#3D8EFF]/50',
            )}
          >
            Só pendências da semana
            <span className="text-[11px] font-bold text-[#8A97AC]">{pendingCount}</span>
          </button>
        </div>
      </div>

      <div className={cn('relative mt-5 flex flex-wrap items-center gap-2.5 xl:mt-6', popover === 'filters' && 'z-40')}>
        <div className="relative min-w-[196px] flex-1 xl:max-w-[280px]">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#7F8CA3]" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar por cliente ou segmento"
            aria-label="Buscar por cliente ou segmento"
            className="mb-0 h-[42px] w-full rounded-[10px] border border-[#26314A] bg-[#0D1320] pl-9 pr-3 text-[13px] text-[#E8EDF7] outline-none transition-colors placeholder:text-[#5F6B80] focus:border-[#3D8EFF] focus:ring-2 focus:ring-[#3D8EFF]/20"
          />
        </div>

        <div className="relative">
          <button
            type="button"
            onClick={() => setPopover((current) => (current === 'filters' ? null : 'filters'))}
            className="flex h-[42px] items-center gap-2 rounded-[10px] border border-[#26314A] bg-[#0D1320] px-4 text-[13px] font-medium text-[#C9D3E3] transition-colors hover:border-[#3D8EFF]/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3D8EFF]"
          >
            <SlidersHorizontal size={15} />
            Filtros
          </button>
          {popover === 'filters' && (
            <>
              <button type="button" aria-label="Fechar filtros" onClick={() => setPopover(null)} className="fixed inset-0 z-30 cursor-default" />
              <div className="absolute left-0 top-[52px] z-40 w-[300px] rounded-xl border border-[#26314A] bg-[#0B1120] p-2 shadow-2xl">
                <p className="px-2 pb-1 pt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[#5F6B80]">Filtros rápidos</p>
                <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg px-2 py-2 text-[13px] text-[#C9D3E3] hover:bg-white/[0.04]">
                  <span className="flex items-center gap-2"><AlertTriangle size={14} className="text-[#FBBF24]" /> Somente com alerta</span>
                  <Toggle size="sm" label="Somente com alerta" checked={alertFilter === 'com'} onChange={(value) => setAlertFilter(value ? 'com' : '')} />
                </label>
                <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg px-2 py-2 text-[13px] text-[#C9D3E3] hover:bg-white/[0.04]">
                  <span className="flex items-center gap-2"><FileText size={14} className="text-[#3D8EFF]" /> Rotina pendente</span>
                  <Toggle size="sm" label="Rotina pendente" checked={weekPending} onChange={setWeekPending} />
                </label>
                <button
                  type="button"
                  onClick={clearFilters}
                  className="mt-1 w-full rounded-lg border border-[#26314A] px-3 py-2 text-[12px] font-semibold text-[#C9D3E3] hover:border-[#3D8EFF]/50 hover:text-white"
                >
                  Limpar filtros
                </button>
              </div>
            </>
          )}
        </div>

        <FilterSelect
          value={alertFilter}
          onChange={setAlertFilter}
          label="Todos alertas"
          options={[
            { value: '', label: 'Todos alertas' },
            { value: 'com', label: 'Com alerta' },
            { value: 'sem', label: 'Sem alerta' },
          ]}
        />
        <FilterSelect value={campaign} onChange={setCampaign} label="Todos estados" options={Object.entries(CAMPAIGN_LABEL).map(([value, label]) => ({ value, label }))} />
        <FilterSelect value={delivery} onChange={setDelivery} label="Todas entregas" options={Object.entries(DELIVERY_LABEL).map(([value, label]) => ({ value, label }))} />
        <FilterSelect
          value={editor}
          onChange={setEditor}
          label="Todos editores"
          options={[{ value: '', label: 'Todos editores' }, ...editors.map((name) => ({ value: name, label: name }))]}
        />

        <div className="ml-auto flex items-center gap-2.5">
          <div className="relative">
            <button
              type="button"
              onClick={() => setPopover((current) => (current === 'columns' ? null : 'columns'))}
              className="flex h-[42px] items-center gap-2 rounded-[10px] border border-[#26314A] bg-[#0D1320] px-4 text-[13px] font-medium text-[#C9D3E3] transition-colors hover:border-[#3D8EFF]/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3D8EFF]"
            >
              <ListFilter size={15} />
              Colunas
            </button>
            {popover === 'columns' && (
              <>
                <button type="button" aria-label="Fechar colunas" onClick={() => setPopover(null)} className="fixed inset-0 z-30 cursor-default" />
                <div className="absolute right-0 top-[52px] z-40 w-[250px] rounded-xl border border-[#26314A] bg-[#0B1120] p-2 shadow-2xl">
                  <p className="px-2 pb-1 pt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[#5F6B80]">Colunas visíveis</p>
                  {COLUMNS.map((column) => {
                    const checked = !hidden.includes(column.id)
                    return (
                      <label key={column.id} className="flex cursor-pointer items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-[12px] text-[#C9D3E3] hover:bg-white/[0.04]">
                        {column.label}
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setHidden((current) => (checked ? [...current, column.id] : current.filter((id) => id !== column.id)))
                          }
                          className="mb-0 h-3.5 w-3.5 accent-[#3D8EFF]"
                        />
                      </label>
                    )
                  })}
                </div>
              </>
            )}
          </div>

          <button
            type="button"
            onClick={exportCsv}
            className="flex h-[42px] items-center gap-2 rounded-[10px] border border-[#26314A] bg-[#0D1320] px-4 text-[13px] font-medium text-[#C9D3E3] transition-colors hover:border-[#3D8EFF]/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3D8EFF]"
          >
            <Download size={15} />
            <span className="hidden sm:inline">Exportar CSV</span>
          </button>
        </div>
      </div>

      <div className="mt-4 flex h-[46px] items-center gap-3 rounded-xl border border-[#1A2231] bg-[#0D1320] px-3.5 xl:mt-5">
        <ArrowLeftRight size={17} className="shrink-0 text-[#3D8EFF]" />
        <span className="hidden whitespace-nowrap text-[11px] font-bold uppercase tracking-[0.14em] text-[#8A97AC] sm:inline">
          Navegação horizontal:
        </span>
        <button
          type="button"
          onClick={() => scrollBy(-520)}
          className="flex h-[34px] items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-[13px] text-[#C9D3E3] hover:bg-white/[0.05] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3D8EFF]"
        >
          <ChevronLeft size={16} />
          Esquerda
        </button>
        <div className="relative h-[10px] min-w-[60px] flex-1 overflow-hidden rounded-full bg-[#1A2333]">
          <div
            className="absolute inset-y-0 rounded-full bg-[#3D8EFF]/70 transition-[left,width] duration-150"
            style={{ width: `${thumb * 100}%`, left: `${progress * (100 - thumb * 100)}%` }}
          />
        </div>
        <button
          type="button"
          onClick={() => scrollBy(520)}
          className="flex h-[34px] items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-[13px] text-[#C9D3E3] hover:bg-white/[0.05] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3D8EFF]"
        >
          Direita
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="mt-4 rounded-xl border border-[#1A2231]">
        <div className="sticky top-0 z-30 overflow-hidden rounded-t-xl border-b border-[#1A2231] bg-[#0D1320]">
          <div ref={headerRef} className="overflow-hidden">
            <table className="w-full table-fixed border-0 bg-transparent" style={{ width: tableWidth }} aria-label="Cabeçalhos da lista de clientes">
              <colgroup>
                {visibleColumns.map((id) => (
                  <col key={id} style={{ width: COLUMNS.find((column) => column.id === id)?.width }} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  {visibleColumns.map((id) => {
                    const column = COLUMNS.find((item) => item.id === id)!
                    const sticky = id === 'client'
                    const activeSort = sort?.key === column.sortKey
                    return (
                      <th
                        key={id}
                        scope="col"
                        draggable
                        onDragStart={() => setDragColumn(id)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={() => moveColumn(id)}
                        className={cn(
                          'group h-[52px] border-b border-[#1A2231] bg-[#0D1320] px-3 py-0 text-left align-middle',
                          sticky && 'sticky left-0 z-10 border-r border-r-[#141B28]',
                        )}
                      >
                        <div className="flex items-center gap-1.5">
                          <GripVertical size={12} className="shrink-0 cursor-grab text-[#3B4659] opacity-0 transition-opacity group-hover:opacity-100" />
                          <button
                            type="button"
                            onClick={() => toggleSort(column.sortKey)}
                            className="flex min-w-0 flex-1 items-center gap-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3D8EFF]"
                          >
                            <span className="text-[10px] font-bold uppercase leading-[1.25] tracking-[0.06em] text-[#8A97AC]">
                              {column.label}
                            </span>
                            {column.sortKey && (
                              <span className="shrink-0 text-[#5F6B80]">
                                {!activeSort ? (
                                  <ChevronsUpDown size={12} />
                                ) : sort?.dir === 'asc' ? (
                                  <ArrowUp size={12} className="text-[#3D8EFF]" />
                                ) : (
                                  <ArrowDown size={12} className="text-[#3D8EFF]" />
                                )}
                              </span>
                            )}
                          </button>
                        </div>
                      </th>
                    )
                  })}
                </tr>
              </thead>
            </table>
          </div>
        </div>

        <div ref={bodyRef} onScroll={syncScroll} className="hub-scrollbar overflow-x-auto rounded-b-xl bg-[#0D1320]">
          <table className="w-full table-fixed border-0 bg-transparent" style={{ width: tableWidth }} aria-label="Lista de clientes">
            <colgroup>
              {visibleColumns.map((id) => (
                <col key={id} style={{ width: COLUMNS.find((column) => column.id === id)?.width }} />
              ))}
            </colgroup>
            <tbody>
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={visibleColumns.length} className="h-[120px] px-6 text-center text-[13px] text-[#8A97AC]">
                    Nenhum cliente corresponde aos filtros.
                  </td>
                </tr>
              )}
              {sorted.map((client) => {
                const changeDays = daysSince(client.lastChange)
                return (
                  <tr key={client.id} className="group border-b border-[#1A2231] last:border-b-0 hover:bg-[#111A2B]">
                    {visibleColumns.map((id) => (
                      <td
                        key={id}
                        className={cn(
                          'h-[78px] px-3 py-0 align-middle text-[13px] text-[#D7DFEC]',
                          id === 'client' && 'sticky left-0 z-10 border-r border-r-[#141B28] bg-[#0D1320] group-hover:bg-[#111A2B]',
                        )}
                      >
                        {id === 'client' && <ClientCell client={client} onOpen={() => setLinksFor(client)} />}
                        {id === 'situation' && (
                          <PillSelect
                            value={client.situation}
                            onChange={(value) => update(client.id, { situation: value as Situation })}
                            options={Object.entries(SITUATION_LABEL).map(([value, label]) => ({ value, label }))}
                            className={SITUATION_PILL[client.situation]}
                          />
                        )}
                        {id === 'tags' && (
                          <TagsCell
                            tags={client.tags}
                            onRemove={(tagId) => update(client.id, { tags: client.tags.filter((tag) => tag.id !== tagId) })}
                            onAdd={() => setTagFor(client)}
                          />
                        )}
                        {id === 'spend' && (
                          <div className="min-w-0">
                            <p className="truncate text-[14px] font-semibold tabular-nums text-[#F1F5FC]">
                              {client.balance === null && client.spendMonth === 0 ? '—' : formatBRL(client.spendMonth)}
                            </p>
                            {client.balance !== null && (
                              <p className="mt-0.5 truncate text-[10px] text-[#7F8CA3]">Ontem: {formatBRL(client.spendYesterday)}</p>
                            )}
                          </div>
                        )}
                        {id === 'balance' && (
                          <div className="min-w-0">
                            {client.balance === null ? (
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-[13px] text-[#8A97AC]">Sem conta</span>
                                <button
                                  type="button"
                                  onClick={() => setToast('Vínculo de conta disponível na próxima fase.')}
                                  className="rounded-md border border-[#3D8EFF]/45 bg-[#3D8EFF]/5 px-2 py-0.5 text-[10px] font-semibold text-[#6EA8FF] hover:bg-[#3D8EFF]/15"
                                >
                                  Vincular conta
                                </button>
                              </div>
                            ) : client.balance < 0 ? (
                              <div>
                                <p className="truncate text-[14px] font-bold tabular-nums text-[#F87171]">Devedor {formatBRL(-client.balance)}</p>
                                <div className="mt-2 h-[5px] w-full rounded-full bg-[#1A2333]">
                                  <span className="block h-full w-[6%] rounded-full bg-[#F87171]" />
                                </div>
                              </div>
                            ) : (
                              <div>
                                <div className="flex items-baseline justify-between gap-2">
                                  <p className="truncate text-[14px] font-bold tabular-nums text-[#F1F5FC]">{formatBRL(client.balance)}</p>
                                  <span className={cn('shrink-0 text-[11px] tabular-nums', client.daysLeft !== null && client.daysLeft < 2 ? 'text-[#F87171]' : 'text-[#8A97AC]')}>
                                    {Math.max(0, Math.round(client.daysLeft ?? 0))}d
                                  </span>
                                </div>
                                <div className="mt-2 h-[5px] w-full overflow-hidden rounded-full bg-[#1A2333]">
                                  <span
                                    className={cn('block h-full rounded-full', client.daysLeft !== null && client.daysLeft < 2 ? 'bg-[#F87171]' : 'bg-[#3D8EFF]')}
                                    style={{ width: `${Math.min(100, Math.max(4, (client.daysLeft ?? 0) * 8))}%` }}
                                  />
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                        {id === 'termination' && <span className="tabular-nums text-[#D7DFEC]">{shortDate(client.termination)}</span>}
                        {id === 'lastChange' && (
                          <div>
                            {changeDays > 14 ? (
                              <span className="inline-flex items-center gap-1 rounded-md border border-[#FBBF24]/40 bg-[#FBBF24]/10 px-2 py-1 text-[10px] font-semibold text-[#FBBF24]">
                                <AlertTriangle size={11} /> {relativeLabel(client.lastChange)}
                              </span>
                            ) : changeDays <= 1 ? (
                              <span className="inline-flex items-center gap-1 rounded-md border border-[#3D8EFF]/45 bg-[#3D8EFF]/10 px-2 py-1 text-[10px] font-semibold text-[#6EA8FF]">
                                <Sparkles size={11} /> {relativeLabel(client.lastChange)}
                              </span>
                            ) : (
                              <span className="text-[12px] text-[#8A97AC]">{relativeLabel(client.lastChange)}</span>
                            )}
                          </div>
                        )}
                        {id === 'pix' && (
                          <div>
                            {client.pixPaidAt ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#34D399]">
                                <Check size={12} /> {relativeLabel(client.pixPaidAt)}
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setPixFor(client)}
                                className="text-[11px] font-medium text-[#8A97AC] transition-colors hover:text-[#E8EDF7]"
                              >
                                + Registrar Pix
                              </button>
                            )}
                          </div>
                        )}
                        {id === 'campaign' && (
                          <MiniSelect
                            value={client.campaignState}
                            onChange={(value) => update(client.id, { campaignState: value as MockClient['campaignState'] })}
                            options={Object.entries(CAMPAIGN_LABEL).map(([value, label]) => ({ value, label }))}
                            muted={client.campaignState === 'nao_definido'}
                          />
                        )}
                        {id === 'routine' && (
                          <div className="flex items-center gap-1.5">
                            {ROUTINES.map((item) => {
                              const done = client.routine.includes(item.key)
                              const noteAlert = item.key === 'note' && client.notePending
                              return (
                                <button
                                  key={item.key}
                                  type="button"
                                  title={`${item.label}${done ? ' — feito' : ' — pendente'}`}
                                  aria-label={`${item.label} de ${client.name}`}
                                  aria-pressed={done}
                                  onClick={() =>
                                    update(client.id, {
                                      routine: done ? client.routine.filter((key) => key !== item.key) : [...client.routine, item.key],
                                      notePending: item.key === 'note' ? false : client.notePending,
                                    })
                                  }
                                  className={cn(
                                    'relative flex h-[34px] w-[34px] items-center justify-center rounded-lg border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3D8EFF]',
                                    done
                                      ? 'border-[#3D8EFF] bg-[#3D8EFF] text-[#06101F]'
                                      : noteAlert
                                        ? 'border-[#F87171]/75 bg-[#F87171]/10 text-[#F87171]'
                                        : 'border-[#26314A] bg-[#0A0F1A] text-[#8A97AC] hover:border-[#3D8EFF]/60 hover:text-[#E8EDF7]',
                                  )}
                                >
                                  <item.Icon size={15} strokeWidth={1.8} />
                                  {noteAlert && <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-[#F87171]" />}
                                </button>
                              )
                            })}
                          </div>
                        )}
                        {id === 'creative' && (
                          <MiniSelect
                            value={client.creativeStatus}
                            onChange={(value) => update(client.id, { creativeStatus: value as MockClient['creativeStatus'] })}
                            options={Object.entries(CREATIVE_LABEL).map(([value, label]) => ({ value, label }))}
                            accent={client.creativeStatus !== 'nao_definido'}
                            muted={client.creativeStatus === 'nao_definido'}
                          />
                        )}
                        {id === 'delivery' && (
                          <div className="flex items-center gap-1">
                            <MiniSelect
                              value={client.deliveryState}
                              onChange={(value) => update(client.id, { deliveryState: value as MockClient['deliveryState'] })}
                              options={Object.entries(DELIVERY_LABEL).map(([value, label]) => ({ value, label }))}
                              className="w-[118px]"
                              muted={client.deliveryState === 'pendente'}
                            />
                            <EditorSelect
                              value={client.editor}
                              editors={editors}
                              onChange={(value) => update(client.id, { editor: value })}
                            />
                            <button
                              type="button"
                              onClick={() => setLinksFor(client)}
                              className="flex items-center gap-1 text-[11px] text-[#8A97AC] transition-colors hover:text-[#E8EDF7]"
                            >
                              <Link2 size={12} />
                              Links
                            </button>
                            <button
                              type="button"
                              onClick={() => copy(client.name, `Nome de ${client.name} copiado.`)}
                              aria-label={`Copiar nome de ${client.name}`}
                              className="rounded-md p-1 text-[#7F8CA3] transition-colors hover:bg-white/[0.05] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3D8EFF]"
                            >
                              <Copy size={13} />
                            </button>
                          </div>
                        )}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] text-[#5F6B80]">
        <span>
          {sorted.length} de {clients.length} clientes · dados fictícios de demonstração
        </span>
        <span className="flex items-center gap-1.5">
          <Info size={12} /> Role horizontalmente para ver todas as colunas
        </span>
      </div>

      {newClientOpen && (
        <NewClientModal
          onClose={() => setNewClientOpen(false)}
          onCreate={(client) => {
            setClients((current) => [client, ...current])
            setNewClientOpen(false)
            setToast('Cliente adicionado apenas nesta demonstração (sem persistência).')
          }}
        />
      )}

      {pixFor && (
        <PixModal
          client={pixFor}
          onClose={() => setPixFor(null)}
          onSave={(amount) => {
            update(pixFor.id, { pixPaidAt: new Date().toISOString(), pixAmount: amount })
            setPixFor(null)
            setToast(`Pix de ${formatBRL(amount)} registrado nesta demonstração.`)
          }}
        />
      )}

      {tagFor && (
        <TagsModal
          client={tagFor}
          allTags={tags}
          onClose={() => setTagFor(null)}
          onToggle={(tag) => {
            const has = tagFor.tags.some((item) => item.id === tag.id)
            update(tagFor.id, { tags: has ? tagFor.tags.filter((item) => item.id !== tag.id) : [...tagFor.tags, tag] })
            setTagFor({ ...tagFor, tags: has ? tagFor.tags.filter((item) => item.id !== tag.id) : [...tagFor.tags, tag] })
          }}
          onCreate={(name) => {
            const color = '#3D8EFF'
            const newTag: MockTag = { id: `tag-local-${Date.now()}`, name, color }
            setTags((current) => [...current, newTag])
            update(tagFor.id, { tags: [...tagFor.tags, newTag] })
            setTagFor({ ...tagFor, tags: [...tagFor.tags, newTag] })
          }}
        />
      )}

      {linksFor && (
        <LinksModal
          client={linksFor}
          onClose={() => setLinksFor(null)}
          onCopy={(label) => copy(`https://orvia.example/demo/${linksFor.id}/${label.toLowerCase()}`, 'Link fictício copiado.')}
        />
      )}

      <Toast message={toast} />
    </div>
  )
}

function csvValue(client: MockClient, id: ColumnId): string {
  switch (id) {
    case 'client':
      return client.name
    case 'situation':
      return SITUATION_LABEL[client.situation]
    case 'tags':
      return client.tags.map((tag) => tag.name).join(' | ')
    case 'spend':
      return client.spendMonth.toFixed(2).replace('.', ',')
    case 'balance':
      return client.balance === null ? 'Sem conta' : client.balance.toFixed(2).replace('.', ',')
    case 'termination':
      return client.termination ?? ''
    case 'lastChange':
      return relativeLabel(client.lastChange)
    case 'pix':
      return client.pixPaidAt ? relativeLabel(client.pixPaidAt) : 'Pendente'
    case 'campaign':
      return CAMPAIGN_LABEL[client.campaignState]
    case 'routine':
      return `${client.routine.length}/6`
    case 'creative':
      return CREATIVE_LABEL[client.creativeStatus]
    case 'delivery':
      return `${DELIVERY_LABEL[client.deliveryState]} / ${client.editor || 'Sem editor'}`
    default:
      return ''
  }
}

function KpiCard({ label, value, sub, icon }: { label: string; value: string; sub: string; icon: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-[#1E2738] bg-[#0D1320] p-6 md:p-7">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-bold uppercase tracking-[0.13em] text-[#8A97AC]">{label}</p>
        <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#1E2738] bg-[#080D18] text-[#3D8EFF]" aria-hidden="true">
          {icon}
        </span>
      </div>
      <p className="mt-3 text-[36px] font-extrabold leading-none tracking-[-0.045em] text-[#F1F5FC]">{value}</p>
      <p className="mt-2 text-[12px] text-[#7F8CA3]">{sub}</p>
    </section>
  )
}

function ClientCell({ client, onOpen }: { client: MockClient; onOpen: () => void }) {
  return (
    <div className="flex min-w-0 items-start gap-2">
      {client.alert && <span className="mt-[7px] h-[7px] w-[7px] shrink-0 rounded-full bg-[#F87171]" title="Pendência no cliente" />}
      <div className="min-w-0">
        <button
          type="button"
          onClick={onOpen}
          className="block max-w-full truncate text-left text-[15px] font-semibold text-[#F1F5FC] transition-colors hover:text-[#6EA8FF] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3D8EFF]"
          title="Abrir links do cliente"
        >
          {client.name}
        </button>
        {client.segment && <p className="mt-0.5 truncate text-[11px] text-[#8A97AC]">{client.segment}</p>}
      </div>
    </div>
  )
}

function TagsCell({ tags, onRemove, onAdd }: { tags: MockTag[]; onRemove: (tagId: string) => void; onAdd: () => void }) {
  return (
    <div className="flex min-w-0 flex-col items-start gap-1">
      <div className="flex max-w-full flex-wrap items-center gap-1">
        {tags.map((tag) => (
          <span
            key={tag.id}
            className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.04em]"
            style={{ borderColor: `${tag.color}66`, color: tag.color, background: `${tag.color}16` }}
          >
            {tag.name}
            <button
              type="button"
              onClick={() => onRemove(tag.id)}
              aria-label={`Remover tag ${tag.name}`}
              className="opacity-70 transition-opacity hover:opacity-100"
            >
              <X size={10} />
            </button>
          </span>
        ))}
      </div>
      <button
        type="button"
        onClick={onAdd}
        aria-label="Adicionar tag"
        className="flex h-[16px] w-[16px] items-center justify-center text-[#7F8CA3] transition-colors hover:text-[#E8EDF7]"
      >
        <Plus size={11} />
      </button>
    </div>
  )
}

function PillSelect({
  value,
  onChange,
  options,
  className,
}: {
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
  className?: string
}) {
  return (
    <div className="relative w-full max-w-[118px]">
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label="Situação do cliente"
        className={cn(
          'mb-0 h-[36px] w-full cursor-pointer appearance-none rounded-full border pl-4 pr-7 text-[11px] font-bold uppercase tracking-[0.08em] outline-none transition-colors focus:ring-2 focus:ring-[#3D8EFF]/40',
          className,
        )}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} className="bg-[#0B1120] text-[#E8EDF7]">
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown size={12} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 opacity-70" />
    </div>
  )
}

function MiniSelect({
  value,
  onChange,
  options,
  className,
  muted = false,
  accent = false,
}: {
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
  className?: string
  muted?: boolean
  accent?: boolean
}) {
  return (
    <div className={cn('relative w-full max-w-[148px]', className)}>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label="Selecionar"
        className={cn(
          'mb-0 h-[36px] w-full cursor-pointer appearance-none truncate rounded-lg border border-[#26314A] bg-[#0A0F1A] pl-2.5 pr-7 text-[11px] outline-none transition-colors focus:border-[#3D8EFF] focus:ring-2 focus:ring-[#3D8EFF]/20',
          muted ? 'text-[#8A97AC]' : accent ? 'text-[#6EA8FF]' : 'text-[#D7DFEC]',
        )}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} className="bg-[#0B1120] text-[#E8EDF7]">
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown size={12} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[#7F8CA3]" />
    </div>
  )
}

function EditorSelect({ value, editors, onChange }: { value: string; editors: string[]; onChange: (value: string) => void }) {
  const options = Array.from(new Set([...editors, value].filter(Boolean)))
  return (
    <div className="relative w-[76px] shrink-0">
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label="Editor responsável"
        className="mb-0 h-[32px] w-full cursor-pointer appearance-none rounded-full border border-[#D4AF37]/55 bg-[#D4AF37]/15 pl-2.5 pr-5 text-[11px] font-semibold text-[#E7C45A] outline-none focus:ring-2 focus:ring-[#D4AF37]/40"
      >
        <option value="" className="bg-[#0B1120] text-[#E8EDF7]">
          Editor…
        </option>
        {options.map((name) => (
          <option key={name} value={name} className="bg-[#0B1120] text-[#E8EDF7]">
            {name}
          </option>
        ))}
      </select>
      <ChevronDown size={11} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[#D4AF37]" />
    </div>
  )
}

function FilterSelect({
  value,
  onChange,
  label,
  options,
}: {
  value: string
  onChange: (value: string) => void
  label: string
  options: { value: string; label: string }[]
}) {
  return (
    <div className="relative min-w-[150px] flex-1 sm:flex-none">
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label}
        className={cn(
          'mb-0 h-[42px] w-full cursor-pointer appearance-none rounded-[10px] border border-[#26314A] bg-[#0D1320] pl-3.5 pr-8 text-[13px] outline-none transition-colors focus:border-[#3D8EFF] focus:ring-2 focus:ring-[#3D8EFF]/20 sm:w-[158px]',
          value ? 'text-[#E8EDF7]' : 'text-[#C9D3E3]',
        )}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#7F8CA3]" />
    </div>
  )
}

function NewClientModal({ onClose, onCreate }: { onClose: () => void; onCreate: (client: MockClient) => void }) {
  const [name, setName] = useState('')
  const [segment, setSegment] = useState('')
  const [situation, setSituation] = useState<Situation>('ativo')
  const canSave = name.trim().length > 0

  return (
    <Modal title="Novo cliente" description="Cadastro visual — não persiste dados nesta fase." onClose={onClose}>
      <div className="space-y-3">
        <div>
          <FieldLabel>Nome do cliente</FieldLabel>
          <TextInput value={name} onChange={setName} placeholder="Ex.: Padaria Modelo" autoFocus />
        </div>
        <div>
          <FieldLabel>Segmento</FieldLabel>
          <TextInput value={segment} onChange={setSegment} placeholder="Ex.: Padaria" />
        </div>
        <div>
          <FieldLabel>Situação inicial</FieldLabel>
          <TextSelect
            value={situation}
            onChange={(value) => setSituation(value as Situation)}
            options={Object.entries(SITUATION_LABEL).map(([value, label]) => ({ value, label }))}
          />
        </div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-lg border border-[#26314A] px-4 py-2 text-[12px] font-semibold text-[#C9D3E3] hover:text-white">
          Cancelar
        </button>
        <button
          type="button"
          disabled={!canSave}
          onClick={() => {
            if (!canSave) return
            onCreate({
              id: `cli-local-${Date.now()}`,
              name: name.trim(),
              segment: segment.trim(),
              situation,
              tags: [],
              spendMonth: 0,
              spendYesterday: 0,
              balance: null,
              daysLeft: null,
              termination: null,
              lastChange: new Date().toISOString(),
              alert: false,
              pixPaidAt: null,
              pixAmount: null,
              campaignState: 'nao_definido',
              routine: [],
              creativeStatus: 'nao_definido',
              deliveryState: 'pendente',
              editor: '',
              notePending: false,
            })
          }}
          className="rounded-lg bg-[#3D8EFF] px-4 py-2 text-[12px] font-bold text-[#06101F] transition-colors hover:bg-[#6EA8FF] disabled:cursor-not-allowed disabled:opacity-45"
        >
          Criar cliente
        </button>
      </div>
    </Modal>
  )
}

function PixModal({ client, onClose, onSave }: { client: MockClient; onClose: () => void; onSave: (amount: number) => void }) {
  const [amount, setAmount] = useState('')
  const numeric = Number(amount.replace(/\./g, '').replace(',', '.'))
  return (
    <Modal title="Registrar Pix" description={`${client.name} · apenas nesta demonstração`} onClose={onClose} width="max-w-sm">
      <FieldLabel>Valor (R$)</FieldLabel>
      <TextInput value={amount} onChange={setAmount} placeholder="2.400,00" autoFocus />
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-lg border border-[#26314A] px-4 py-2 text-[12px] font-semibold text-[#C9D3E3] hover:text-white">
          Cancelar
        </button>
        <button
          type="button"
          disabled={!Number.isFinite(numeric) || numeric <= 0}
          onClick={() => onSave(numeric)}
          className="rounded-lg bg-[#3D8EFF] px-4 py-2 text-[12px] font-bold text-[#06101F] hover:bg-[#6EA8FF] disabled:cursor-not-allowed disabled:opacity-45"
        >
          Registrar
        </button>
      </div>
    </Modal>
  )
}

function TagsModal({
  client,
  allTags,
  onClose,
  onToggle,
  onCreate,
}: {
  client: MockClient
  allTags: MockTag[]
  onClose: () => void
  onToggle: (tag: MockTag) => void
  onCreate: (name: string) => void
}) {
  const [name, setName] = useState('')
  return (
    <Modal title="Tags do cliente" description={`${client.name} · alterações locais`} onClose={onClose} width="max-w-sm">
      <div className="space-y-1">
        {allTags.map((tag) => {
          const checked = client.tags.some((item) => item.id === tag.id)
          return (
            <button
              key={tag.id}
              type="button"
              onClick={() => onToggle(tag)}
              className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2 text-left text-[13px] text-[#C9D3E3] hover:bg-white/[0.04]"
            >
              <span className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: tag.color }} />
                {tag.name}
              </span>
              {checked && <Check size={14} className="text-[#3D8EFF]" />}
            </button>
          )
        })}
      </div>
      <div className="mt-3 border-t border-[#1A2231] pt-3">
        <FieldLabel>Criar nova tag</FieldLabel>
        <div className="flex gap-2">
          <TextInput value={name} onChange={setName} placeholder="Ex.: Reels" />
          <button
            type="button"
            disabled={!name.trim()}
            onClick={() => {
              onCreate(name.trim())
              setName('')
            }}
            className="h-[42px] shrink-0 rounded-lg bg-[#3D8EFF] px-3 text-[12px] font-bold text-[#06101F] disabled:opacity-45"
          >
            Criar
          </button>
        </div>
      </div>
    </Modal>
  )
}

function LinksModal({ client, onClose, onCopy }: { client: MockClient; onClose: () => void; onCopy: (label: string) => void }) {
  const links = ['Cardápio', 'Relatório', 'Drive']
  return (
    <Modal title={`Links de ${client.name}`} description="Links fictícios usados apenas na demonstração visual." onClose={onClose} width="max-w-sm">
      <div className="space-y-2">
        {links.map((label) => (
          <div key={label} className="flex items-center justify-between gap-3 rounded-lg border border-[#1E2738] bg-[#080D18] px-3 py-2">
            <span className="flex items-center gap-2 text-[12px] text-[#C9D3E3]">
              <Link2 size={13} className="text-[#3D8EFF]" />
              {label}
            </span>
            <button type="button" onClick={() => onCopy(label)} className="flex items-center gap-1 text-[11px] font-semibold text-[#6EA8FF] hover:text-[#9CC4FF]">
              <Copy size={12} /> Copiar
            </button>
          </div>
        ))}
      </div>
    </Modal>
  )
}
