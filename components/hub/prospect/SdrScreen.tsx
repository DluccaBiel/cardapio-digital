'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import {
  ArrowRight,
  Check,
  ChevronRight,
  ExternalLink,
  Globe,
  Loader2,
  MapPin,
  MessageCircle,
  Phone,
  Search,
  Send,
  Sparkles,
  Users,
} from 'lucide-react'
import type { ProspectClient } from '../../../lib/db/prospects'
import type { SdrLeadView, SdrSearchView } from '../../../lib/sdr/types'
import {
  sdrRequestSearchAction,
  sdrSearchStatusAction,
  sendLeadsToDisparoAction,
} from '../../../app/a/[ws]/sdr/actions'
import {
  FilterSelect,
  MissingColumnsNotice,
  NICHE_LABEL,
  PageHeader,
  Pill,
  Segmented,
  StatusPill,
  type NicheFilter,
} from './shared'
import { FieldLabel, Toast, cn } from '../ui'

export type SdrLead = ProspectClient & { icpScore: number; icpEvidencias: string[] }

type Props = {
  ws: string
  basePath: string
  leads: SdrLead[]
  initialProspectLeads: SdrLeadView[]
  canManage: boolean
  missingColumns: boolean
}

const INPUT =
  'h-[38px] w-full rounded-[5px] border border-[#2A2A2E] bg-[#0B0B0C] px-3 text-[13px] text-[#ECE9E3] outline-none placeholder:text-[#85817C] focus:border-[#D7141F]'
const CARD = 'rounded-[6px] border border-[#222225] bg-[#111113] p-4 md:p-5'
const BTN_PRIMARY =
  'inline-flex items-center justify-center gap-1.5 rounded-[5px] bg-[#D7141F] px-4 py-2 text-[13px] font-semibold text-white hover:bg-[#B5121B] disabled:opacity-40'

function fmtPhone(p: string | null | undefined): string {
  if (!p) return ''
  const d = p.replace(/^55/, '')
  return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : d.length === 10 ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}` : p
}

function waLink(p: string | null | undefined): string | null {
  if (!p) return null
  const d = p.replace(/\D/g, '')
  return d ? `https://wa.me/${d}` : null
}

