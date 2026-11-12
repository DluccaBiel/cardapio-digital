'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { Icon } from './Icon'
import { CommandPalette } from './CommandPalette'

const PaletteCtx = createContext<{ open: () => void } | null>(null)
export function usePalette() {
  return useContext(PaletteCtx)
}

export function PaletteProvider({ children, ws }: { children: ReactNode; ws: { slug: string; name: string } }) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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
      className="flex items-center gap-2 rounded-[5px] border border-[#232326] bg-[#070708] px-3 py-2 text-sm text-[#9A9590] transition-colors hover:border-[#D7141F] hover:text-[#F2F0EC] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D7141F]"
      aria-label="Buscar (Ctrl K)"
    >
      <Icon name="search" className="h-4 w-4" />
      <span className="hidden sm:inline">Buscar cliente…</span>
      <kbd className="hidden rounded border border-[#232326] bg-[#161618] px-1.5 py-0.5 text-[10px] text-[#9A9590] md:inline">Ctrl K</kbd>
    </button>
  )
}
