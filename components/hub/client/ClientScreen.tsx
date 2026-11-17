'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  ArrowDownRight,
  ArrowLeft,
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Clock,
  ExternalLink,
  Folder,
  ImageIcon,
  Layers,
  Loader2,
  MousePointerClick,
  Percent,
  RefreshCw,
  ShoppingCart,
  Sparkles,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import { syncMetaAction } from '@/app/a/[ws]/meta-actions'
import { clientMetricsAction, clientStatusAction, clientStructureAction, type MetricsResult, type StructureResult } from '@/app/a/[ws]/clientes/[id]/actions'
import type { DayPoint, Metrics, StructNode } from '@/lib/meta/insights'
import { clientHealth, HEALTH_COLOR, HEALTH_LABEL } from '@/lib/health'
import { formatBRL } from '@/lib/format'
import { cn, Toast } from '@/components/hub/ui'

export type ClientHeader = {
  id: string
  name: string
  status: string
  accounts: { id: string; name: string; status: string }[]
  balance: number | null
  daysLeft: number | null
  endsAt: string | null
  runsContinuously: boolean
  lastChange: string | null
  lastSynced: string | null
  spendMonth: number
  roasMonth: number | null
}

type Tab = 'metricas' | 'campanhas' | 'criativos'
type Preset = '7d' | '14d' | '30d' | 'custom'
type Period = { preset: Preset; since?: string; until?: string }

const TABS: { id: Tab; label: string; hint: string; Icon: typeof BarChart3 }[] = [
  { id: 'metricas', label: 'Métricas', hint: 'ROAS, faturamento, CPC, CTR…', Icon: BarChart3 },
  { id: 'campanhas', label: 'Campanhas', hint: 'Gerenciador: campanhas → conjuntos → anúncios', Icon: Folder },
  { id: 'criativos', label: 'Criativos', hint: 'Anúncios com prévia e resultado', Icon: Sparkles },
]

const PRESETS: { id: Preset; label: string }[] = [
  { id: '7d', label: 'Últimos 7 dias' },
  { id: '14d', label: 'Últimos 14 dias' },
  { id: '30d', label: 'Últimos 30 dias' },
  { id: 'custom', label: 'Personalizado' },
]

const LIVE_MS = 30_000

// ---------------------------------------------------------------------------
// formatação
// ---------------------------------------------------------------------------
const int = (v: number) => Math.round(v).toLocaleString('pt-BR')
const pct = (v: number) => `${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
const roasFmt = (v: number) => `${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x`
const br = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`
const rangeLabel = (r: { since: string; until: string }) => (r.since === r.until ? br(r.since) : `${br(r.since)} a ${br(r.until)}`)
const delta = (cur: number, prev: number) => (prev > 0 ? ((cur - prev) / prev) * 100 : cur > 0 ? null : 0)

function spToday(offset = 0) {
  const d = new Date(Date.now() + offset * 86_400_000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

function relative(iso: string | null) {
  if (!iso) return '—'
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days <= 0) return 'hoje'
  if (days === 1) return 'ontem'
  return `há ${days} dias`
}

function timeLabel(iso: string) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(iso))
}

// ---------------------------------------------------------------------------
// status da Meta
// ---------------------------------------------------------------------------
const STATUS_TEXT: Record<string, string> = {
  ACTIVE: 'Ativo',
  PAUSED: 'Pausado',
  CAMPAIGN_PAUSED: 'Campanha pausada',
  ADSET_PAUSED: 'Conjunto pausado',
  IN_PROCESS: 'Processando',
  PENDING_REVIEW: 'Em análise',
  PREAPPROVED: 'Pré-aprovado',
  DISAPPROVED: 'Reprovado',
  WITH_ISSUES: 'Com problema',
  PENDING_BILLING_INFO: 'Pagamento pendente',
  ARCHIVED: 'Arquivado',
  DELETED: 'Excluído',
}
const isActive = (s: string) => s === 'ACTIVE'
const statusColor = (s: string) => (isActive(s) ? '#34D399' : s === 'PENDING_REVIEW' || s === 'IN_PROCESS' || s === 'PREAPPROVED' ? '#FBBF24' : '#FF3B47')

function LiveDot({ status, title }: { status: string; title?: string }) {
  return (
    <span className="uc-live-dot" style={{ color: statusColor(status) }} title={title ?? STATUS_TEXT[status] ?? status} aria-hidden="true">
      <i />
      <i />
    </span>
  )
}

function StatusPill({ status }: { status: string }) {
  const color = statusColor(status)
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] font-semibold"
      style={{ borderColor: `${color}55`, background: `${color}14`, color }}
    >
      <LiveDot status={status} />
      {STATUS_TEXT[status] ?? status}
    </span>
  )
}

