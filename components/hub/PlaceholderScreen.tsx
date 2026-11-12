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
        <h1 className="uc-title text-[32px] text-[#F7F5F1] md:text-[40px]">{title}</h1>
        <span className="rounded-full border border-[#D7141F]/45 bg-[#D7141F]/10 px-3 py-1 text-[10px] font-bold font-mono uppercase tracking-[0.12em] text-[#F0333D]">
          {badge}
        </span>
      </div>
      <p className="mt-1.5 max-w-2xl text-[13px] text-[#8E8A86]">
        {description} · <span className="text-[#CFCBC4]">{workspaceName}</span>
      </p>

      <div className="mt-6 overflow-hidden rounded-[8px] border border-[#222225] bg-[#111113]">
        <div className="relative flex flex-col items-center px-6 py-12 text-center md:py-16">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-56 bg-[radial-gradient(ellipse_at_top,rgba(215, 20, 31,0.09),transparent_65%)]" />
          <span className="relative flex h-16 w-16 items-center justify-center rounded-[8px] border border-[#D7141F]/35 bg-[#D7141F]/10 text-[#D7141F]">
            <Icon size={30} strokeWidth={1.5} />
          </span>
          <span className="mt-5 inline-flex items-center gap-1.5 rounded-full border border-[#2A2A2E] bg-[#0B0B0C] px-3 py-1 text-[10px] font-bold font-mono uppercase tracking-[0.13em] text-[#8E8A86]">
            <Construction size={11} />
            Em construção nesta fase
          </span>
          <h2 className="relative mt-4 text-[18px] font-bold text-[#ECE9E3]">Módulo {title.toLowerCase()} em preparação</h2>
          <p className="relative mt-1.5 max-w-md text-[12px] leading-relaxed text-[#8E8A86]">
            Esta é uma entrega visual. A estrutura, os estados e a navegação já estão no lugar — a lógica chega nas próximas fases.
          </p>

          <div className="relative mt-7 grid w-full max-w-2xl gap-2 sm:grid-cols-2">
            {bullets.map((bullet) => (
              <div
                key={bullet}
                className="flex items-center justify-between gap-3 rounded-[6px] border border-[#222225] bg-[#0B0B0C] px-4 py-3 text-left"
              >
                <span className="flex items-center gap-2 text-[12px] text-[#CFCBC4]">
                  <Sparkles size={13} className="shrink-0 text-[#C8C2B8]" />
                  {bullet}
                </span>
                <ArrowRight size={13} className="shrink-0 text-[#3D3D43]" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
