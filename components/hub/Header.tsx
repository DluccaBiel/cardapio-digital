'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { brand } from '@undercut/brand'
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

/** Evento global do botão "Sincronizar" do header (cancelable: a tela que tratar chama preventDefault). */
export const SYNC_EVENT = 'undercut:sync'

const roleLabel =(role: string) =>
  ({ owner: 'OWNER', coordenador: 'COORDENADOR', editor: 'EDITOR', visualizador: 'VISUALIZADOR' })[role] ?? role.toUpperCase()

export function Header({
  workspace,
  role,
  workspaces,
  userInitial,
  onOpenSidebar,
  onOpenSearch,
  demo = false,
  live = false,
}: {
  workspace: { name: string; slug: string }
  role: string
  workspaces: { name: string; slug: string; role: string }[]
  userInitial: string
  onOpenSidebar: () => void
  onOpenSearch: () => void
  demo?: boolean
  /** true somente quando TODAS as extensões cadastradas estão conectadas agora. */
  live?: boolean
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
    <header className="relative z-30 flex h-[64px] shrink-0 items-center justify-between gap-3 border-b border-[#1C1C1F] bg-[#09090A]/95 px-3 backdrop-blur sm:px-5 md:h-[72px]">
      <div className="uc-telemetry-bar absolute inset-x-0 bottom-[-1px]" aria-hidden="true" />
      <div className="flex min-w-0 items-center gap-2 sm:gap-4 md:gap-6">
        <button
          type="button"
          onClick={onOpenSidebar}
          aria-label="Abrir menu"
          className="rounded-[5px] p-2 text-[#9F9A94] hover:bg-white/[0.04] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D7141F] md:hidden"
        >
          <Menu size={20} />
        </button>

        <Link href="/" className="group flex shrink-0 items-center gap-3 hover:no-underline" aria-label={`${brand.name} — início`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={brand.logos.mark} alt="" width={34} height={34} className="h-[32px] w-[32px] rounded-[7px] sm:hidden" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={brand.logos.logoWhite} alt="" width={150} height={26} className="hidden h-[22px] w-auto transition-transform duration-300 group-hover:translate-x-0.5 sm:block md:h-[30px]" />
          <span className="hidden flex-col border-l border-[#2A2A2E] pl-3 font-mono text-[9px] uppercase leading-[1.5] tracking-[0.22em] text-[#8E8A86] lg:flex">
            <span>{brand.tagline}</span>
            <span className="text-[#55555C]">Hub · v{brand.version}</span>
          </span>
        </Link>

        <div className="h-9 w-px rotate-[14deg] bg-[#2A2A2E] max-md:hidden" aria-hidden="true" />

        <div ref={switcherRef} className="relative min-w-0">
          <button
            type="button"
            onClick={() => !demo && setSwitcherOpen((value) => !value)}
            aria-haspopup={demo ? undefined : 'menu'}
            aria-expanded={demo ? undefined : switcherOpen}
            title={demo ? 'Workspace fictício de demonstração' : 'Trocar workspace'}
            className={[
              'flex h-[38px] max-w-[134px] items-center gap-2 rounded-[4px] border border-[#2A2A2E] bg-[#0F0F11] px-2.5 text-left sm:max-w-[180px] sm:px-3 md:max-w-[210px]',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D7141F]',
              demo ? 'cursor-default' : 'hover:border-[#D7141F]/60 hover:bg-[#161618]',
            ].join(' ')}
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#D7141F]/15 text-[#F0333D]">
              <Building2 size={14} strokeWidth={2} />
            </span>
            <span className="truncate text-[14px] font-semibold text-[#ECE9E3]">{workspace.name}</span>
            {demo ? (
              <span className="ml-1 hidden rounded border border-[#D7141F]/40 px-1 py-0.5 text-[8px] font-bold tracking-widest text-[#F0333D] sm:inline">DEMO</span>
            ) : (
              <ChevronDown size={14} className="ml-1 shrink-0 text-[#86827D]" />
            )}
          </button>

          {switcherOpen && !demo && (
            <div
              role="menu"
              className="absolute left-0 top-[46px] z-40 w-[260px] overflow-hidden rounded-[6px] border border-[#2A2A2E] bg-[#0F0F11] p-1.5 shadow-2xl"
            >
              {workspaces.map((item) => {
                const active = item.slug === workspace.slug
                return (
                  <Link
                    key={item.slug}
                    role="menuitem"
                    href={`/a/${item.slug}/visao-geral`}
                    onClick={() => setSwitcherOpen(false)}
                    className="flex items-center justify-between gap-2 rounded-[5px] px-3 py-2 text-sm text-[#CFCBC4] no-underline hover:bg-[#18181B] hover:text-white hover:no-underline"
                  >
                    <span className="truncate">{item.name}</span>
                    {active && <Check size={14} className="text-[#D7141F]" />}
                  </Link>
                )
              })}
              <p className="mt-1 border-t border-[#1C1C1F] px-3 pb-1 pt-2 text-[10px] font-mono uppercase tracking-widest text-[#85817C]">
                {workspaces.length} workspace{workspaces.length === 1 ? '' : 's'}
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 xl:gap-3">
        <div className="hidden items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] lg:flex">
          {live ? (
            <>
              <span className="h-[7px] w-[7px] animate-uc-pulse rounded-full bg-[#34D399] shadow-[0_0_10px_rgba(52,211,153,0.7)]" aria-hidden="true" />
              <Clock size={13} strokeWidth={1.8} className="text-[#86827D]" />
              <span className="text-[#ADA8A1]">Ao vivo · há instantes</span>
            </>
          ) : (
            <>
              <span className="h-[7px] w-[7px] rounded-full bg-[#55555C]" aria-hidden="true" />
              <Clock size={13} strokeWidth={1.8} className="text-[#86827D]" />
              <span className="text-[#86827D]">Sem contato de todas as extensões</span>
            </>
          )}
        </div>

        <div className="relative">
          <button
            type="button"
            onClick={() => {
              // A tela atual pode tratar a sincronização (ex.: Extensões → checa a conexão)
              // chamando event.preventDefault(); se ninguém tratar, mostra o aviso de "simulada".
              const handled = !window.dispatchEvent(new CustomEvent(SYNC_EVENT, { cancelable: true }))
              if (!handled) setSoon(true)
            }}
            title="Sincronizar"
            className="uc-cut flex h-[42px] items-center gap-2 bg-[#D7141F] px-4 font-mono text-[12px] font-bold font-mono uppercase tracking-[0.12em] text-[#FFFFFF] transition-[background-color,box-shadow] [--cut:10px] hover:bg-[#F0333D] hover:shadow-[0_0_24px_rgba(215,20,31,0.45)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F0333D] focus-visible:ring-offset-2 focus-visible:ring-offset-[#09090A]"
          >
            <RefreshCw size={17} strokeWidth={2.2} />
            <span className="hidden sm:inline">Sincronizar</span>
          </button>
          {soon && (
            <div role="status" className="absolute right-0 top-[52px] z-50 w-[230px] rounded-[5px] border border-[#2A2A2E] bg-[#0F0F11] px-3 py-2 text-[11px] text-[#CFCBC4] shadow-2xl">
              Sincronização simulada — integração real na próxima fase.
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onOpenSearch}
          aria-label="Buscar cliente (Ctrl K)"
          className="flex h-[42px] w-[42px] items-center justify-center gap-2 rounded-[4px] border border-[#2A2A2E] bg-[#0F0F11] text-[#8E8A86] transition-colors hover:border-[#D7141F]/50 hover:text-[#CFCBC4] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D7141F] xl:w-[228px] xl:justify-start xl:px-3"
        >
          <Search size={17} strokeWidth={1.8} />
          <span className="hidden flex-1 text-left font-mono text-[11px] font-mono uppercase tracking-[0.1em] xl:inline">Buscar cliente…</span>
          <kbd className="hidden rounded-[5px] border border-[#2E2E33] bg-[#18181A] px-1.5 py-0.5 text-[9px] font-semibold tracking-wide text-[#86827D] xl:inline-block">
            ctrl K
          </kbd>
        </button>

        <span className="hidden rounded-[3px] border border-[#2A2A2E] bg-[#111113] px-2.5 py-1.5 font-mono text-[10px] font-semibold font-mono uppercase tracking-[0.18em] text-[#CFCBC4] xl:inline-block">
          {roleLabel(role)}
        </span>

        <div
          className="uc-cut-2 flex h-[36px] w-[36px] items-center justify-center bg-[#D7141F] font-display text-[16px] text-white [--cut:8px]"
          aria-label="Avatar do usuário"
          title="Você"
        >
          {userInitial}
        </div>
      </div>
    </header>
  )
}