// ---------------------------------------------------------------------------
// tela
// ---------------------------------------------------------------------------
export function ClientScreen({ ws, header, canSync, initialTab }: { ws: string; header: ClientHeader; canSync: boolean; initialTab: Tab }) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>(initialTab)
  const [period, setPeriod] = useState<Period>({ preset: '7d' })
  const [customSince, setCustomSince] = useState(spToday(-14))
  const [customUntil, setCustomUntil] = useState(spToday(-1))
  const [syncing, setSyncing] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  const [metrics, setMetrics] = useState<MetricsResult | null>(null)
  const [structure, setStructure] = useState<StructureResult | null>(null)
  const [loadingMetrics, setLoadingMetrics] = useState(false)
  const [loadingStructure, setLoadingStructure] = useState(false)

  const periodKey = JSON.stringify(period)
  const hasAccounts = header.accounts.length > 0

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(t)
  }, [toast])

  // Troca de aba reflete na URL (link direto para Campanhas/Criativos).
  useEffect(() => {
    const url = new URL(window.location.href)
    if (tab === 'metricas') url.searchParams.delete('tab')
    else url.searchParams.set('tab', tab)
    window.history.replaceState(null, '', url.toString())
  }, [tab])

  // Métricas: recarrega ao mudar o período.
  useEffect(() => {
    if (!hasAccounts || tab !== 'metricas') return
    let alive = true
    setLoadingMetrics(true)
    clientMetricsAction(ws, header.id, period).then((res) => {
      if (!alive) return
      setMetrics(res)
      setLoadingMetrics(false)
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws, header.id, periodKey, tab, hasAccounts, nonce])

  // Estrutura (campanhas + criativos): uma leitura por período.
  const loadStructure = useCallback(() => {
    if (!hasAccounts) return () => undefined
    let alive = true
    setLoadingStructure(true)
    clientStructureAction(ws, header.id, period).then((res) => {
      if (!alive) return
      setStructure(res)
      setLoadingStructure(false)
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws, header.id, periodKey, hasAccounts, nonce])

  useEffect(() => {
    if (tab === 'metricas') return
    return loadStructure()
  }, [tab, loadStructure])

  const health = clientHealth({ accountsCount: header.accounts.length, balance: header.balance, daysLeft: header.daysLeft, termination: header.endsAt })

  const runSync = async () => {
    setSyncing(true)
    const res = await syncMetaAction(ws)
    setSyncing(false)
    if (!res.ok) return setToast(res.error)
    setToast(`${res.total} conta(s) sincronizada(s)${res.created ? ` · ${res.created} nova(s)` : ''}.`)
    router.refresh()
    setMetrics(null)
    setStructure(null)
    setNonce((v) => v + 1)
  }

  const applyCustom = () => {
    if (!customSince || !customUntil || customSince > customUntil) return setToast('Escolha um início anterior ou igual ao fim.')
    setPeriod({ preset: 'custom', since: customSince, until: customUntil })
  }

  const adsManager = header.accounts[0] ? `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${header.accounts[0].id.replace(/^act_/, '')}` : null

  return (
    <div className="mx-auto w-full max-w-[1720px] px-4 pb-12 pt-5 sm:px-6 md:px-[30px] md:pt-[26px]">
      {/* ----- topo ----- */}
      <Link href={`/a/${ws}/visao-geral`} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#8E8A86] no-underline hover:text-white hover:no-underline">
        <ArrowLeft size={14} /> Visão geral
      </Link>

      <section className="uc-cut relative mt-3 overflow-hidden rounded-[10px] border border-[#222225] bg-[#111113] p-5 md:p-7" style={{ ['--cut' as string]: '22px' }}>
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[2px]" style={{ background: `linear-gradient(90deg, ${HEALTH_COLOR[health.health]}, transparent 70%)` }} />
        <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="uc-title truncate text-[30px] leading-none text-[#F7F5F1] md:text-[42px]">{header.name}</h1>
              <span
                className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-[0.08em]"
                style={{ borderColor: `${HEALTH_COLOR[health.health]}66`, color: HEALTH_COLOR[health.health], background: `${HEALTH_COLOR[health.health]}14` }}
                title={health.reason}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: HEALTH_COLOR[health.health], boxShadow: `0 0 10px ${HEALTH_COLOR[health.health]}` }} />
                {HEALTH_LABEL[health.health]}
              </span>
            </div>
            <p className="mt-2 text-[12px] text-[#8E8A86]">
              {health.reason} · {header.accounts.length} conta(s) de anúncio
              {header.lastSynced && <> · sincronizado {relative(header.lastSynced)}</>}
            </p>
          </div>

          <div className="flex flex-wrap items-stretch gap-2">
            <InfoChip
              Icon={Wallet}
              label={header.balance !== null && header.balance < 0 ? 'Saldo devedor' : 'Saldo'}
              value={header.balance === null ? '—' : header.balance < 0 ? formatBRL(-header.balance) : formatBRL(header.balance)}
              sub={header.daysLeft !== null && header.daysLeft >= 0 ? `~${Math.round(header.daysLeft)} dias` : undefined}
              danger={header.balance !== null && (header.balance < 0 || (header.daysLeft !== null && header.daysLeft <= 3))}
            />
            <InfoChip
              Icon={CalendarDays}
              label="Término"
              value={header.endsAt ? br(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(header.endsAt))) : header.runsContinuously ? 'Contínuo' : '—'}
            />
            <InfoChip Icon={Clock} label="Última alteração" value={relative(header.lastChange)} />
            {adsManager && (
              <a
                href={adsManager}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-[8px] border border-[#2A2A2E] bg-[#0B0B0C] px-4 text-[12px] font-semibold text-[#DAD6CF] no-underline hover:border-[#D7141F]/50 hover:text-white hover:no-underline"
              >
                <ExternalLink size={14} /> Gerenciador
              </a>
            )}
            {canSync && (
              <button
                type="button"
                onClick={runSync}
                disabled={syncing}
                className="inline-flex items-center gap-2 rounded-[8px] bg-[#D7141F] px-4 py-2.5 text-[12px] font-bold uppercase tracking-[0.06em] text-white shadow-[0_0_28px_-8px_rgba(215,20,31,0.9)] transition hover:bg-[#F0333D] disabled:opacity-60"
              >
                <RefreshCw size={14} className={cn(syncing && 'animate-spin')} /> {syncing ? 'Sincronizando…' : 'Sincronizar'}
              </button>
            )}
          </div>
        </div>
      </section>

      {/* ----- menu lateral + conteúdo ----- */}
      <div className="mt-5 grid gap-5 lg:grid-cols-[230px_minmax(0,1fr)]">
        <nav aria-label="Seções do cliente" className="lg:sticky lg:top-[88px] lg:self-start">
          <div role="tablist" className="flex gap-1.5 overflow-x-auto rounded-[10px] border border-[#222225] bg-[#0E0E10] p-1.5 lg:flex-col">
            {TABS.map(({ id, label, hint, Icon }) => {
              const active = tab === id
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(id)}
                  className={cn(
                    'group relative flex min-w-[150px] items-start gap-3 rounded-[8px] px-3 py-2.5 text-left transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D7141F] lg:min-w-0',
                    active ? 'bg-[#D7141F]/12 text-white shadow-[inset_2px_0_0_#D7141F]' : 'text-[#9F9A94] hover:bg-white/[0.03] hover:text-white',
                  )}
                >
                  <Icon size={16} className={cn('mt-0.5 shrink-0', active ? 'text-[#F0333D]' : 'text-[#6E6A66] group-hover:text-[#CFCBC4]')} />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-semibold">{label}</span>
                    <span className="hidden truncate text-[10px] text-[#6E6A66] lg:block">{hint}</span>
                  </span>
                </button>
              )
            })}
          </div>
          <p className="mt-3 hidden px-1 font-mono text-[9px] uppercase tracking-[0.16em] text-[#55524F] lg:block">Dados ao vivo da Meta</p>
        </nav>

        <div className="min-w-0">
          {/* período */}
          <div className="flex flex-col gap-3 rounded-[10px] border border-[#222225] bg-[#111113] p-3 md:flex-row md:items-center md:justify-between">
            <p className="flex items-center gap-2 px-1 text-[13px] font-semibold text-[#ECE9E3]">
              <CalendarDays size={15} className="text-[#D7141F]" /> Período de análise
              {metrics?.ok && tab === 'metricas' && <span className="font-mono text-[11px] font-normal text-[#F0333D]">{rangeLabel(metrics.range)}</span>}
              {structure?.ok && tab !== 'metricas' && <span className="font-mono text-[11px] font-normal text-[#F0333D]">{rangeLabel(structure.range)}</span>}
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              {PRESETS.map((p) => {
                const active = period.preset === p.id || (p.id === 'custom' && period.preset === 'custom')
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => (p.id === 'custom' ? applyCustom() : setPeriod({ preset: p.id }))}
                    className={cn(
                      'rounded-[7px] border px-3 py-1.5 text-[12px] font-semibold transition',
                      active ? 'border-[#D7141F] bg-[#D7141F]/15 text-white' : 'border-[#2A2A2E] bg-[#0B0B0C] text-[#AFAAA3] hover:border-[#D7141F]/50 hover:text-white',
                    )}
                  >
                    {p.label}
                  </button>
                )
              })}
              <span className="flex items-center gap-1 rounded-[7px] border border-[#2A2A2E] bg-[#0B0B0C] px-2 py-1">
                <input aria-label="Data inicial do período" type="date" value={customSince} max={spToday(0)} onChange={(e) => setCustomSince(e.target.value)} className="mb-0 h-7 w-[124px] border-0 bg-transparent p-0 font-mono text-[11px] text-[#ECE9E3] [color-scheme:dark] focus:ring-0" />
                <span className="text-[#6E6A66]">→</span>
                <input aria-label="Data final do período" type="date" value={customUntil} max={spToday(0)} onChange={(e) => setCustomUntil(e.target.value)} className="mb-0 h-7 w-[124px] border-0 bg-transparent p-0 font-mono text-[11px] text-[#ECE9E3] [color-scheme:dark] focus:ring-0" />
              </span>
            </div>
          </div>

          {!hasAccounts ? (
            <EmptyState ws={ws} />
          ) : tab === 'metricas' ? (
            <MetricsPanel result={metrics} loading={loadingMetrics} />
          ) : tab === 'campanhas' ? (
            <CampaignsPanel ws={ws} clientId={header.id} result={structure} loading={loadingStructure} onReload={loadStructure} />
          ) : (
            <CreativesPanel result={structure} loading={loadingStructure} />
          )}
        </div>
      </div>

      <Toast message={toast} />
    </div>
  )
}

