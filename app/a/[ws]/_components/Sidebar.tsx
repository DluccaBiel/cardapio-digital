'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { brand } from '@orvia/brand'
import { Icon } from './Icon'

type Item = { href: string; label: string; icon: Parameters<typeof Icon>[0]['name'] }

const ITEMS: (ws: string) => Item[] = (ws) => [
  { href: `/a/${ws}/visao-geral`, label: 'Visão geral', icon: 'grid' },
  { href: `/a/${ws}/agenda`, label: 'Agenda', icon: 'calendar' },
  { href: `/a/${ws}/contas`, label: 'Contas de anúncio', icon: 'megaphone' },
  { href: `/a/${ws}/relatorios`, label: 'Relatórios', icon: 'file' },
  { href: `/a/${ws}/cardapio`, label: 'Cardápio', icon: 'utensils' },
  { href: `/a/${ws}/extensoes`, label: 'Extensões', icon: 'puzzle' },
]

export function Sidebar({
  ws,
  role,
  mobileOpen,
  onClose,
}: {
  ws: { name: string; slug: string }
  role: string
  mobileOpen: boolean
  onClose: () => void
}) {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    const v = typeof window !== 'undefined' ? localStorage.getItem('orvia-sidebar-collapsed') : null
    setCollapsed(v === '1')
  }, [])

  const toggle = () => {
    setCollapsed((c) => {
      localStorage.setItem('orvia-sidebar-collapsed', c ? '0' : '1')
      return !c
    })
  }

  const items = ITEMS(ws.slug)
  const env = process.env.NEXT_PUBLIC_VERCEL_ENV
  const envLabel = env === 'production' ? 'PROD' : env === 'preview' ? 'PREVIEW' : 'DEV'

  const nav = (
    <aside
      className={[
        'flex h-full flex-col border-r border-[#1C2A47] bg-[#0B1220] transition-all duration-200',
        collapsed ? 'w-[72px]' : 'w-[240px]',
      ].join(' ')}
      data-collapsed={collapsed}
    >
      <div className="flex h-16 items-center justify-between border-b border-[#1C2A47] px-4">
        <Link href={`/a/${ws.slug}/visao-geral`} className="flex items-center gap-2 overflow-hidden" aria-label="Orvia — início">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/orvia-mark.svg" alt="" width={30} height={30} className="shrink-0" />
          {!collapsed && <span className="whitespace-nowrap text-lg font-extrabold tracking-tight text-[#E6ECFA]">Orvia</span>}
        </Link>
        <button
          onClick={toggle}
          aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
          className="rounded-md p-1.5 text-[#8FA0C4] hover:bg-[#111A2E] hover:text-[#E6ECFA] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3D8EFF]"
        >
          <Icon name={collapsed ? 'chevron-right' : 'chevron-left'} />
        </button>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-3" aria-label="Navegação principal">
        {items.map((item) => {
          const active = pathname.startsWith(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onClose}
              aria-current={active ? 'page' : undefined}
              className={[
                'group flex items-center gap-3 rounded-lg border-l-2 px-3 py-2.5 text-sm font-medium transition-colors',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3D8EFF]',
                active
                  ? 'border-[#3D8EFF] bg-[#111A2E] text-[#E6ECFA]'
                  : 'border-transparent text-[#8FA0C4] hover:bg-[#111A2E] hover:text-[#E6ECFA]',
              ].join(' ')}
              title={collapsed ? item.label : undefined}
            >
              <Icon name={item.icon} className={active ? 'text-[#3D8EFF]' : 'text-[#8FA0C4] group-hover:text-[#E6ECFA]'} />
              {!collapsed && <span className="whitespace-nowrap">{item.label}</span>}
            </Link>
          )
        })}
      </nav>

      <div className="border-t border-[#1C2A47] px-3 py-3">
        <div className="flex items-center justify-between">
          {!collapsed && <span className="text-[10px] font-semibold uppercase tracking-widest text-[#8FA0C4]">Orvia v{brand.version}</span>}
          <span className="rounded-full border border-[#1C2A47] bg-[#070B14] px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-[#34D399]">
            {envLabel}
          </span>
        </div>
      </div>
    </aside>
  )

  return (
    <>
      {/* Desktop */}
      <div className="hidden h-full shrink-0 md:block">{nav}</div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true">
          <button aria-label="Fechar menu" onClick={onClose} className="absolute inset-0 bg-black/60" />
          <div className="absolute left-0 top-0 h-full">{nav}</div>
        </div>
      )}
    </>
  )
}
