'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  CalendarDays,
  Check,
  ChevronDown,
  Copy,
  Download,
  ImageIcon,
  Layers,
  MessageCircle,
  MessageSquare,
  Save,
  Send,
  ShoppingCart,
  Sparkles,
  TrendingUp,
  UserRound,
  Wallet,
} from 'lucide-react'
import { formatBRL } from '@/lib/format'
import type { MockClient, MockReportDraft } from '@/lib/mock'
import { cn, Toast, Toggle } from '@/components/hub/ui'

type PeriodKey = 'last' | '7d' | '14d' | '30d' | 'month' | 'lastMonth' | 'yesterday' | 'custom'

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: 'last', label: 'Semana passada (seg-dom)' },
  { key: '7d', label: 'Últimos 7 dias' },
  { key: '14d', label: 'Últimos 14 dias' },
  { key: '30d', label: 'Últimos 30 dias' },
  { key: 'month', label: 'Este mês' },
  { key: 'lastMonth', label: 'Mês passado' },
  { key: 'yesterday', label: 'Ontem' },
  { key: 'custom', label: 'Personalizado' },
]

const HISTORY = [
  { client: 'Doce Encanto', period: 'Segunda 26/10 a Domingo 01/11', sent: true, at: '02/11/2026' },
  { client: 'Vila Grelha', period: 'Segunda 19/10 a Domingo 25/10', sent: true, at: '26/10/2026' },
  { client: 'Bella Massa', period: 'Segunda 12/10 a Domingo 18/10', sent: false, at: '19/10/2026' },
]

