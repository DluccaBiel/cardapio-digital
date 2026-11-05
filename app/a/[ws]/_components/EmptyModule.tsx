import type { SVGProps } from 'react'

export function EmptyModule({
  title,
  description,
  badge = 'Em breve',
  children,
}: {
  title: string
  description?: string
  badge?: string
  children?: React.ReactNode
}) {
  return (
    <section className="mx-auto max-w-5xl px-6 py-10">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight text-[#E6ECFA]">{title}</h1>
        <span className="rounded-full border border-[#1C2A47] bg-[#111A2E] px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-[#3D8EFF]">{badge}</span>
      </div>
      {description && <p className="mt-1 max-w-2xl text-sm text-[#8FA0C4]">{description}</p>}
      <div className="mt-8 rounded-2xl border border-dashed border-[#1C2A47] bg-[#0B1220]/60 p-10">
        {children ?? (
          <div className="flex min-h-[220px] flex-col items-center justify-center text-center">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-12 w-12 text-[#1C2A47]" aria-hidden="true">
              <path d="M3 7h18M3 12h18M3 17h10" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <p className="mt-4 text-sm font-semibold text-[#E6ECFA]">Módulo em construção</p>
            <p className="mt-1 max-w-sm text-xs text-[#8FA0C4]">Este módulo será liberado conforme os marcos do roadmap. Acompanhe o progresso em docs/roadmap-fase-1.md.</p>
          </div>
        )}
      </div>
    </section>
  )
}

export function ModuleIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className={className} {...props}>
      <path d="M4 7h16M4 12h16M4 17h10" />
    </svg>
  )
}
