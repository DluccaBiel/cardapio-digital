'use client'

import type { ReactNode } from 'react'
import type { ProspectClient } from '../../../lib/db/prospects'
import { STATUS_LABEL } from './format'
import { cn } from '../ui'

export { NICHE_LABEL, STATUS_LABEL, matchesTri, waNumber, instagramUrl, websiteUrl, formatBRL } from './format'
export type { NicheFilter, TriState } from './format'

export function PageHeader({ title, description, actions }: { title: string; description: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        <h1 className="uc-title text-[32px] text-[#F7F5F1] md:text-[40px]">{title}</h1>
        <p className="mt-1 text-[13px] text-[#8E8A86]">{description}</p>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Segmented<T extends string>({ value, onChange, options, ariaLabel }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; ariaLabel: string }) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="inline-flex rounded-[6px] border border-[#2A2A2E] bg-[#0B0B0C] p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-[5px] px-3 py-1.5 text-[12px] font-semibold transition-colors',
            value === o.value ? 'bg-[#D7141F] text-white' : 'text-[#8E8A86] hover:text-[#ECE9E3]',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function FilterSelect<T extends string>({ value, onChange, options, ariaLabel }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; ariaLabel: string }) {
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="h-[36px] cursor-pointer rounded-[5px] border border-[#2A2A2E] bg-[#0B0B0C] px-3 text-[13px] text-[#ECE9E3] outline-none focus:border-[#D7141F]"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

export function Pill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'red' | 'green' | 'amber' }) {
  const tones = {
    neutral: 'border-[#2A2A2E] bg-[#18181B] text-[#CFCBC4]',
    red: 'border-[#D7141F]/40 bg-[#D7141F]/15 text-[#F0333D]',
    green: 'border-[#22C55E]/35 bg-[#22C55E]/12 text-[#4ADE80]',
    amber: 'border-[#F59E0B]/35 bg-[#F59E0B]/12 text-[#FBBF24]',
  }
  return <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.08em]', tones[tone])}>{children}</span>
}

export function StatusPill({ status }: { status: ProspectClient['status'] }) {
  return <Pill tone={status === 'ativo' ? 'green' : status === 'pausado' ? 'amber' : 'neutral'}>{STATUS_LABEL[status] ?? status}</Pill>
}

export function MissingColumnsNotice() {
  return (
    <div className="mb-4 rounded-[6px] border border-[#F59E0B]/35 bg-[#F59E0B]/10 px-4 py-3 text-[12px] text-[#FBBF24]">
      As colunas <code>niche</code> e <code>website</code> ainda não existem neste banco — aplique a migration{' '}
      <code>20261116152908_add_client_niche_website.sql</code>. Até lá, o filtro de nicho/site não tem efeito.
    </div>
  )
}
