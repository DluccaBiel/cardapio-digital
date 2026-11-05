'use client'

import { useState } from 'react'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import { PaletteProvider } from './PaletteProvider'

export function Shell({
  ws,
  role,
  workspaces,
  userInitial,
  children,
}: {
  ws: { name: string; slug: string }
  role: string
  workspaces: { name: string; slug: string; role: string }[]
  userInitial: string
  children: React.ReactNode
}) {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <PaletteProvider ws={ws}>
      <div className="flex h-screen overflow-hidden bg-[#070B14] text-[#E6ECFA]">
        <Sidebar ws={ws} role={role} mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
        <div className="flex min-w-0 flex-1 flex-col">
          <Header
            ws={ws}
            role={role}
            workspaces={workspaces}
            onToggleSidebar={() => setMobileOpen((o) => !o)}
            userInitial={userInitial}
          />
          <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
        </div>
      </div>
    </PaletteProvider>
  )
}
