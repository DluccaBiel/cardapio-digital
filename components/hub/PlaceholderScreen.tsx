'use client'

import { ArrowRight, CalendarDays, Construction, Puzzle, Sparkles, UtensilsCrossed } from 'lucide-react'

const ICONS = {
  calendar: CalendarDays,
  utensils: UtensilsCrossed,
  puzzle: Puzzle,
}

export function PlaceholderScreen({
  title,
  badge,
  description,
  icon,
  bullets,
  workspaceName,
}: {
  title: string
  badge: string
  description: string
  icon: keyof typeof ICONS
  bullets: string[]
  workspaceName: string
}) {
  const Icon = ICONS[icon]
  return (
    <div className="mx-auto w-full max-w-[1720px] px-4 pb-10 pt-5 sm:px-6 md:px-[30px] md:pt-[26px]">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-[26px] font-extrabold leading-tight tracking-[-0.03em] text-[#F1F5FC] md:text-[28px]">{title}</h1>
        <span className="rounded-full border border-[#3D8EFF]/45 bg-[#3D8EFF]/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[#6EA8FF]">
          {badge}
        </span>
      </div>
      <p className="mt-1.5 max-w-2xl text-[13px] text-[#8A97AC]">
        {description} · <span className="text-[#C9D3E3]">{workspaceName}</span>
      </p>

      <div className="mt-6 overflow-hidden rounded-2xl border border-[#1E2738] bg-[#0D1320]">
        <div className="relative flex flex-col items-center px-6 py-12 text-center md:py-16">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-56 bg-[radial-gradient(ellipse_at_top,rgba(61,142,255,0.09),transparent_65%)]" />
          <span className="relative flex h-16 w-16 items-center justify-center rounded-2xl border border-[#3D8EFF]/35 bg-[#3D8EFF]/10 text-[#3D8EFF]">
            <Icon size={30} strokeWidth={1.5} />
          </span>
          <span className="mt-5 inline-flex items-center gap-1.5 rounded-full border border-[#26314A] bg-[#080D18] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.13em] text-[#8A97AC]">
            <Construction size={11} />
            Em construção nesta fase
          </span>
          <h2 className="relative mt-4 text-[18px] font-bold text-[#E8EDF7]">Módulo {title.toLowerCase()} em preparação</h2>
          <p className="relative mt-1.5 max-w-md text-[12px] leading-relaxed text-[#8A97AC]">
            Esta é uma entrega visual. A estrutura, os estados e a navegação já estão no lugar — a lógica chega nas próximas fases.
          </p>

          <div className="relative mt-7 grid w-full max-w-2xl gap-2 sm:grid-cols-2">
            {bullets.map((bullet) => (
              <div
                key={bullet}
                className="flex items-center justify-between gap-3 rounded-xl border border-[#1E2738] bg-[#080D18] px-4 py-3 text-left"
              >
                <span className="flex items-center gap-2 text-[12px] text-[#C9D3E3]">
                  <Sparkles size={13} className="shrink-0 text-[#D4AF37]" />
                  {bullet}
                </span>
                <ArrowRight size={13} className="shrink-0 text-[#3B4659]" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
