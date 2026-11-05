'use client'

import { createContext, useContext, useState, type ReactNode } from 'react'
import { Icon } from './Icon'
import { CommandPalette } from './CommandPalette'

const PaletteCtx = createContext<{ open: () => void } | null>(null)
export function usePalette() {
  return useContext(PaletteCtx)
}

export function PaletteProvider({ children, ws }: { children: ReactNode; ws: { slug: string; name: string } }) {
  const [open, setOpen] = useState(false)
  return (
    <PaletteCtx.Provider value={{ open: () => setOpen(true) }}>
      {children}
      <CommandPalette open={open} onClose={() => setOpen(false)} ws={ws} />
    </PaletteCtx.Provider>
  )
}

export function SearchButton() {
  const palette = usePalette()
  return (
    <button
      onClick={palette?.open}
      className="flex items-center gap-2 rounded-lg border border-[#1C2A47] bg-[#070B14] px-3 py-2 text-sm text-[#8FA0C4] transition-colors hover:border-[#3D8EFF] hover:text-[#E6ECFA] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3D8EFF]"
      aria-label="Buscar (Ctrl K)"
    >
      <Icon name="search" className="h-4 w-4" />
      <span className="hidden sm:inline">Buscar cliente…</span>
      <kbd className="hidden rounded border border-[#1C2A47] bg-[#111A2E] px-1.5 py-0.5 text-[10px] text-[#8FA0C4] md:inline">Ctrl K</kbd>
    </button>
  )
}
