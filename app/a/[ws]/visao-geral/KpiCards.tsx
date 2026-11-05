'use client'

import Link from 'next/link'
import { formatBRL } from '../../../../lib/format'

function monthName(iso: string): string {
  const d = new Date(iso)
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
  return `${MESES[d.getUTCMonth()]} de ${d.getUTCFullYear()}`
}

function monthShift(iso: string, delta: number): string {
  const d = new Date(iso)
  d.setUTCMonth(d.getUTCMonth() + delta)
  return `${d.toISOString().slice(0, 7)}-01`
}

export function KpiCards(props:
  | { variant: 'clientes'; value: string; sub: string }
  | { variant: 'gasto'; month: string; value: number; sub: string }
) {
  if (props.variant === 'clientes') {
    return (
      <section className="rounded-2xl border border-[#1C2A47] bg-[#111A2E] p-6">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] font-bold uppercase tracking-widest text-[#8FA0C4]">Clientes ativos</p>
          <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#1C2A47] bg-[#070B14] text-[#3D8EFF]" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5"><circle cx="9" cy="7" r="4"/><path d="M2 21c0-3.3 3.1-5.5 7-5.5s7 2.2 7 5.5"/><path d="M16 3.1a4 4 0 0 1 0 7.8M21 19.5c0-2-1.2-3.4-3-4.3"/></svg>
          </span>
        </div>
        <p className="mt-3 text-4xl font-extrabold tracking-tight text-[#E6ECFA]">{props.value}</p>
        <p className="mt-1 text-xs text-[#8FA0C4]">{props.sub}</p>
      </section>
    )
  }

  const prev = monthShift(props.month, -1)
  const next = monthShift(props.month, +1)
  const label = monthName(props.month)

  return (
    <section className="rounded-2xl border border-[#1C2A47] bg-[#111A2E] p-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-bold uppercase tracking-widest text-[#8FA0C4]">Gasto ({label})</p>
        <div className="flex items-center gap-1">
          <Link href={`?month=${prev}`} aria-label="Mês anterior" className="rounded-md p-1.5 text-[#8FA0C4] hover:bg-[#0B1220] hover:text-[#E6ECFA]">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5"><path d="M15 6l-6 6 6 6"/></svg>
          </Link>
          <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#1C2A47] bg-[#070B14] text-[#3D8EFF]" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
          </span>
          <Link href={`?month=${next}`} aria-label="Próximo mês" className="rounded-md p-1.5 text-[#8FA0C4] hover:bg-[#0B1220] hover:text-[#E6ECFA]">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5"><path d="M9 6l6 6-6 6"/></svg>
          </Link>
        </div>
      </div>
      <p className="mt-3 text-4xl font-extrabold tracking-tight text-[#E6ECFA]">{formatBRL(props.value)}</p>
      <p className="mt-1 text-xs text-[#8FA0C4]">{props.sub}</p>
    </section>
  )
}
