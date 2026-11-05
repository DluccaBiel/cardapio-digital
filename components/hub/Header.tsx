'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { brand } from '@orvia/brand'
import {
  Building2,
  Check,
  ChevronDown,
  Clock,
  Menu,
  RefreshCw,
  Search,
  X,
} from 'lucide-react'

const roleLabel = (role: string) =>
  ({ owner: 'OWNER', coordenador: 'COORDENADOR', editor: 'EDITOR', visualizador: 'VISUALIZADOR' })[role] ?? role.toUpperCase()

export function Header({
  workspace,
  role,
  workspaces,
  userInitial,
  onOpenSidebar,
  onOpenSearch,
  demo = false,
}: {
  workspace: { name: string; slug: string }
  role: string
  workspaces: { name: string; slug: string; role: string }[]
  userInitial: string
  onOpenSidebar: () => void
  onOpenSearch: () => void
  demo?: boolean
}) {
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [soon, setSoon] = useState(false)
  const switcherRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (switcherRef.current && !switcherRef.current.contains(event.target as Node)) setSwitcherOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSwitcherOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  useEffect(() => {
    if (!soon) return
    const timer = setTimeout(() => setSoon(false), 2800)
    return () => clearTimeout(timer)
  }, [soon])

  return (
    <header className="relative z-30 flex h-[64px] shrink-0 items-center justify-between gap-3 border-b border-[#1A2231] bg-[#080C14] px-3 sm:px-5 md:h-[80px]">
      <div className="flex min-w-0 items-center gap-2 sm:gap-4 md:gap-6">
        <button
          type="button"
          onClick={onOpenSidebar}
          aria-label="Abrir menu"
          className="rounded-lg p-2 text-[#9AA8BD] hover:bg-white/[0.04] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3D8EFF] md:hidden"
        >
          <Menu size={20} />
        </button>

        <Link href="/" className="flex shrink-0 items-center gap-3 hover:no-underline" aria-label={`${brand.name} — início`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/orvia-mark.svg" alt="" width={38} height={38} className="h-[34px] w-[34px] md:h-[38px] md:w-[38px]" />
          <span className="hidden flex-col leading-none sm:flex">
            <span className="text-[19px] font-extrabold tracking-[-0.045em] text-[#F1F5FC] md:text-[22px]">{brand.name}</span>
            <span className="mt-1 text-[8px] font-bold uppercase tracking-[0.2em] text-[#D4AF37] md:text-[9px]">
              {brand.tagline}
            </span>
          </span>
        </Link>

        <div className="h-9 w-px bg-[#1A2231] max-md:hidden" aria-hidden="true" />

        <div ref={switcherRef} className="relative min-w-0">
          <button
            type="button"
            onClick={() => !demo && setSwitcherOpen((value) => !value)}
            aria-haspopup={demo ? undefined : 'menu'}
            aria-expanded={demo ? undefined : switcherOpen}
            title={demo ? 'Workspace fictício de demonstração' : 'Trocar workspace'}
            className={[
              'flex h-[38px] max-w-[134px] items-center gap-2 rounded-[10px] border border-[#26314A] bg-[#0C1220] px-2.5 text-left sm:max-w-[180px] sm:px-3 md:max-w-[210px]',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3D8EFF]',
              demo ? 'cursor-default' : 'hover:border-[#3D8EFF]/60 hover:bg-[#111A2E]',
            ].join(' ')}
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#3D8EFF]/15 text-[#6EA8FF]">
              <Building2 size={14} strokeWidth={2} />
            </span>
            <span className="truncate text-[14px] font-semibold text-[#E8EDF7]">{workspace.name}</span>
            {demo ? (
              <span className="ml-1 hidden rounded border border-[#3D8EFF]/40 px-1 py-0.5 text-[8px] font-bold tracking-widest text-[#6EA8FF] sm:inline">DEMO</span>
            ) : (
              <ChevronDown size={14} className="ml-1 shrink-0 text-[#7F8CA3]" />
            )}
          </button>

          {switcherOpen && !demo && (
            <div
              role="menu"
              className="absolute left-0 top-[46px] z-40 w-[260px] overflow-hidden rounded-xl border border-[#26314A] bg-[#0C1220] p-1.5 shadow-2xl"
            >
              {workspaces.map((item) => {
                const active = item.slug === workspace.slug
                return (
                  <Link
                    key={item.slug}
                    role="menuitem"
                    href={`/a/${item.slug}/visao-geral`}
                    onClick={() => setSwitcherOpen(false)}
                    className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm text-[#C9D3E3] no-underline hover:bg-[#141D2E] hover:text-white hover:no-underline"
                  >
                    <span className="truncate">{item.name}</span>
                    {active && <Check size={14} className="text-[#3D8EFF]" />}
                  </Link>
                )
              })}
              <p className="mt-1 border-t border-[#1A2231] px-3 pb-1 pt-2 text-[10px] uppercase tracking-widest text-[#7C8AA1]">
                {workspaces.length} workspace{workspaces.length === 1 ? '' : 's'}
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 xl:gap-3">
        <div className="hidden items-center gap-2 text-[13px] text-[#A9B4C7] lg:flex">
          <span className="h-[7px] w-[7px] rounded-full bg-[#34D399] shadow-[0_0_10px_rgba(52,211,153,0.7)]" aria-hidden="true" />
          <Clock size={14} strokeWidth={1.8} className="text-[#7F8CA3]" />
          <span>Atualizado há instantes</span>
        </div>

        <div className="relative">
          <button
            type="button"
            onClick={() => setSoon(true)}
            title="Sincronização disponível na próxima fase"
            className="flex h-[44px] items-center gap-2 rounded-[10px] bg-[#3D8EFF] px-4 text-[14px] font-bold text-[#06101F] transition-colors hover:bg-[#6EA8FF] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#6EA8FF] focus-visible:ring-offset-2 focus-visible:ring-offset-[#080C14]"
          >
            <RefreshCw size={17} strokeWidth={2.2} />
            <span className="hidden sm:inline">Sincronizar</span>
          </button>
          {soon && (
            <div role="status" className="absolute right-0 top-[52px] z-50 w-[230px] rounded-lg border border-[#26314A] bg-[#0C1220] px-3 py-2 text-[11px] text-[#C9D3E3] shadow-2xl">
              Sincronização simulada — integração real na próxima fase.
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onOpenSearch}
          aria-label="Buscar cliente (Ctrl K)"
          className="flex h-[44px] w-[44px] items-center justify-center gap-2 rounded-[10px] border border-[#26314A] bg-[#0C1220] text-[#8A97AC] transition-colors hover:border-[#3D8EFF]/50 hover:text-[#C9D3E3] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3D8EFF] xl:w-[228px] xl:justify-start xl:px-3"
        >
          <Search size={17} strokeWidth={1.8} />
          <span className="hidden flex-1 text-left text-[13px] xl:inline">Buscar cliente…</span>
          <kbd className="hidden rounded-[5px] border border-[#2A3549] bg-[#141C2B] px-1.5 py-0.5 text-[9px] font-semibold tracking-wide text-[#7F8CA3] xl:inline-block">
            ctrl K
          </kbd>
        </button>

        <span className="hidden rounded-md border border-[#D4AF37]/60 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[#E7C45A] xl:inline-block">
          {roleLabel(role)}
        </span>

        <div
          className="flex h-[34px] w-[34px] items-center justify-center rounded-full border border-[#2A3549] bg-[#182134] text-[12px] font-bold text-[#E8EDF7]"
          aria-label="Avatar do usuário"
          title="Você"
        >
          {userInitial}
        </div>
      </div>
    </header>
  )
}