export function SdrScreen({ ws, basePath, leads, initialProspectLeads, canManage, missingColumns }: Props) {
  const router = useRouter()
  const [tab, setTab] = useState<'prospeccao' | 'clientes'>('prospeccao')
  const [toast, setToast] = useState<string | null>(null)
  const flash = useCallback((t: string) => {
    setToast(t)
    window.setTimeout(() => setToast(null), 4000)
  }, [])

  // Estado da Pesquisa IA
  const [city, setCity] = useState('')
  const [uf, setUf] = useState('')
  const [niche, setNiche] = useState<'food' | 'health'>('food')
  const [searchPending, startSearch] = useTransition()
  const [searchId, setSearchId] = useState<string | null>(null)
  const [progress, setProgress] = useState<string | null>(null)
  const [summary, setSummary] = useState<string | null>(null)

  // Empresas encontradas pelo agente
  const [prospects, setProspects] = useState<SdrLeadView[]>(initialProspectLeads)
  const [selected, setSelected] = useState<Set<string>>(new Set(initialProspectLeads.map((p) => p.id)))
  const [dispatchPending, startDispatch] = useTransition()

  // Acompanhamento da pesquisa em tempo real
  useEffect(() => {
    if (!searchId) return
    let alive = true
    const tick = async () => {
      const r = await sdrSearchStatusAction(ws, searchId).catch(() => null)
      if (!alive || !r) return
      if (!r.ok) {
        setSearchId(null)
        return flash(r.error)
      }
      const s = r.search
      if (s.status === 'pendente') {
        setProgress('Pedido registrado — o agente está iniciando a pesquisa…')
      } else if (s.status === 'buscando') {
        setProgress(s.detail || 'O agente está varrendo os mapas e estabelecimentos na cidade…')
      } else {
        setSearchId(null)
        setProgress(null)
        if (s.status === 'erro') return flash(s.detail || 'A pesquisa falhou.')

        const newIds = new Set(r.fresh.map((l) => l.id))
        setProspects((prev) => [...r.fresh, ...prev.filter((p) => !newIds.has(p.id))])
        setSelected((prev) => new Set([...Array.from(prev), ...Array.from(newIds)]))

        const where = s.label || [s.city, s.uf].filter(Boolean).join('/')
        setSummary(
          s.created_count > 0
            ? `${where}: ${s.found} empresas com telefone localizadas pelo agente · ${s.created_count} novas prontas para envio.`
            : `${where}: ${s.found} empresas encontradas (todas já estavam na sua base).`,
        )
      }
    }
    tick()
    const id = window.setInterval(tick, 2500)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [searchId, ws, flash])

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    if (city.trim().length < 2) return
    startSearch(async () => {
      setSummary(null)
      const r = await sdrRequestSearchAction(ws, { city, uf, niche })
      if (!r.ok) return flash(r.error)
      setProgress('Agente IA acionado — iniciando varredura...')
      setSearchId(r.search.id)
    })
  }

  // Seleção de empresas
  function toggleSelect(id: string) {
    const s = new Set(selected)
    if (s.has(id)) s.delete(id)
    else s.add(id)
    setSelected(s)
  }

  const allSelected = prospects.length > 0 && prospects.every((p) => selected.has(p.id))
  function toggleSelectAll() {
    if (allSelected) setSelected(new Set())
    else setSelected(new Set(prospects.map((p) => p.id)))
  }

  // Enviar ao disparo
  function handleSendToDisparos() {
    if (selected.size === 0) return flash('Selecione pelo menos uma empresa.')
    const ids = Array.from(selected)
    startDispatch(async () => {
      const r = await sendLeadsToDisparoAction(ws, ids)
      if (!r.ok) return flash(r.error)
      flash(`${r.count} empresa(s) enviadas para o menu Disparos!`)
      router.push(`${basePath}/disparos?fromSdr=1&ids=${ids.join(',')}`)
    })
  }

  // Filtros da aba de clientes CRM
  const [crmNiche, setCrmNiche] = useState<NicheFilter>('all')
  const [crmBand, setCrmBand] = useState<'all' | 'qualificado' | 'nao'>('all')
  const [crmQuery, setCrmQuery] = useState('')

  const filteredClients = useMemo(() => {
    const q = crmQuery.trim().toLowerCase()
    return leads
      .filter(
        (l) =>
          (crmNiche === 'all' || l.niche === crmNiche) &&
          (crmBand === 'all' || (crmBand === 'qualificado' ? l.icpScore >= 60 : l.icpScore < 60)) &&
          (!q || l.name.toLowerCase().includes(q)),
      )
      .sort((a, b) => b.icpScore - a.icpScore)
  }, [leads, crmNiche, crmBand, crmQuery])

  const qualifiedCount = prospects.filter((p) => p.icpScore >= 60).length

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 pb-10 pt-5 sm:px-6 md:px-[30px] md:pt-[26px]">
      <PageHeader
        title="SDR · Prospecção & Qualificação"
        description="Pesquise empresas com o Agente IA, colete informações e qualificação ICP e envie diretamente para os disparos WhatsApp."
        actions={
          <div className="inline-flex rounded-[6px] border border-[#2A2A2E] bg-[#111113] p-1">
            <button
              type="button"
              onClick={() => setTab('prospeccao')}
              className={cn(
                'inline-flex items-center gap-2 rounded-[5px] px-3.5 py-1.5 text-[12px] font-semibold transition-colors',
                tab === 'prospeccao' ? 'bg-[#D7141F] text-white' : 'text-[#8E8A86] hover:text-[#ECE9E3]',
              )}
            >
              <Sparkles size={14} /> Agente de Prospecção ({prospects.length})
            </button>
            <button
              type="button"
              onClick={() => setTab('clientes')}
              className={cn(
                'inline-flex items-center gap-2 rounded-[5px] px-3.5 py-1.5 text-[12px] font-semibold transition-colors',
                tab === 'clientes' ? 'bg-[#D7141F] text-white' : 'text-[#8E8A86] hover:text-[#ECE9E3]',
              )}
            >
              <Users size={14} /> Clientes Cadastrados ({leads.length})
            </button>
          </div>
        }
      />

      {missingColumns && <MissingColumnsNotice />}

      {tab === 'prospeccao' && (
        <>
          {/* Card de Pesquisa do Agente */}
          <section className={cn(CARD, 'mb-6')}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="uc-title flex items-center gap-2 text-[18px] text-[#F7F5F1]">
                <Search size={18} className="text-[#D7141F]" /> Pesquisar Empresas com Agente IA
              </h2>
              <Pill tone="amber">OpenStreetMap & Geocodificação</Pill>
            </div>
            <p className="mb-4 text-[12px] leading-relaxed text-[#8E8A86]">
              O agente localiza estabelecimentos com número de telefone ativo, endereço e dados de contato, calcula a pontuação ICP e
              permite enviar as empresas selecionadas com 1 clique para os disparos de WhatsApp.
            </p>

            <form onSubmit={handleSearch} className="grid gap-3 sm:grid-cols-[1fr_90px_160px_auto]">
              <label>
                <FieldLabel>Cidade</FieldLabel>
                <input
                  className={INPUT}
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="Ex.: Campinas, Valinhos, São Paulo..."
                  maxLength={80}
                  required
                />
              </label>
              <label>
                <FieldLabel>UF</FieldLabel>
                <input
                  className={cn(INPUT, 'uppercase')}
                  value={uf}
                  onChange={(e) => setUf(e.target.value.slice(0, 2))}
                  placeholder="SP"
                  maxLength={2}
                />
              </label>
              <label>
                <FieldLabel>Nicho</FieldLabel>
                <select
                  value={niche}
                  onChange={(e) => setNiche(e.target.value as 'food' | 'health')}
                  className={cn(INPUT, 'cursor-pointer')}
                >
                  <option value="food">Food & Delivery</option>
                  <option value="health">Saúde & Estética</option>
                </select>
              </label>
              <div className="flex items-end">
                <button
                  type="submit"
                  disabled={searchPending || city.trim().length < 2 || !canManage}
                  className={cn(BTN_PRIMARY, 'h-[38px] w-full sm:w-auto')}
                >
                  {searchPending || searchId ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
                  {searchPending || searchId ? 'Pesquisando…' : 'Buscar Empresas'}
                </button>
              </div>
            </form>

            {(searchPending || searchId) && (
              <p className="mt-3 flex items-center gap-2 text-[12px] text-[#FBBF24]">
                <Loader2 size={13} className="animate-spin text-[#D7141F]" />
                {progress || 'O agente está varrendo a cidade…'}
              </p>
            )}

            {summary && (
              <p className="mt-3 rounded-[5px] border border-[#222225] bg-[#0B0B0C] px-3.5 py-2.5 text-[12px] text-[#CFCBC4]">
                {summary}
              </p>
            )}
          </section>

          {/* Métricas Rápidas */}
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-[6px] border border-[#222225] bg-[#111113] px-4 py-3">
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-[#8E8A86]">Empresas Encontradas</p>
              <p className="uc-title mt-1 text-[28px] text-[#F7F5F1]">{prospects.length}</p>
            </div>
            <div className="rounded-[6px] border border-[#222225] bg-[#111113] px-4 py-3">
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-[#8E8A86]">Alta Qualificação (ICP ≥ 60)</p>
              <p className="uc-title mt-1 text-[28px] text-[#4ADE80]">{qualifiedCount}</p>
            </div>
            <div className="rounded-[6px] border border-[#222225] bg-[#111113] px-4 py-3">
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-[#8E8A86]">Selecionadas para Disparo</p>
              <p className="uc-title mt-1 text-[28px] text-[#D7141F]">{selected.size}</p>
            </div>
          </div>

          {/* Barra de Ação de Envio aos Disparos */}
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-[6px] border border-[#222225] bg-[#111113] p-3">
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-[12px] font-semibold text-[#ECE9E3] cursor-pointer">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleSelectAll}
                  className="accent-[#D7141F] h-4 w-4 rounded cursor-pointer"
                />
                Selecionar todas ({prospects.length})
              </label>
              <span className="font-mono text-[12px] text-[#8E8A86]">
                <b className="text-[#4ADE80]">{selected.size}</b> selecionadas
              </span>
            </div>

            <button
              type="button"
              disabled={selected.size === 0 || dispatchPending}
              onClick={handleSendToDisparos}
              className={cn(
                BTN_PRIMARY,
                'bg-[#16A34A] hover:bg-[#15803D] shadow-md shadow-[#16A34A]/20 py-2 px-5 text-[13px] font-bold',
              )}
            >
              {dispatchPending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              Enviar ao Disparo WhatsApp ({selected.size})
            </button>
          </div>

          {/* Tabela de Empresas Encontradas */}
          <div className="overflow-x-auto rounded-[6px] border border-[#222225]">
            <table className="w-full min-w-[840px] border-collapse text-left">
              <thead>
                <tr className="border-b border-[#1C1C1F] bg-[#0E0E10] font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-[#8E8A86]">
                  <th className="w-10 px-3 py-2.5">
                    <input
                      type="checkbox"
                      aria-label="Selecionar todas as empresas"
                      checked={allSelected}
                      onChange={toggleSelectAll}
                      className="accent-[#D7141F]"
                    />
                  </th>
                  <th className="px-3 py-2.5">Empresa</th>
                  <th className="px-3 py-2.5">Categoria</th>
                  <th className="px-3 py-2.5">WhatsApp / Contato</th>
                  <th className="px-3 py-2.5">Localização</th>
                  <th className="px-3 py-2.5">ICP Score</th>
                  <th className="px-3 py-2.5 text-right">Ação</th>
                </tr>
              </thead>
              <tbody>
                {prospects.map((p) => {
                  const isChecked = selected.has(p.id)
                  const wa = waLink(p.phone)
                  return (
                    <tr
                      key={p.id}
                      className={cn(
                        'border-b border-[#18181B] bg-[#111113] text-[12px] last:border-b-0 hover:bg-[#131315]',
                        isChecked && 'bg-[#151113]',
                      )}
                    >
                      <td className="px-3 py-2.5">
                        <input
                          type="checkbox"
                          aria-label={`Selecionar ${p.name}`}
                          checked={isChecked}
                          onChange={() => toggleSelect(p.id)}
                          className="accent-[#D7141F] h-4 w-4 rounded cursor-pointer"
                        />
                      </td>
                      <td className="max-w-[280px] px-3 py-2.5 font-semibold text-[#ECE9E3]">
                        <span className="block truncate text-[13px]">{p.name}</span>
                        {p.address && (
                          <span className="mt-0.5 flex items-center gap-1 text-[11px] font-normal text-[#85817C] truncate">
                            <MapPin size={11} className="shrink-0 text-[#D7141F]" />
                            {p.address}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="inline-block rounded bg-[#1C1C1F] px-2 py-0.5 text-[11px] text-[#CFCBC4]">
                          {p.category || 'Alimentação'}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-[12px]">
                        {wa ? (
                          <a
                            href={wa}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 text-[#4ADE80] hover:underline"
                          >
                            <MessageCircle size={13} />
                            {fmtPhone(p.phone)}
                          </a>
                        ) : (
                          <span className="text-[#85817C]">{fmtPhone(p.phone) || '—'}</span>
                        )}
                        {p.website && (
                          <a
                            href={p.website}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-0.5 flex items-center gap-1 text-[11px] text-[#8E8A86] hover:text-white"
                          >
                            <Globe size={11} /> Website / Redes
                          </a>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-[#CFCBC4]">
                        {[p.city, p.uf].filter(Boolean).join('/') || '—'}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-[#1D1D20]">
                            <div
                              className={p.icpScore >= 60 ? 'h-full bg-[#22C55E]' : 'h-full bg-[#D7141F]'}
                              style={{ width: `${p.icpScore}%` }}
                            />
                          </div>
                          <span className="font-mono text-[12px] font-bold text-[#ECE9E3]">{Math.round(p.icpScore)}</span>
                          {p.icpScore >= 60 && (
                            <span className="rounded bg-[#15803D]/20 px-1.5 py-0.2 text-[10px] font-bold text-[#4ADE80]">
                              ICP
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => {
                            setSelected(new Set([p.id]))
                            handleSendToDisparos()
                          }}
                          className="inline-flex items-center gap-1 rounded-[4px] border border-[#2A2A2E] px-2.5 py-1 text-[11px] font-semibold text-[#CFCBC4] hover:border-[#16A34A] hover:text-[#4ADE80]"
                        >
                          Disparar <ArrowRight size={11} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
                {prospects.length === 0 && (
                  <tr>
                    <td colSpan={7} className="bg-[#111113] px-3 py-12 text-center text-[13px] text-[#85817C]">
                      Nenhuma empresa pesquisada ainda. Digite uma cidade acima para o Agente IA buscar contatos novos com telefone.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'clientes' && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-[6px] border border-[#222225] bg-[#111113] p-3">
            <label className="relative min-w-[220px] flex-1">
              <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#85817C]" />
              <input
                value={crmQuery}
                onChange={(e) => setCrmQuery(e.target.value)}
                placeholder="Buscar cliente cadastrado..."
                aria-label="Buscar clientes"
                className="h-[36px] w-full rounded-[5px] border border-[#2A2A2E] bg-[#0B0B0C] pl-9 pr-3 text-[13px] text-[#ECE9E3] outline-none placeholder:text-[#85817C] focus:border-[#D7141F]"
              />
            </label>
            <FilterSelect
              ariaLabel="Faixa ICP"
              value={crmBand}
              onChange={setCrmBand}
              options={[
                { value: 'all', label: 'Todas as faixas ICP' },
                { value: 'qualificado', label: 'Qualificados (≥ 60)' },
                { value: 'nao', label: 'Não qualificados (< 60)' },
              ]}
            />
            <Segmented
              ariaLabel="Nicho"
              value={crmNiche}
              onChange={setCrmNiche}
              options={[
                { value: 'all', label: 'Todos' },
                { value: 'food', label: 'Food' },
                { value: 'health', label: 'Saúde' },
              ]}
            />
          </div>

          <div className="overflow-x-auto rounded-[6px] border border-[#222225]">
            <table className="w-full min-w-[760px] border-collapse text-left">
              <thead>
                <tr className="border-b border-[#1C1C1F] bg-[#0E0E10] font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-[#8E8A86]">
                  <th className="px-3 py-2.5">Cliente</th>
                  <th className="px-3 py-2.5">Nicho</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5">ICP</th>
                  <th className="px-3 py-2.5">Principais sinais</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {filteredClients.map((l) => (
                  <tr key={l.id} className="border-b border-[#18181B] bg-[#111113] text-[12px] last:border-b-0 hover:bg-[#131315]">
                    <td className="max-w-[260px] px-3 py-2.5">
                      <Link href={`${basePath}/sdr/lead/${l.id}`} className="block truncate text-[13px] font-semibold text-[#ECE9E3] hover:text-[#F0333D]">
                        {l.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5">
                      {l.niche ? <Pill tone={l.niche === 'food' ? 'red' : 'green'}>{NICHE_LABEL[l.niche]}</Pill> : <span className="text-[#85817C]">—</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusPill status={l.status} />
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-[#1D1D20]">
                          <div className={l.icpScore >= 60 ? 'h-full bg-[#22C55E]' : 'h-full bg-[#D7141F]'} style={{ width: `${l.icpScore}%` }} />
                        </div>
                        <span className="font-mono text-[#ECE9E3]">{Math.round(l.icpScore)}</span>
                      </div>
                    </td>
                    <td className="max-w-[340px] truncate px-3 py-2.5 text-[#8E8A86]">{l.icpEvidencias.slice(0, 3).join(' · ') || '—'}</td>
                    <td className="px-3 py-2.5 text-right">
                      <Link
                        href={`${basePath}/sdr/lead/${l.id}`}
                        aria-label={`Abrir ${l.name}`}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-[5px] text-[#8E8A86] hover:bg-white/[0.05] hover:text-white"
                      >
                        <ChevronRight size={15} />
                      </Link>
                    </td>
                  </tr>
                ))}
                {filteredClients.length === 0 && (
                  <tr>
                    <td colSpan={6} className="bg-[#111113] px-3 py-10 text-center text-[13px] text-[#85817C]">
                      {leads.length === 0 ? 'Nenhum cliente cadastrado neste workspace.' : 'Nenhum lead com esses filtros.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      <Toast message={toast} />
    </div>
  )
}