function InfoChip({ Icon, label, value, sub, danger }: { Icon: typeof Wallet; label: string; value: string; sub?: string; danger?: boolean }) {
  return (
    <div className={cn('flex items-center gap-3 rounded-[8px] border px-3.5 py-2', danger ? 'border-[#FF3B47]/45 bg-[#FF3B47]/[0.07]' : 'border-[#222225] bg-[#0B0B0C]')}>
      <span className={cn('flex h-8 w-8 items-center justify-center rounded-[6px] border', danger ? 'border-[#FF3B47]/40 text-[#FF3B47]' : 'border-[#2A2A2E] text-[#8E8A86]')}>
        <Icon size={15} />
      </span>
      <span>
        <span className="block font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-[#8E8A86]">{label}</span>
        <span className={cn('block text-[13px] font-bold tabular-nums', danger ? 'text-[#FF6B73]' : 'text-[#F7F5F1]')}>
          {value}
          {sub && <span className="ml-1.5 text-[11px] font-medium text-[#8E8A86]">{sub}</span>}
        </span>
      </span>
    </div>
  )
}

function EmptyState({ ws }: { ws: string }) {
  return (
    <div className="mt-4 rounded-[10px] border border-dashed border-[#2A2A2E] bg-[#0E0E10] p-10 text-center">
      <p className="text-[14px] font-semibold text-[#ECE9E3]">Nenhuma conta de anúncio vinculada a este cliente.</p>
      <p className="mt-1 text-[12px] text-[#8E8A86]">Vincule uma conta para ver métricas, campanhas e criativos reais.</p>
      <Link href={`/a/${ws}/contas`} className="mt-4 inline-flex items-center gap-2 rounded-[8px] bg-[#D7141F] px-4 py-2 text-[12px] font-bold text-white no-underline hover:bg-[#F0333D] hover:no-underline">
        Vincular conta
      </Link>
    </div>
  )
}

