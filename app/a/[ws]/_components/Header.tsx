'use client'

import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { SearchButton } from './PaletteProvider'
import { WorkspaceSwitcher } from './WorkspaceSwitcher'

const roleLabel = (role: string) =>
  (
    { owner: 'OWNER', coordenador: 'COORDENADOR', editor: 'EDITOR', visualizador: 'VISUALIZADOR' } as Record<string, string>
  )[role] ?? role.toUpperCase()

export function Header({
  ws,
  role,
  workspaces,
  onToggleSidebar,
  userInitial,
}: {
  ws: { name: string; slug: string }
  role: string
  workspaces: { name: string; slug: string; role: string }[]
  onToggleSidebar: () => void
  userInitial: string
}) {
  const [ago, setAgo] = useState('agora')

  useEffect(() => {
    const started = Date.now()
    const tick = () => {
      const s = Math.floor((Date.now() - started) / 1000)
      setAgo(s < 5 ? 'agora' : s < 60 ? `há ${s} s` : `há ${Math.floor(s / 60)} min`)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-2 border-b border-[#1C2A47] bg-[#0B1220] px-3 sm:px-4">
      <div className="flex items-center gap-2 sm:gap-4">
        <button
          onClick={onToggleSidebar}
          aria-label="Abrir/fechar menu"
          className="rounded-md p-2 text-[#8FA0C4] hover:bg-[#111A2E] hover:text-[#E6ECFA] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3D8EFF] md:hidden"
        >
          <Icon name="panel-left" />
        </button>
        <img src="/brand/orvia-mark.svg" alt="Orvia" width={30} height={30} className="hidden sm:block" />
        <WorkspaceSwitcher current={{ name: ws.name, slug: ws.slug, role }} workspaces={workspaces} />
      </div>

      <div className="flex items-center gap-1.5 sm:gap-3">
        <div className="hidden items-center gap-2 rounded-lg border border-[#1C2A47] bg-[#070B14] px-3 py-2 text-xs text-[#8FA0C4] lg:flex">
          <span className="h-2 w-2 rounded-full bg-[#34D399]" aria-hidden="true" />
          Atualizado {ago}
        </div>

        <button
          className="hidden items-center gap-2 rounded-lg bg-[#3D8EFF] px-3 py-2 text-sm font-bold text-[#070B14] transition-colors hover:bg-[#6EA8FF] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3D8EFF] sm:flex"
          title="Sincronizar dados (Fase 3: integrações)"
        >
          <Icon name="refresh" className="h-4 w-4" />
          Sincronizar
        </button>

        <SearchButton />

        <span className="hidden rounded-full border border-[#D4AF37]/40 bg-[#2A2308] px-3 py-1 text-[10px] font-extrabold uppercase tracking-widest text-[#D4AF37] md:inline-block">
          {roleLabel(role)}
        </span>

        <div
          className="flex h-9 w-9 items-center justify-center rounded-full border border-[#1C2A47] bg-[#111A2E] text-sm font-bold text-[#E6ECFA]"
          aria-label="Avatar do usuário"
          title="Você"
        >
          {userInitial}
        </div>
      </div>
    </header>
  )
}
