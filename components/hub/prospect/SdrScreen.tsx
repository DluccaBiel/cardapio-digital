'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { ChevronRight, Search } from 'lucide-react'
import type { ProspectClient } from '../../../lib/db/prospects'
import { FilterSelect, MissingColumnsNotice, NICHE_LABEL, PageHeader, Pill, Segmented, StatusPill, type NicheFilter } from './shared'

export type SdrLead = ProspectClient & { icpScore: number; icpEvidencias: string[] }

export function SdrScreen({ basePath, leads, missingColumns }: { basePath: string; leads: SdrLead[]; missingColumns: boolean }) {
  const [niche, setNiche] = useState<NicheFilter>('all')
  const [band, setBand] = useState<'all' | 'qualificado' | 'nao'>('all')
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return leads
      .filter(
        (l) =>
          (niche === 'all' || l.niche === niche) &&
          (band === 'all' || (band === 'qualificado' ? l.icpScore >= 60 : l.icpScore < 60)) &&
          (!q || l.name.toLowerCase().includes(q)),
      )
      .sort((a, b) => b.icpScore - a.icpScore)
  }, [leads, niche, band, query])

  const qualified = leads.filter((l) => l.icpScore >= 60).length

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 pb-10 pt-5 sm:px-6 md:px-[30px] md:pt-[26px]">
      <PageHeader
        title="SDR · Leads"
        description="Pontuação ICP (0–100) calculada por regras determinísticas a partir dos dados cadastrados — sem números inventados."
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

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        {[
          { label: 'Leads', value: leads.length },
          { label: 'Qualificados (ICP ≥ 60)', value: qualified },
          { label: 'A enriquecer', value: leads.length - qualified },
        ].map((k) => (
          <div key={k.label} className="rounded-[6px] border border-[#222225] bg-[#111113] px-4 py-3">
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-[#8E8A86]">{k.label}</p>
            <p className="uc-title mt-1 text-[28px] text-[#F7F5F1]">{k.value}</p>
          </div>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-[6px] border border-[#222225] bg-[#111113] p-3">
        <label className="relative min-w-[220px] flex-1">
          <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#85817C]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar lead..."
            aria-label="Buscar leads"
            className="h-[36px] w-full rounded-[5px] border border-[#2A2A2E] bg-[#0B0B0C] pl-9 pr-3 text-[13px] text-[#ECE9E3] outline-none placeholder:text-[#85817C] focus:border-[#D7141F]"
          />
        </label>
        <FilterSelect
          ariaLabel="Faixa ICP"
          value={band}
          onChange={setBand}
          options={[
            { value: 'all', label: 'Todas as faixas ICP' },
            { value: 'qualificado', label: 'Qualificados (≥ 60)' },
            { value: 'nao', label: 'Não qualificados (< 60)' },
          ]}
        />
      </div>

      <div className="overflow-x-auto rounded-[6px] border border-[#222225]">
        <table className="w-full min-w-[760px] border-collapse text-left">
          <thead>
            <tr className="border-b border-[#1C1C1F] bg-[#0E0E10] font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-[#8E8A86]">
              <th className="px-3 py-2.5">Lead</th>
              <th className="px-3 py-2.5">Nicho</th>
              <th className="px-3 py-2.5">Status</th>
              <th className="px-3 py-2.5">ICP</th>
              <th className="px-3 py-2.5">Principais sinais</th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((l) => (
              <tr key={l.id} className="border-b border-[#18181B] bg-[#111113] text-[12px] last:border-b-0 hover:bg-[#131315]">
                <td className="max-w-[260px] px-3 py-2.5">
                  <Link href={`${basePath}/sdr/lead/${l.id}`} className="block truncate text-[13px] font-semibold text-[#ECE9E3] hover:text-[#F0333D]">
                    {l.name}
                  </Link>
                </td>
                <td className="px-3 py-2.5">{l.niche ? <Pill tone={l.niche === 'food' ? 'red' : 'green'}>{NICHE_LABEL[l.niche]}</Pill> : <span className="text-[#85817C]">—</span>}</td>
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
                  <Link href={`${basePath}/sdr/lead/${l.id}`} aria-label={`Abrir ${l.name}`} className="inline-flex h-8 w-8 items-center justify-center rounded-[5px] text-[#8E8A86] hover:bg-white/[0.05] hover:text-white">
                    <ChevronRight size={15} />
                  </Link>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="bg-[#111113] px-3 py-10 text-center text-[13px] text-[#85817C]">
                  {leads.length === 0 ? 'Nenhum cliente cadastrado neste workspace.' : 'Nenhum lead com esses filtros.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