function Loading({ label }: { label: string }) {
  return (
    <div className="mt-4 flex items-center justify-center gap-2 rounded-[10px] border border-[#222225] bg-[#111113] p-10 text-[13px] text-[#8E8A86]">
      <Loader2 size={16} className="animate-spin text-[#D7141F]" /> {label}
    </div>
  )
}

function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="mt-4 rounded-[10px] border border-[#FF3B47]/40 bg-[#FF3B47]/[0.06] p-5 text-[13px] text-[#FFB3B8]">
      {message}
      {onRetry && (
        <button type="button" onClick={onRetry} className="ml-3 font-semibold text-white underline">
          Tentar de novo
        </button>
      )}
    </div>
  )
}

function Warnings({ list }: { list: string[] }) {
  if (!list.length) return null
  return (
    <ul className="mt-3 space-y-1 rounded-[8px] border border-[#FBBF24]/30 bg-[#FBBF24]/[0.05] px-4 py-2.5 text-[11px] text-[#E8CF8A]">
      {list.map((w) => (
        <li key={w}>{w}</li>
      ))}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// Métricas
// ---------------------------------------------------------------------------
function Delta({ cur, prev, invert = false }: { cur: number; prev: number; invert?: boolean }) {
  const d = delta(cur, prev)
  if (d === null) return <span className="rounded-[5px] border border-[#2A2A2E] px-1.5 py-0.5 font-mono text-[10px] text-[#8E8A86]">novo</span>
  if (Math.abs(d) < 0.05) return <span className="rounded-[5px] border border-[#2A2A2E] px-1.5 py-0.5 font-mono text-[10px] text-[#8E8A86]">0%</span>
  const good = invert ? d < 0 : d > 0
  const Icon = d > 0 ? ArrowUpRight : ArrowDownRight
  return (
    <span
      className={cn('inline-flex items-center gap-0.5 rounded-[5px] border px-1.5 py-0.5 font-mono text-[10px] font-bold', good ? 'border-[#34D399]/35 bg-[#34D399]/10 text-[#34D399]' : 'border-[#FF3B47]/35 bg-[#FF3B47]/10 text-[#FF6B73]')}
      title="Comparado ao período anterior de mesmo tamanho"
    >
      <Icon size={11} />
      {Math.abs(d).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%
    </span>
  )
}

function MetricsPanel({ result, loading }: { result: MetricsResult | null; loading: boolean }) {
  if (loading || !result) return <Loading label="Buscando métricas na Meta…" />
  if (!result.ok) return <ErrorBox message={result.error} />
  const c = result.current
  const p = result.previous
  const roasTone = c.roas >= 3 ? '#34D399' : c.roas >= 1 ? '#FBBF24' : c.spend > 0 ? '#FF3B47' : '#8E8A86'

  const cards: { label: string; value: string; Icon: typeof Wallet; cur: number; prev: number; invert?: boolean }[] = [
    { label: 'CPC (link)', value: formatBRL(c.cpc), Icon: MousePointerClick, cur: c.cpc, prev: p.cpc, invert: true },
    { label: 'Adições ao carrinho', value: int(c.addToCart), Icon: ShoppingCart, cur: c.addToCart, prev: p.addToCart },
    { label: 'Cliques no link', value: int(c.linkClicks), Icon: MousePointerClick, cur: c.linkClicks, prev: p.linkClicks },
    { label: 'CTR (link)', value: pct(c.ctr), Icon: Percent, cur: c.ctr, prev: p.ctr },
    { label: 'Compras', value: int(c.purchases), Icon: ShoppingCart, cur: c.purchases, prev: p.purchases },
    { label: 'Custo por compra', value: c.purchases ? formatBRL(c.costPerPurchase) : '—', Icon: Wallet, cur: c.costPerPurchase, prev: p.costPerPurchase, invert: true },
    { label: 'CPM', value: formatBRL(c.cpm), Icon: BarChart3, cur: c.cpm, prev: p.cpm, invert: true },
    { label: 'Alcance', value: int(c.reach), Icon: TrendingUp, cur: c.reach, prev: p.reach },
  ]

  return (
    <div className="uc-fade-up">
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <HeroCard label="ROAS" value={roasFmt(c.roas)} tone={roasTone} delta={<Delta cur={c.roas} prev={p.roas} />} sub="Faturamento ÷ investimento" />
        <HeroCard label="Faturamento" value={formatBRL(c.revenue)} tone="#F7F5F1" delta={<Delta cur={c.revenue} prev={p.revenue} />} sub={`${int(c.purchases)} compra(s) no período`} />
        <HeroCard label="Total investido" value={formatBRL(c.spend)} tone="#F7F5F1" accent delta={<Delta cur={c.spend} prev={p.spend} />} sub={`Anterior: ${formatBRL(p.spend)} (${rangeLabel(result.prev)})`} />
      </div>

      <p className="mt-6 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-[#8E8A86]">Métricas de entrega e conversão</p>
      <div className="mt-2 grid grid-cols-2 gap-3 md:grid-cols-4">
        {cards.map((k) => (
          <div key={k.label} className="rounded-[8px] border border-[#222225] bg-[#111113] p-4 transition hover:border-[#D7141F]/35">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-[#8E8A86]">{k.label}</span>
              <k.Icon size={13} className="text-[#D7141F]" />
            </div>
            <p className="mt-2 text-[20px] font-bold tabular-nums text-[#F7F5F1]">{k.value}</p>
            <div className="mt-1.5">
              <Delta cur={k.cur} prev={k.prev} invert={k.invert} />
            </div>
          </div>
        ))}
      </div>

      <DailyChart days={result.days} />
      <Warnings list={result.warnings} />
    </div>
  )
}

function HeroCard({ label, value, tone, sub, delta: d, accent }: { label: string; value: string; tone: string; sub: string; delta: ReactNode; accent?: boolean }) {
  return (
    <div className={cn('uc-cut relative overflow-hidden rounded-[10px] border p-5', accent ? 'border-[#D7141F]/45 bg-[linear-gradient(135deg,rgba(215,20,31,0.16),#111113_60%)]' : 'border-[#222225] bg-[#111113]')} style={{ ['--cut' as string]: '14px' }}>
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-[#8E8A86]">{label}</span>
        {d}
      </div>
      <p className="font-display mt-3 text-[40px] leading-none tracking-[0.01em] tabular-nums" style={{ color: tone }}>
        {value}
      </p>
      <p className="mt-2 text-[11px] text-[#86827D]">{sub}</p>
    </div>
  )
}

function DailyChart({ days }: { days: DayPoint[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const W = 900
  const H = 220
  const pad = { l: 56, r: 12, t: 14, b: 26 }
  const max = Math.max(1, ...days.map((d) => Math.max(d.spend, d.revenue)))
  const x = (i: number) => pad.l + (days.length <= 1 ? 0 : (i / (days.length - 1)) * (W - pad.l - pad.r))
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b)
  const line = (key: 'spend' | 'revenue') => days.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join(' ')
  const area = `${line('spend')} L${x(days.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`
  const ticks = [0, 0.5, 1].map((f) => max * f)
  const step = Math.max(1, Math.ceil(days.length / 10))
  const totalSpend = days.reduce((t, d) => t + d.spend, 0)
  const h = hover !== null ? days[hover] : null

  return (
    <section className="mt-5 rounded-[10px] border border-[#222225] bg-[#111113] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-bold text-[#F7F5F1]">Investimento × faturamento por dia</h2>
          <p className="text-[11px] text-[#8E8A86]">Passe o mouse no gráfico para ver o dia.</p>
        </div>
        <div className="flex items-center gap-4 text-[11px]">
          <span className="flex items-center gap-1.5 text-[#CFCBC4]">
            <span className="h-2 w-4 rounded-sm bg-[#D7141F]" /> Investido
          </span>
          <span className="flex items-center gap-1.5 text-[#CFCBC4]">
            <span className="h-[2px] w-4 bg-[#34D399]" /> Faturamento
          </span>
          <span className="font-mono font-bold text-[#F0333D]">Total: {formatBRL(totalSpend)}</span>
        </div>
      </div>
      <div className="relative mt-3">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-[220px] w-full" preserveAspectRatio="none" onMouseLeave={() => setHover(null)} role="img" aria-label="Gráfico diário de investimento e faturamento">
          <defs>
            <linearGradient id="uc-spend" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#D7141F" stopOpacity="0.45" />
              <stop offset="100%" stopColor="#D7141F" stopOpacity="0" />
            </linearGradient>
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="#222225" strokeDasharray="3 4" />
              <text x={pad.l - 8} y={y(t) + 3} textAnchor="end" fontSize="10" fill="#6E6A66" fontFamily="monospace">
                {t >= 1000 ? `${(t / 1000).toFixed(1)}k` : Math.round(t)}
              </text>
            </g>
          ))}
          {days.length > 0 && (
            <>
              <path d={area} fill="url(#uc-spend)" />
              <path d={line('spend')} fill="none" stroke="#D7141F" strokeWidth="2" vectorEffect="non-scaling-stroke" />
              <path d={line('revenue')} fill="none" stroke="#34D399" strokeWidth="2" strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />
            </>
          )}
          {days.map((d, i) =>
            i % step === 0 || i === days.length - 1 ? (
              <text key={d.date} x={x(i)} y={H - 6} textAnchor="middle" fontSize="10" fill="#6E6A66" fontFamily="monospace">
                {br(d.date)}
              </text>
            ) : null,
          )}
          {days.map((d, i) => (
            <rect key={`h${d.date}`} x={x(i) - (W - pad.l - pad.r) / Math.max(1, days.length) / 2} y={pad.t} width={(W - pad.l - pad.r) / Math.max(1, days.length)} height={H - pad.t - pad.b} fill="transparent" onMouseEnter={() => setHover(i)} />
          ))}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} stroke="#F0333D" strokeOpacity="0.5" />}
        </svg>
        {h && (
          <div className="pointer-events-none absolute top-2 rounded-[8px] border border-[#2A2A2E] bg-[#0B0B0C]/95 px-3 py-2 text-[11px] shadow-xl" style={{ left: `${Math.min(80, (x(hover!) / W) * 100)}%` }}>
            <p className="font-mono font-bold text-[#F7F5F1]">{br(h.date)}</p>
            <p className="text-[#F0333D]">Investido {formatBRL(h.spend)}</p>
            <p className="text-[#34D399]">Faturamento {formatBRL(h.revenue)}</p>
            <p className="text-[#AFAAA3]">
              {int(h.linkClicks)} cliques · {int(h.purchases)} compras
            </p>
          </div>
        )}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Campanhas (gerenciador)
// ---------------------------------------------------------------------------
type Filter = 'ativos' | 'pausados' | 'todos'
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'ativos', label: 'Ativas' },
  { id: 'pausados', label: 'Desativadas' },
  { id: 'todos', label: 'Todas' },
]
const passes = (f: Filter, s: string) => f === 'todos' || (f === 'ativos' ? isActive(s) : !isActive(s))

function useLiveStatuses(ws: string, clientId: string, enabled: boolean) {
  const [statuses, setStatuses] = useState<Record<string, string>>({})
  const [at, setAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!enabled) return
    let alive = true
    const tick = async () => {
      if (document.visibilityState !== 'visible') return
      const res = await clientStatusAction(ws, clientId)
      if (!alive) return
      if (res.ok) {
        setStatuses(res.statuses)
        setAt(res.at)
        setError(null)
      } else setError(res.error)
    }
    const timer = setInterval(tick, LIVE_MS)
    const onVisible = () => document.visibilityState === 'visible' && tick()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [ws, clientId, enabled])
  return { statuses, at, error }
}

