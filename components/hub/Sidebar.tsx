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
        'flex h-full shrink-0 flex-col border-r border-[#1A2231] bg-[#080C14] transition-[width] duration-200',
        compact ? 'w-[76px]' : 'w-[280px]',
      ].join(' ')}
      aria-label="Menu lateral"
    >
      <div className={['flex h-[58px] items-center', compact ? 'justify-center px-2' : 'justify-end px-4'].join(' ')}>
        <button
          type="button"
          onClick={toggle}
          aria-label={compact ? 'Expandir menu' : 'Recolher menu'}
          aria-expanded={!compact}
          className="hidden rounded-lg p-2 text-[#7F8CA3] transition-colors hover:bg-white/[0.04] hover:text-[#E8EDF7] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3D8EFF] md:block"
        >
          {compact ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar menu"
          className="rounded-lg p-2 text-[#7F8CA3] hover:text-white md:hidden"
        >
          <X size={18} />
        </button>
      </div>

      <nav className="flex-1 space-y-2 overflow-y-auto px-3 py-1" aria-label="Navegação principal">
        {items.map((item) => {
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
                'group flex h-[54px] items-center rounded-xl border text-[15px] font-medium transition-colors hover:no-underline',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3D8EFF]',
                compact ? 'justify-center px-0' : 'gap-3 px-4',
                active
                  ? 'border-[#3D8EFF]/70 bg-[#3D8EFF]/10 text-[#6EA8FF]'
                  : 'border-transparent text-[#9AA8BD] hover:border-[#1E2838] hover:bg-white/[0.03] hover:text-[#E8EDF7]',
              ].join(' ')}
            >
              <Icon size={20} strokeWidth={1.8} className={active ? 'text-[#6EA8FF]' : 'text-[#8A97AC] group-hover:text-[#E8EDF7]'} />
              {!compact && <span className="whitespace-nowrap">{item.label}</span>}
            </Link>
          )
        })}
      </nav>

      <div className={['border-t border-[#1A2231] py-4', compact ? 'px-2' : 'px-5'].join(' ')}>
        <div className={['flex items-center', compact ? 'flex-col gap-2' : 'justify-between gap-2'].join(' ')}>
          {!compact && <span className="text-[12px] font-semibold text-[#8A97AC]">Orvia v{brand.version}</span>}
          <span className="rounded-md border border-[#34D399]/50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-[#34D399]">
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