export function ReportsScreen({
  initialDraft,
  clients,
  workspaceName,
}: {
  initialDraft: MockReportDraft
  clients: MockClient[]
  workspaceName: string
}) {
  const activeClients = useMemo(() => clients.filter((client) => client.situation === 'ativo'), [clients])
  const [mode, setMode] = useState<'individual' | 'all'>('individual')
  const [clientId, setClientId] = useState(initialDraft.clientId)
  const [period, setPeriod] = useState<PeriodKey>('last')
  const [compare, setCompare] = useState(initialDraft.compare)
  const [blocks, setBlocks] = useState(initialDraft.blocks)
  const [tab, setTab] = useState<'gerador' | 'historico'>('gerador')
  const [message, setMessage] = useState(initialDraft.whatsappText)
  const [toast, setToast] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  const selected = clients.find((client) => client.id === clientId) ?? clients[0]
  const displayName = mode === 'all' ? 'Resumo do time' : selected.name
  const displaySituation = mode === 'all' ? 'todos' : selected.situation

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 4200)
    return () => clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    if (mode === 'all') return
    setMessage(initialDraft.whatsappText.replace(initialDraft.clientName, selected.name))
    setSent(false)
  }, [clientId, initialDraft, mode, selected.name])

  const periodLabel = useMemo(() => {
    if (period === 'last') return initialDraft.periodLabel
    if (period === '7d') return 'Últimos 7 dias'
    if (period === '14d') return 'Últimos 14 dias'
    if (period === '30d') return 'Últimos 30 dias'
    if (period === 'month') return 'Este mês'
    if (period === 'lastMonth') return 'Mês passado'
    if (period === 'yesterday') return 'Ontem'
    return 'Período personalizado'
  }, [period, initialDraft.periodLabel])

  const copyMessage = async () => {
    try {
      await navigator.clipboard.writeText(message)
      setToast('Mensagem copiada para a área de transferência.')
    } catch {
      setToast('Não foi possível copiar neste navegador.')
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1720px] px-4 pb-12 pt-5 sm:px-6 md:px-[30px] md:pt-[26px]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[26px] font-extrabold leading-tight tracking-[-0.03em] text-[#F1F5FC] md:text-[28px]">Gerador de Relatórios</h1>
            <span className="rounded-md border border-[#3D8EFF]/45 bg-[#3D8EFF]/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[#6EA8FF]">
              Rotina semanal
            </span>
          </div>
          <p className="mt-1.5 text-[13px] text-[#8A97AC]">
            Gere relatórios por objetivo, com card em alta resolução (4:5) e mensagem pronta para WhatsApp.
          </p>
        </div>

        <div className="flex items-center gap-1 rounded-xl border border-[#26314A] bg-[#0D1320] p-1">
          <button
            type="button"
            onClick={() => setTab('gerador')}
            aria-pressed={tab === 'gerador'}
            className={cn(
              'flex h-[42px] items-center gap-2 rounded-lg px-5 text-[13px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3D8EFF]',
              tab === 'gerador' ? 'bg-[#3D8EFF] font-bold text-[#06101F]' : 'text-[#A9B4C7] hover:text-white',
            )}
          >
            <Sparkles size={15} />
            Gerador
          </button>
          <button
            type="button"
            onClick={() => setTab('historico')}
            aria-pressed={tab === 'historico'}
            className={cn(
              'flex h-[42px] items-center gap-2 rounded-lg px-5 text-[13px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3D8EFF]',
              tab === 'historico' ? 'bg-[#3D8EFF] font-bold text-[#06101F]' : 'text-[#A9B4C7] hover:text-white',
            )}
          >
            <CalendarDays size={15} />
            Histórico
          </button>
        </div>
      </div>

      {tab === 'historico' ? (
        <div className="mt-6 overflow-hidden rounded-2xl border border-[#1A2231] bg-[#0D1320]">
          <div className="border-b border-[#1A2231] px-5 py-4">
            <h2 className="text-[13px] font-bold uppercase tracking-[0.1em] text-[#C9D3E3]">Relatórios gerados</h2>
            <p className="mt-1 text-[11px] text-[#7F8CA3]">Histórico fictício da fase visual.</p>
          </div>
          <div className="divide-y divide-[#1A2231]">
            {HISTORY.map((item) => (
              <div key={`${item.client}-${item.period}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 hover:bg-[#111A2B]">
                <div>
                  <p className="text-[14px] font-semibold text-[#F1F5FC]">{item.client}</p>
                  <p className="mt-0.5 text-[11px] text-[#8A97AC]">{item.period}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[11px] text-[#7F8CA3]">{item.at}</span>
                  <span
                    className={cn(
                      'rounded-full border px-2.5 py-0.5 text-[10px] font-bold',
                      item.sent ? 'border-[#34D399]/45 bg-[#34D399]/10 text-[#34D399]' : 'border-[#FBBF24]/45 bg-[#FBBF24]/10 text-[#FBBF24]',
                    )}
                  >
                    {item.sent ? 'Enviado' : 'Pendente'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setToast('Abrir relatório entra na próxima fase.')}
                    className="rounded-lg border border-[#26314A] px-3 py-1.5 text-[11px] font-semibold text-[#C9D3E3] hover:border-[#3D8EFF]/50 hover:text-white"
                  >
                    Abrir
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-5 grid grid-cols-1 gap-6 xl:mt-6 xl:grid-cols-[minmax(0,1fr)_610px] xl:gap-8">
          <div className="min-w-0 space-y-4">
            <section className="rounded-2xl border border-[#1E2738] bg-[#0D1320] p-5 md:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#3D8EFF]/15 text-[#3D8EFF]">
                    <UserRound size={16} />
                  </span>
                  <h2 className="text-[12px] font-bold uppercase tracking-[0.12em] text-[#C9D3E3]">Cliente</h2>
                </div>
                <div className="flex items-center gap-1 rounded-lg border border-[#26314A] bg-[#080D18] p-1">
                  <button
                    type="button"
                    onClick={() => setMode('individual')}
                    className={cn(
                      'h-[32px] rounded-md px-3 text-[11px] font-semibold transition-colors',
                      mode === 'individual' ? 'bg-[#3D8EFF]/15 text-[#6EA8FF] ring-1 ring-inset ring-[#3D8EFF]/60' : 'text-[#8A97AC] hover:text-white',
                    )}
                  >
                    Individual
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode('all')}
                    className={cn(
                      'flex h-[32px] items-center gap-1.5 rounded-md px-3 text-[11px] font-semibold transition-colors',
                      mode === 'all' ? 'bg-[#3D8EFF]/15 text-[#6EA8FF] ring-1 ring-inset ring-[#3D8EFF]/60' : 'text-[#8A97AC] hover:text-white',
                    )}
                  >
                    <Sparkles size={11} /> Todos os ativos ({activeClients.length})
                  </button>
                </div>
              </div>

              <p className="mb-2 mt-4 text-[10px] font-bold uppercase tracking-[0.12em] text-[#7F8CA3]">Escolha o cliente</p>
              <div className="relative">
                <select
                  value={mode === 'all' ? 'all' : clientId}
                  onChange={(event) => setClientId(event.target.value)}
                  disabled={mode === 'all'}
                  aria-label="Escolher cliente do relatório"
                  className="mb-0 h-[46px] w-full cursor-pointer appearance-none rounded-lg border border-[#26314A] bg-[#080D18] px-3 pr-10 text-[13px] text-[#E8EDF7] outline-none focus:border-[#3D8EFF] focus:ring-2 focus:ring-[#3D8EFF]/20 disabled:cursor-not-allowed disabled:text-[#8A97AC]"
                >
                  {mode === 'all' ? (
                    <option value="all">{activeClients.length} clientes ativos</option>
                  ) : (
                    activeClients.map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.name} ({client.situation})
                      </option>
                    ))
                  )}
                </select>
                <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#7F8CA3]" />
              </div>
            </section>

            <section className="rounded-2xl border border-[#1E2738] bg-[#0D1320] p-5 md:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#3D8EFF]/15 text-[#3D8EFF]">
                    <CalendarDays size={16} />
                  </span>
                  <h2 className="text-[12px] font-bold uppercase tracking-[0.12em] text-[#C9D3E3]">Período</h2>
                </div>
                <span className="rounded-md border border-[#1E2738] bg-[#080D18] px-2.5 py-1 text-[11px] font-semibold text-[#6EA8FF]">
                  {periodLabel}
                </span>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
                {PERIODS.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => {
                      setPeriod(item.key)
                      if (item.key === 'custom') setToast('Período personalizado entra na próxima fase.')
                    }}
                    className={cn(
                      'flex h-[52px] items-center justify-center rounded-lg border px-2 text-center text-[11px] font-medium leading-tight transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3D8EFF]',
                      period === item.key
                        ? 'border-[#3D8EFF] bg-[#3D8EFF]/10 text-[#6EA8FF]'
                        : 'border-[#26314A] bg-[#080D18] text-[#A9B4C7] hover:border-[#3D8EFF]/50 hover:text-white',
                    )}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              <div className="mt-4 flex items-center gap-3">
                <Toggle checked={compare} onChange={setCompare} label="Comparar com o período anterior" />
                <span className="text-[12px] text-[#C9D3E3]">Comparar com o período anterior ({initialDraft.previousPeriodLabel})</span>
              </div>
            </section>

            <section className="rounded-2xl border border-[#1E2738] bg-[#0D1320] p-5 md:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#3D8EFF]/15 text-[#3D8EFF]">
                    <Layers size={16} />
                  </span>
                  <h2 className="text-[12px] font-bold uppercase tracking-[0.12em] text-[#C9D3E3]">Blocos do relatório</h2>
                </div>
                <button
                  type="button"
                  onClick={() => setToast('Modelos de relatório entram na próxima fase.')}
                  className="flex h-[32px] items-center gap-1.5 rounded-lg border border-[#26314A] px-3 text-[11px] font-semibold text-[#C9D3E3] hover:border-[#3D8EFF]/50 hover:text-white"
                >
                  <Layers size={12} />
                  Modelos (1)
                </button>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
                {(
                  [
                    { key: 'general', label: 'Seção Geral' },
                    { key: 'byObjective', label: 'Por Objetivo' },
                    { key: 'topCreatives', label: 'Top Criativos' },
                    { key: 'balance', label: 'Saldo da Conta' },
                  ] as const
                ).map((block) => (
                  <div key={block.key} className="flex h-[54px] items-center justify-between gap-2 rounded-lg border border-[#26314A] bg-[#080D18] px-3">
                    <span className="text-[11px] font-medium text-[#C9D3E3]">{block.label}</span>
                    <Toggle
                      size="sm"
                      checked={blocks[block.key]}
                      onChange={(value) => setBlocks((current) => ({ ...current, [block.key]: value }))}
                      label={block.label}
                    />
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-2xl border border-[#1E2738] bg-[#0D1320] p-5 md:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#3D8EFF]/15 text-[#3D8EFF]">
                    <MessageSquare size={16} />
                  </span>
                  <h2 className="text-[12px] font-bold uppercase tracking-[0.12em] text-[#C9D3E3]">Mensagem para WhatsApp</h2>
                </div>
                <span className="text-[11px] text-[#7F8CA3]">Texto editável com formatação para WhatsApp</span>
              </div>

              <textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                aria-label="Mensagem para WhatsApp"
                className="hub-scrollbar mb-0 mt-4 h-[270px] w-full resize-none rounded-lg border border-[#26314A] bg-[#080D18] p-4 font-mono text-[12px] leading-relaxed text-[#D7DFEC] outline-none focus:border-[#3D8EFF] focus:ring-2 focus:ring-[#3D8EFF]/20"
              />

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={copyMessage}
                  className="flex h-[40px] items-center gap-2 rounded-lg bg-[#3D8EFF] px-4 text-[12px] font-bold text-[#06101F] transition-colors hover:bg-[#6EA8FF] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#6EA8FF]"
                >
                  <Copy size={14} />
                  Copiar mensagem
                </button>
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(message)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex h-[40px] items-center gap-2 rounded-lg border border-[#26314A] px-4 text-[12px] font-semibold text-[#C9D3E3] no-underline transition-colors hover:border-[#3D8EFF]/50 hover:text-white hover:no-underline"
                >
                  <MessageCircle size={14} />
                  Abrir no WhatsApp
                </a>
                <button
                  type="button"
                  onClick={() => setToast('Relatório salvo apenas nesta demonstração.')}
                  className="flex h-[40px] items-center gap-2 rounded-lg border border-[#26314A] px-4 text-[12px] font-semibold text-[#C9D3E3] transition-colors hover:border-[#3D8EFF]/50 hover:text-white"
                >
                  <Save size={14} />
                  Salvar relatório
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSent(true)
                    setToast('Relatório marcado como enviado nesta demonstração.')
                  }}
                  className={cn(
                    'flex h-[40px] items-center gap-2 rounded-lg border px-4 text-[12px] font-semibold transition-colors',
                    sent
                      ? 'border-[#34D399]/45 bg-[#34D399]/10 text-[#34D399]'
                      : 'border-[#26314A] text-[#C9D3E3] hover:border-[#3D8EFF]/50 hover:text-white',
                  )}
                >
                  {sent ? <Check size={14} /> : <Send size={14} />}
                  {sent ? 'Enviado' : 'Marcar como enviado'}
                </button>
              </div>
            </section>
          </div>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-[11px] text-[#8A97AC]">Formato 4:5 (1080x1350)</span>
              <button
                type="button"
                onClick={() => setToast('Exportação PNG entra na próxima fase. O card já está fiel ao formato 4:5.')}
                className="flex h-[42px] items-center gap-2 rounded-lg bg-[#3D8EFF] px-4 text-[12px] font-bold text-[#06101F] transition-colors hover:bg-[#6EA8FF] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#6EA8FF]"
              >
                <Download size={15} />
                Baixar imagem (PNG)
              </button>
            </div>

            <div className="relative mt-4 aspect-[4/5] w-full overflow-hidden rounded-2xl border border-[#3D8EFF]/35 bg-[#0A101B] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.45)] md:p-7">
              <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[radial-gradient(ellipse_at_top,rgba(61,142,255,0.18),transparent_65%)]" />

              <div className="relative flex h-full flex-col">
                <div className="flex items-center justify-between gap-3 border-b border-[#1E2738] pb-4">
                  <span className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-[#6EA8FF]">
                    <span className="h-[7px] w-[7px] rounded-full bg-[#3D8EFF] shadow-[0_0_10px_rgba(61,142,255,0.8)]" />
                    {workspaceName} Assessoria
                  </span>
                  <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-[#8A97AC]">Relatório de tráfego</span>
                </div>

                <div className="mt-4">
                  <h3 className="truncate text-[38px] font-extrabold leading-none tracking-[-0.045em] text-[#F1F5FC]">{displayName}</h3>
                  <p className="mt-2.5 text-[11px] text-[#A9B4C7]">
                    {periodLabel}
                    {compare && <span className="ml-2 text-[9px] uppercase tracking-wider text-[#5F6B80]">• vs período anterior</span>}
                  </p>
                  <p className="mt-1 text-[9px] uppercase tracking-[0.16em] text-[#5F6B80]">{displaySituation}</p>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <MetricBox label="Investimento total" value={formatBRL(initialDraft.metrics.investment)} delta={initialDraft.metrics.investmentDelta} />
                  <MetricBox
                    label="Pessoas alcançadas (aprox.)"
                    value={new Intl.NumberFormat('pt-BR').format(initialDraft.metrics.reach)}
                    delta={initialDraft.metrics.reachDelta}
                  />
                </div>

                <div className="mt-2.5 rounded-xl border border-[#1E2738] bg-[#080D18] p-4">
                  <div className="flex items-start justify-between gap-4">
                    <span className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.12em] text-[#8A97AC]">
                      <ShoppingCart size={11} className="text-[#3D8EFF]" /> Compras
                    </span>
                    <svg viewBox="0 0 130 36" className="h-8 w-[120px]" aria-hidden="true">
                      <path d="M2 31 C 18 30, 22 24, 34 25 S 52 19, 64 20 S 84 12, 98 13 S 116 7, 128 3" fill="none" stroke="#3D8EFF" strokeWidth="2.4" strokeLinecap="round" />
                    </svg>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-[8px] font-bold uppercase tracking-[0.13em] text-[#7F8CA3]">Resultados (compras)</p>
                      <p className="mt-1 flex items-baseline gap-1.5">
                        <span className="text-[30px] font-extrabold leading-none tracking-[-0.04em] text-[#F1F5FC]">{initialDraft.metrics.purchases}</span>
                        <span className="flex items-center gap-0.5 text-[9px] font-bold text-[#34D399]"><TrendingUp size={9} />{initialDraft.metrics.purchasesDelta}%</span>
                      </p>
                    </div>
                    <div>
                      <p className="text-[8px] font-bold uppercase tracking-[0.13em] text-[#7F8CA3]">Custo por resultado</p>
                      <p className="mt-1 flex items-baseline gap-1.5">
                        <span className="text-[26px] font-extrabold leading-none tracking-[-0.04em] text-[#F1F5FC]">{formatBRL(initialDraft.metrics.costPerPurchase)}</span>
                        <span className="flex items-center gap-0.5 text-[9px] font-bold text-[#FBBF24]"><TrendingUp size={9} />{initialDraft.metrics.costPerPurchaseDelta}%</span>
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between border-t border-[#1A2231] pt-2.5">
                    <span className="text-[9px] text-[#8A97AC]">Faturamento: <strong className="text-[11px] text-[#E8EDF7]">{formatBRL(initialDraft.metrics.revenue)}</strong></span>
                    <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#34D399]">ROAS: {initialDraft.metrics.roas.toFixed(2).replace('.', ',')}x</span>
                  </div>
                </div>

                <div className="mt-3 min-h-0 flex-1">
                  <p className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.12em] text-[#8A97AC]">
                    <Sparkles size={11} className="text-[#D4AF37]" /> Melhores criativos ativos
                  </p>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {initialDraft.creatives.map((creative) => (
                      <div key={creative.id} className="overflow-hidden rounded-lg border border-[#1E2738] bg-[#0D1320]">
                        <div className="relative flex aspect-[4/3] items-center justify-center" style={{ background: creative.gradient }}>
                          <ImageIcon size={20} className="text-white/25" />
                        </div>
                        <div className="px-2 py-1.5">
                          <p className="truncate text-[10px] font-bold text-[#E8EDF7]">{creative.label}</p>
                          <p className="mt-0.5 text-[9px] text-[#7F8CA3]">{creative.purchases} compras</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between gap-3 border-t border-[#1E2738] pt-3">
                  <span className="flex items-center gap-1.5 text-[9px] text-[#A9B4C7]">
                    <Wallet size={11} className="text-[#3D8EFF]" />
                    Saldo da conta: <strong className="text-[10px] text-[#E8EDF7]">{formatBRL(initialDraft.metrics.balance)}</strong>
                    <span className="text-[#5F6B80]">(~{initialDraft.metrics.balanceDays} dias)</span>
                  </span>
                  <span className="hidden text-[7px] font-bold uppercase tracking-[0.16em] text-[#5F6B80] sm:inline">Gestão de tráfego profissional</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <Toast message={toast} />
    </div>
  )
}

function MetricBox({ label, value, delta }: { label: string; value: string; delta: number }) {
  return (
    <div className="rounded-xl border border-[#1E2738] bg-[#080D18] px-4 py-3.5">
      <p className="text-[8px] font-bold uppercase tracking-[0.13em] text-[#7F8CA3]">{label}</p>
      <p className="mt-1.5 flex flex-wrap items-baseline gap-1.5">
        <span className="text-[24px] font-extrabold leading-none tracking-[-0.045em] text-[#F1F5FC]">{value}</span>
        <span className="flex items-center gap-0.5 text-[9px] font-bold text-[#34D399]">
          <TrendingUp size={9} />+{delta}%
        </span>
      </p>
    </div>
  )
}