function CampaignsPanel({ ws, clientId, result, loading, onReload }: { ws: string; clientId: string; result: StructureResult | null; loading: boolean; onReload: () => void }) {
  const [filter, setFilter] = useState<Filter>('ativos')
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const live = useLiveStatuses(ws, clientId, !!result?.ok)

  if (loading || !result) return <Loading label="Abrindo o gerenciador de anúncios…" />
  if (!result.ok) return <ErrorBox message={result.error} onRetry={onReload} />

  const st = (n: StructNode) => live.statuses[n.id] ?? n.status
  const campaigns = result.campaigns.filter((c) => passes(filter, st(c)))
  const activeCount = result.campaigns.filter((c) => isActive(st(c))).length
  const toggle = (id: string) => setOpen((o) => ({ ...o, [id]: !o[id] }))

  return (
    <div className="uc-fade-up">
      <div className="mt-4 flex flex-col gap-3 rounded-[10px] border border-[#222225] bg-[#111113] p-3 md:flex-row md:items-center md:justify-between">
        <p className="flex items-center gap-2 px-1 text-[13px] font-semibold text-[#ECE9E3]">
          <Folder size={15} className="text-[#D7141F]" /> Gerenciador de anúncios
          <span className="font-mono text-[11px] font-normal text-[#8E8A86]">
            {activeCount} ativa(s) de {result.campaigns.length}
          </span>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-2 rounded-full border border-[#34D399]/30 bg-[#34D399]/[0.06] px-3 py-1 text-[11px] text-[#9FE6C6]" title="Status consultado na Meta a cada 30 segundos">
            <LiveDot status="ACTIVE" title="Ao vivo" /> Ao vivo{live.at ? ` · ${timeLabel(live.at)}` : ''}
          </span>
          <div role="radiogroup" aria-label="Filtrar por status" className="flex rounded-[8px] border border-[#2A2A2E] bg-[#0B0B0C] p-0.5">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                role="radio"
                aria-checked={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={cn('rounded-[6px] px-3 py-1 text-[12px] font-semibold transition', filter === f.id ? 'bg-[#D7141F] text-white' : 'text-[#AFAAA3] hover:text-white')}
              >
                {f.label}
              </button>
            ))}
          </div>
          <button type="button" onClick={onReload} className="inline-flex items-center gap-1.5 rounded-[8px] border border-[#2A2A2E] px-3 py-1.5 text-[12px] font-semibold text-[#CFCBC4] hover:border-[#D7141F]/50 hover:text-white">
            <RefreshCw size={13} /> Atualizar métricas
          </button>
        </div>
      </div>
      {live.error && <Warnings list={[`Status ao vivo: ${live.error}`]} />}

      <div className="hub-scrollbar mt-3 overflow-x-auto rounded-[10px] border border-[#222225] bg-[#111113]">
        <table className="w-full min-w-[1100px] border-0 bg-transparent text-left">
          <thead>
            <tr className="border-b border-[#222225]">
              {['Estrutura / nome', 'Status', 'Orçamento', 'Gasto', 'Faturamento', 'ROAS', 'Compras', 'Carrinho', 'Cliques', 'CPC', 'CTR'].map((h, i) => (
                <th key={h} className={cn('h-11 bg-[#0E0E10] px-3 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-[#8E8A86]', i >= 2 && 'text-right')}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {campaigns.length === 0 && (
              <tr>
                <td colSpan={11} className="h-24 text-center text-[13px] text-[#8E8A86]">
                  Nenhuma campanha {filter === 'ativos' ? 'ativa' : filter === 'pausados' ? 'desativada' : ''} nesta conta.
                </td>
              </tr>
            )}
            {campaigns.map((c) => (
              <Fragment key={c.id}>
                <Row node={c} depth={0} status={st(c)} open={!!open[c.id]} onToggle={() => toggle(c.id)} />
                {open[c.id] &&
                  (c.children ?? [])
                    .filter((s) => passes(filter, st(s)) || filter === 'pausados')
                    .map((s) => (
                      <Fragment key={s.id}>
                        <Row node={s} depth={1} status={st(s)} open={!!open[s.id]} onToggle={() => toggle(s.id)} />
                        {open[s.id] && (s.children ?? []).map((a) => <Row key={a.id} node={a} depth={2} status={st(a)} />)}
                      </Fragment>
                    ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <Warnings list={result.warnings} />
    </div>
  )
}

function Row({ node, depth, status, open, onToggle }: { node: StructNode; depth: number; status: string; open?: boolean; onToggle?: () => void }) {
  const m = node.metrics
  const kids = node.children?.length ?? 0
  const LevelIcon = node.level === 'campaign' ? Folder : node.level === 'adset' ? Layers : ImageIcon
  const roasTone = m.roas >= 3 ? 'text-[#34D399]' : m.roas >= 1 ? 'text-[#FBBF24]' : m.spend > 0 ? 'text-[#FF6B73]' : 'text-[#6E6A66]'
  const dash = <span className="text-[#55524F]">—</span>
  return (
    <tr className={cn('border-b border-[#1C1C1F] transition-colors hover:bg-[#151517]', depth === 0 ? 'bg-[#111113]' : depth === 1 ? 'bg-[#0F0F11]' : 'bg-[#0C0C0E]')}>
      <td className="h-[52px] px-3">
        <div className="flex min-w-0 items-center gap-2" style={{ paddingLeft: depth * 22 }}>
          {node.level !== 'ad' ? (
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={open}
              aria-label={`${open ? 'Recolher' : 'Expandir'} ${node.name}`}
              className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-[5px] border transition', open ? 'border-[#D7141F]/60 bg-[#D7141F]/15 text-white' : 'border-[#2A2A2E] text-[#8E8A86] hover:text-white')}
            >
              {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          ) : node.thumbnail ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={node.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-9 w-9 shrink-0 rounded-[6px] border border-[#2A2A2E] object-cover" />
          ) : (
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px] border border-[#2A2A2E] text-[#55524F]">
              <ImageIcon size={14} />
            </span>
          )}
          <LevelIcon size={14} className={cn('shrink-0', node.level === 'campaign' ? 'text-[#F0333D]' : node.level === 'adset' ? 'text-[#7AA7FF]' : 'text-[#8E8A86]')} />
          <span className={cn('truncate text-[13px]', depth === 0 ? 'font-bold text-[#F7F5F1]' : 'font-medium text-[#DCD8D1]')} title={node.name}>
            {node.name}
          </span>
          {kids > 0 && <span className="shrink-0 font-mono text-[10px] text-[#6E6A66]">({kids})</span>}
        </div>
      </td>
      <td className="px-3">
        <StatusPill status={status} />
      </td>
      <td className="px-3 text-right text-[12px] text-[#AFAAA3]">{node.budget ?? (node.level === 'ad' ? 'Anúncio' : dash)}</td>
      <td className="px-3 text-right text-[13px] font-semibold tabular-nums text-[#F7F5F1]">{formatBRL(m.spend)}</td>
      <td className="px-3 text-right text-[12px] tabular-nums text-[#DCD8D1]">{m.revenue ? formatBRL(m.revenue) : dash}</td>
      <td className={cn('px-3 text-right font-mono text-[12px] font-bold tabular-nums', roasTone)}>{m.spend > 0 ? roasFmt(m.roas) : dash}</td>
      <td className="px-3 text-right text-[12px] tabular-nums text-[#DCD8D1]">{m.purchases ? int(m.purchases) : dash}</td>
      <td className="px-3 text-right text-[12px] tabular-nums text-[#DCD8D1]">{m.addToCart ? int(m.addToCart) : dash}</td>
      <td className="px-3 text-right text-[12px] tabular-nums text-[#DCD8D1]">{m.linkClicks ? int(m.linkClicks) : dash}</td>
      <td className="px-3 text-right text-[12px] tabular-nums text-[#DCD8D1]">{m.linkClicks ? formatBRL(m.cpc) : dash}</td>
      <td className="px-3 text-right text-[12px] tabular-nums text-[#DCD8D1]">{m.impressions ? pct(m.ctr) : dash}</td>
    </tr>
  )
}

// ---------------------------------------------------------------------------
// Criativos
// ---------------------------------------------------------------------------
type SortBy = 'purchases' | 'roas' | 'spend' | 'ctr'
const SORTS: { id: SortBy; label: string }[] = [
  { id: 'purchases', label: 'Mais compras' },
  { id: 'roas', label: 'Maior ROAS' },
  { id: 'spend', label: 'Maior gasto' },
  { id: 'ctr', label: 'Maior CTR' },
]

function CreativesPanel({ result, loading }: { result: StructureResult | null; loading: boolean }) {
  const [filter, setFilter] = useState<Filter>('todos')
  const [sortBy, setSortBy] = useState<SortBy>('purchases')

  const ads = useMemo(() => {
    if (!result?.ok) return []
    const out: (StructNode & { campaign: string; adset: string })[] = []
    for (const c of result.campaigns) for (const s of c.children ?? []) for (const a of s.children ?? []) out.push({ ...a, campaign: c.name, adset: s.name })
    return out
  }, [result])

  if (loading || !result) return <Loading label="Carregando criativos…" />
  if (!result.ok) return <ErrorBox message={result.error} />

  const list = ads
    .filter((a) => passes(filter, a.status))
    .sort((a, b) => b.metrics[sortBy] - a.metrics[sortBy] || b.metrics.spend - a.metrics.spend)

  return (
    <div className="uc-fade-up">
      <div className="mt-4 flex flex-col gap-3 rounded-[10px] border border-[#222225] bg-[#111113] p-3 md:flex-row md:items-center md:justify-between">
        <p className="flex items-center gap-2 px-1 text-[13px] font-semibold text-[#ECE9E3]">
          <Sparkles size={15} className="text-[#D7141F]" /> Criativos
          <span className="font-mono text-[11px] font-normal text-[#8E8A86]">{list.length} anúncio(s)</span>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <div role="radiogroup" aria-label="Filtrar criativos" className="flex rounded-[8px] border border-[#2A2A2E] bg-[#0B0B0C] p-0.5">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                role="radio"
                aria-checked={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={cn('rounded-[6px] px-3 py-1 text-[12px] font-semibold transition', filter === f.id ? 'bg-[#D7141F] text-white' : 'text-[#AFAAA3] hover:text-white')}
              >
                {f.label}
              </button>
            ))}
          </div>
          <select aria-label="Ordenar criativos" value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)} className="mb-0 h-8 w-auto rounded-[8px] border border-[#2A2A2E] bg-[#0B0B0C] px-2 py-0 text-[12px] text-[#ECE9E3]">
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {list.length === 0 ? (
        <div className="mt-3 rounded-[10px] border border-dashed border-[#2A2A2E] p-10 text-center text-[13px] text-[#8E8A86]">Nenhum criativo neste filtro.</div>
      ) : (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {list.map((a, i) => (
            <article key={a.id} className="group overflow-hidden rounded-[10px] border border-[#222225] bg-[#111113] transition hover:border-[#D7141F]/45">
              <div className="relative aspect-[4/3] bg-[#0B0B0C]">
                {a.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.thumbnail} alt={a.name} loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover opacity-90 transition group-hover:opacity-100" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-[#3A3A40]">
                    <ImageIcon size={34} />
                  </span>
                )}
                <span className="absolute left-2 top-2">
                  <StatusPill status={a.status} />
                </span>
                {i < 3 && sortBy !== 'spend' && a.metrics[sortBy] > 0 && (
                  <span className="font-display absolute right-2 top-2 rounded-[5px] bg-[#D7141F] px-2 py-0.5 text-[14px] text-white">#{i + 1}</span>
                )}
              </div>
              <div className="p-4">
                <p className="truncate text-[13px] font-bold text-[#F7F5F1]" title={a.name}>
                  {a.name}
                </p>
                <p className="truncate text-[10px] text-[#6E6A66]" title={`${a.campaign} › ${a.adset}`}>
                  {a.campaign} › {a.adset}
                </p>
                <dl className="mt-3 grid grid-cols-3 gap-x-2 gap-y-2.5">
                  <Mini label="Gasto" value={formatBRL(a.metrics.spend)} />
                  <Mini label="ROAS" value={a.metrics.spend ? roasFmt(a.metrics.roas) : '—'} tone={a.metrics.roas >= 3 ? '#34D399' : a.metrics.roas >= 1 ? '#FBBF24' : undefined} />
                  <Mini label="Compras" value={int(a.metrics.purchases)} />
                  <Mini label="Faturamento" value={formatBRL(a.metrics.revenue)} />
                  <Mini label="CTR" value={a.metrics.impressions ? pct(a.metrics.ctr) : '—'} />
                  <Mini label="CPC" value={a.metrics.linkClicks ? formatBRL(a.metrics.cpc) : '—'} />
                </dl>
              </div>
            </article>
          ))}
        </div>
      )}
      <Warnings list={result.warnings} />
    </div>
  )
}

function Mini({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <dt className="font-mono text-[8.5px] font-bold uppercase tracking-[0.12em] text-[#6E6A66]">{label}</dt>
      <dd className="truncate text-[12px] font-semibold tabular-nums text-[#ECE9E3]" style={tone ? { color: tone } : undefined}>
        {value}
      </dd>
    </div>
  )
}
