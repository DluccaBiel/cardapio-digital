'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { brand } from '@orvia/brand'
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  FileText,
  LayoutGrid,
  Megaphone,
  Puzzle,
  UtensilsCrossed,
  X,
} from 'lucide-react'

const items = [
  { key: 'visao-geral', label: 'Visão geral', icon: LayoutGrid },
  { key: 'agenda', label: 'Agenda', icon: CalendarDays },
  { key: 'contas', label: 'Contas de anúncio', icon: Megaphone },
  { key: 'relatorios', label: 'Relatórios', icon: FileText },
  { key: 'cardapio', label: 'Cardápio', icon: UtensilsCrossed },
  { key: 'extensoes', label: 'Extensões', icon: Puzzle },
]

export function Sidebar({
  basePath,
  envLabel,
  mobileOpen,
  onClose,
}: {
  basePath: string
  envLabel: string
  mobileOpen: boolean
  onClose: () => void
}) {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    const stored = typeof window !== 'undefined' ? localStorage.getItem('orvia-sidebar-collapsed') : null
    setCollapsed(stored === '1')
  }, [])

  const toggle = () => {
    setCollapsed((current) => {
      localStorage.setItem('orvia-sidebar-collapsed', current ? '0' : '1')
      return !current
    })
  }

  const nav = (compact: boolean, onNavigate?: () => void) => (
    <aside
      className={[
        'flex h-full shrink-0 flex-col border-r border-[#1C1C1F] bg-[#09090A] transition-[width] duration-200',
        compact ? 'w-[76px]' : 'w-[264px]',
      ].join(' ')}
      aria-label="Menu lateral"
    >
      <div className={['flex h-[52px] items-center', compact ? 'justify-center px-2' : 'justify-end px-4'].join(' ')}>
        <button
          type="button"
          onClick={toggle}
          aria-label={compact ? 'Expandir menu' : 'Recolher menu'}
          aria-expanded={!compact}
          className="hidden rounded-[5px] p-2 text-[#86827D] transition-colors hover:bg-white/[0.04] hover:text-[#ECE9E3] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D7141F] md:block"
        >
          {compact ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar menu"
          className="rounded-[5px] p-2 text-[#86827D] hover:text-white md:hidden"
        >
          <X size={18} />
        </button>
      </div>

      {!compact && (
        <p className="px-5 pb-2 font-mono text-[9px] font-mono uppercase tracking-[0.28em] text-[#55555C]">Painel · setores</p>
      )}
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-1" aria-label="Navegação principal">
        {items.map((item, index) => {
          const href = `${basePath}/${item.key}`
          const active = pathname === href || pathname.startsWith(`${href}/`)
          const Icon = item.icon
          return (
            <Link
              key={item.key}
              href={href}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              title={compact ? item.label : undefined}
              className={[
                'group relative flex h-[50px] items-center overflow-hidden rounded-[4px] border text-[14px] font-medium transition-all duration-200 hover:no-underline',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F0333D]',
                compact ? 'justify-center px-0' : 'gap-3 px-3',
                active
                  ? 'border-[#2A2A2E] bg-gradient-to-r from-[#D7141F]/[0.16] via-[#D7141F]/[0.05] to-transparent text-[#F7F5F1]'
                  : 'border-transparent text-[#9F9A94] hover:border-[#222225] hover:bg-white/[0.025] hover:text-[#ECE9E3]',
              ].join(' ')}
            >
              {active && (
                <span
                  className="absolute inset-y-[9px] left-0 w-[4px] skew-y-[-14deg] bg-[#D7141F] shadow-[0_0_12px_rgba(215,20,31,0.9)]"
                  aria-hidden="true"
                />
              )}
              {!compact && (
                <span
                  className={[
                    'w-[22px] shrink-0 font-mono text-[10px] font-semibold tracking-[0.06em]',
                    active ? 'text-[#F0333D]' : 'text-[#55555C] group-hover:text-[#86827D]',
                  ].join(' ')}
                  aria-hidden="true"
                >
                  S{index + 1}
                </span>
              )}
              <Icon size={19} strokeWidth={1.7} className={active ? 'text-[#F0333D]' : 'text-[#86827D] group-hover:text-[#ECE9E3]'} />
              {!compact && <span className="whitespace-nowrap">{item.label}</span>}
              {!compact && active && (
                <span className="ml-auto h-[6px] w-[6px] rotate-45 bg-[#D7141F]" aria-hidden="true" />
              )}
            </Link>
          )
        })}
      </nav>

      <div className={['border-t border-[#1C1C1F] py-4', compact ? 'px-2' : 'px-5'].join(' ')}>
        {!compact && (
          <div className="mb-3 flex items-end gap-[3px]" aria-hidden="true">
            {[38, 52, 44, 68, 57, 80, 64, 92, 74, 100].map((h, i) => (
              <span key={i} className={['w-full rounded-[1px]', i > 6 ? 'bg-[#D7141F]' : 'bg-[#2A2A2E]'].join(' ')} style={{ height: `${h * 0.18}px` }} />
            ))}
          </div>
        )}
        <div className={['flex items-center', compact ? 'flex-col gap-2' : 'justify-between gap-2'].join(' ')}>
          {!compact && (
            <span className="font-mono text-[10px] font-mono uppercase tracking-[0.18em] text-[#86827D]">
              {brand.name} v{brand.version}
            </span>
          )}
          <span className="rounded-[3px] border border-[#34D399]/50 px-2 py-0.5 font-mono text-[9px] font-semibold font-mono uppercase tracking-[0.14em] text-[#34D399]">
            {envLabel}
          </span>
        </div>
      </div>
    </aside>
  )

  return (
    <>
      <div className="hidden md:block">{nav(collapsed)}</div>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Menu de navegação">
          <button type="button" aria-label="Fechar menu" onClick={onClose} className="absolute inset-0 bg-black/70 backdrop-blur-[2px]" />
          <div className="absolute left-0 top-0 h-full shadow-2xl">{nav(false, onClose)}</div>
        </div>
      )}
    </>
  )
}
