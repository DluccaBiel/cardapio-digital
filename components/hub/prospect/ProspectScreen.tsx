'use client'

import { useMemo, useState, useTransition } from 'react'
import { AtSign, Globe, Loader2, Search, Sparkles, X } from 'lucide-react'
import type { ProspectClient } from '../../../lib/db/prospects'
import { researchClientAction } from '../../../app/a/[ws]/clientes-prospecao/actions'
import { Toast } from '../ui'
import {
  FilterSelect,
  formatBRL,
  instagramUrl,
  matchesTri,
  MissingColumnsNotice,
  NICHE_LABEL,
  PageHeader,
  Pill,
  Segmented,
  StatusPill,
  websiteUrl,
  type NicheFilter,
  type TriState,
} from './shared'

type ResearchResult = Extract<Awaited<ReturnType<typeof researchClientAction>>, { ok: true }>['data']

export function ProspectScreen({ ws, clients, missingColumns }: { ws: string; clients: ProspectClient[]; missingColumns: boolean }) {
  const [niche, setNiche] = useState<NicheFilter>('all')
  const [status, setStatus] = useState<'all' | ProspectClient['status']>('all')
  const [site, setSite] = useState<TriState>('all')
  const [insta, setInsta] = useState<TriState>('all')
  const [query, setQuery] = useState('')
  const [toast, setToast] = useState<string | null>(null)
  const [research, setResearch] = useState<{ client: ProspectClient; data: ResearchResult } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return clients.filter(
      (c) =>
        (niche === 'all' || c.niche === niche) &&
        (status === 'all' || c.status === status) &&
        matchesTri(c.website, site) &&
        matchesTri(c.instagram, insta) &&
        (!q || c.name.toLowerCase().includes(q)),
    )
  }, [clients, niche, status, site, insta, query])

  function flash(message: string) {
    setToast(message)
    window.setTimeout(() => setToast(null), 3500)
  }

  function runResearch(client: ProspectClient) {
    setBusyId(client.id)
    startTransition(async () => {
      const result = await researchClientAction(ws, { clientId: client.id })
      setBusyId(null)
      if (!result.ok) return flash(result.error)
      setResearch({ client, data: result.data })
    })
  }

  return (
    <div className="mx-auto w-full max-w-[1920px] px-4 pb-10 pt-5 sm:px-6 md:px-[30px] md:pt-[26px]">
      <PageHeader
        title="Prospecção de clientes"
        description="Filtre a base por nicho, status e presença digital; peça uma análise pública com IA."
        actions={
          <Segmented
            ariaLabel="Nicho"
            value={niche}
            onChange={setNiche}
            options={[
              { value: 'all', label: 'Todos' },
              { value: 'food', label: 'Food' },
              { value: 'health', label: 'Saúde' },
            ]}
          />
        }
      />

      {missingColumns && <MissingColumnsNotice />}

      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-[6px] border border-[#222225] bg-[#111113] p-3">
        <label className="relative min-w-[220px] flex-1">
          <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#85817C]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nome..."
            aria-label="Buscar clientes"
            className="h-[36px] w-full rounded-[5px] border border-[#2A2A2E] bg-[#0B0B0C] pl-9 pr-3 text-[13px] text-[#ECE9E3] outline-none placeholder:text-[#85817C] focus:border-[#D7141F]"
          />
        </label>
        <FilterSelect
          ariaLabel="Status"
          value={status}
          onChange={setStatus}
          options={[
            { value: 'all', label: 'Todos os status' },
            { value: 'ativo', label: 'Ativo' },
            { value: 'pausado', label: 'Pausado' },
            { value: 'encerrado', label: 'Encerrado' },
          ]}
        />
        <FilterSelect
          ariaLabel="Website"
          value={site}
          onChange={setSite}
          options={[
            { value: 'all', label: 'Com/sem site' },
            { value: 'yes', label: 'Tem site' },
            { value: 'no', label: 'Sem site' },
          ]}
        />
        <FilterSelect
          ariaLabel="Instagram"
          value={insta}
          onChange={setInsta}
          options={[
            { value: 'all', label: 'Com/sem Instagram' },
            { value: 'yes', label: 'Tem Instagram' },
            { value: 'no', label: 'Sem Instagram' },
          ]}
        />
        <span className="ml-auto font-mono text-[11px] text-[#85817C]">
          {filtered.length} de {clients.length}
        </span>
      </div>

      <div className="overflow-x-auto rounded-[6px] border border-[#222225]">
        <table className="w-full min-w-[960px] border-collapse text-left">
          <thead>
            <tr className="border-b border-[#1C1C1F] bg-[#0E0E10] font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-[#8E8A86]">
              <th className="px-3 py-2.5">Cliente</th>
              <th className="px-3 py-2.5">Telefone</th>
              <th className="px-3 py-2.5">E-mail</th>
              <th className="px-3 py-2.5 text-right">Honorário</th>
              <th className="px-3 py-2.5">Instagram</th>
              <th className="px-3 py-2.5">Site</th>
              <th className="px-3 py-2.5">Nicho</th>
              <th className="px-3 py-2.5">Status</th>
              <th className="px-3 py-2.5 text-right">IA</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => {
              const site = c.website ? websiteUrl(c.website) : null
              return (
                <tr key={c.id} className="border-b border-[#18181B] bg-[#111113] text-[12px] last:border-b-0 hover:bg-[#131315]">
                  <td className="max-w-[260px] px-3 py-2.5">
                    <span className="block truncate text-[13px] font-semibold text-[#ECE9E3]">{c.name}</span>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[#CFCBC4]">{c.whatsapp || c.phone || '—'}</td>
                  <td className="px-3 py-2.5">
                    {c.email ? (
                      <a href={`mailto:${c.email}`} className="font-mono text-[11px] text-[#8B837E] hover:text-white">
                        {c.email}
                      </a>
                    ) : (
                      <span className="text-[#85817C]">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-[#ECE9E3]">{formatBRL(c.monthly_fee)}</td>
                  <td className="px-3 py-2.5">
                    {c.instagram ? (
                      <a href={instagramUrl(c.instagram)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[#CFCBC4] hover:text-[#F0333D]">
                        <AtSign size={12} /> {c.instagram.replace(/^@/, '')}
                      </a>
                    ) : (
                      <span className="text-[#85817C]">—</span>
                    )}
                  </td>
                  <td className="max-w-[200px] px-3 py-2.5">
                    {site ? (
                      <a href={site} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1 truncate text-[#CFCBC4] hover:text-[#F0333D]">
                        <Globe size={12} /> <span className="truncate">{c.website}</span>
                      </a>
                    ) : (
                      <span className="text-[#85817C]">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">{c.niche ? <Pill tone={c.niche === 'food' ? 'red' : 'green'}>{NICHE_LABEL[c.niche]}</Pill> : <span className="text-[#85817C]">—</span>}</td>
                  <td className="px-3 py-2.5">
                    <StatusPill status={c.status} />
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <button
                      type="button"
                      onClick={() => runResearch(c)}
                      disabled={busyId !== null}
                      title="Pesquisar com IA"
                      aria-label={`Pesquisar ${c.name} com IA`}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-[5px] text-[#8E8A86] transition-colors hover:bg-white/[0.05] hover:text-[#F0333D] disabled:opacity-40"
                    >
                      {busyId === c.id ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
                    </button>
                  </td>
                </tr>
              )
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="bg-[#111113] px-3 py-10 text-center text-[13px] text-[#85817C]">
                  {clients.length === 0 ? 'Nenhum cliente cadastrado neste workspace.' : 'Nenhum cliente com esses filtros.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {research && (
        <section className="mt-6 rounded-[6px] border border-[#222225] bg-[#111113] p-5" aria-label="Resultado da pesquisa">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="uc-title text-[20px] text-[#F7F5F1]">Análise · {research.client.name}</h2>
              <p className="mt-0.5 text-[11px] text-[#8E8A86]">
                Pesquisa feita pelo Undercut em fontes públicas · {new Date(research.data.answered_at).toLocaleString('pt-BR')}
              </p>
            </div>
            <button type="button" onClick={() => setResearch(null)} aria-label="Fechar análise" className="rounded-md p-1 text-[#86827D] hover:bg-white/[0.05] hover:text-white">
              <X size={16} />
            </button>
          </div>
          {research.data.notices.length > 0 && (
            <div className="mt-3 rounded-[5px] border border-[#D7141F]/40 bg-[#D7141F]/10 p-3 text-[11px] text-[#FFB199]">{research.data.notices.join(' · ')}</div>
          )}
          <p className="mt-3 whitespace-pre-wrap text-[13px] leading-relaxed text-[#CFCBC4]">{research.data.answer}</p>
          {research.data.sources.length > 0 && (
            <ol className="mt-4 space-y-1 text-[11px]">
              {research.data.sources.map((s, i) => (
                <li key={s.url}>
                  <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-[#CFCBC4] underline hover:text-[#F0333D]">
                    {i + 1}. {s.title}
                  </a>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      <Toast message={toast} />
    </div>
  )
}
