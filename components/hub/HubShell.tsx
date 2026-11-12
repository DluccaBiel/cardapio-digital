'use client'

import { useCallback, useEffect, useState } from 'react'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import { CommandPalette } from './CommandPalette'
import type { MockClient } from '@/lib/mock'

export function HubShell({
  workspace,
  role,
  workspaces,
  userInitial,
  basePath,
  envLabel,
  demo = false,
  live = false,
  clients,
  children,
}: {
  workspace: { name: string; slug: string }
  role: string
  workspaces: { name: string; slug: string; role: string }[]
  userInitial: string
  basePath: string
  envLabel: string
  demo?: boolean
  live?: boolean
  clients: MockClient[]
  children: React.ReactNode
}) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)

  const closeSearch = useCallback(() => setSearchOpen(false), [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSearchOpen((open) => !open)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="hub-root flex h-[100dvh] flex-col bg-[#080809] text-[#ECE9E3]">
      <Header
        workspace={workspace}
        role={role}
        workspaces={workspaces}
        userInitial={userInitial}
        onOpenSidebar={() => setMobileOpen(true)}
        onOpenSearch={() => setSearchOpen(true)}
        demo={demo}
        live={live}
      />

      <div className="flex min-h-0 flex-1">
        <Sidebar basePath={basePath} envLabel={envLabel} role={role} mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
        <main id="hub-main" className="relative min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
          {children}
        </main>
      </div>

      <CommandPalette open={searchOpen} onClose={closeSearch} basePath={basePath} clients={clients} />
    </div>
  )
}
