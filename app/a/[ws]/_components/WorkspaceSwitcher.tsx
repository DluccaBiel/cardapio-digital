'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Icon } from './Icon'

type Item = { name: string; slug: string; role: string }

export function WorkspaceSwitcher({ current, workspaces }: { current: Item; workspaces: Item[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('click', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-lg border border-[#1C2A47] bg-[#070B14] py-1.5 pl-2 pr-2.5 text-sm font-semibold text-[#E6ECFA] transition-colors hover:border-[#3D8EFF] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3D8EFF]"
      >
        <Icon name="building" className="h-4 w-4 text-[#3D8EFF]" />
        <span className="max-w-[120px] truncate sm:max-w-[200px]">{current.name}</span>
        <Icon name="chevron-down" className="h-4 w-4 text-[#8FA0C4]" />
      </button>
      {open && (
        <div role="listbox" className="absolute left-0 top-full z-40 mt-2 w-64 overflow-hidden rounded-xl border border-[#1C2A47] bg-[#111A2E] shadow-2xl">
          {workspaces.map((w) => (
            <Link
              key={w.slug}
              href={`/a/${w.slug}/visao-geral`}
              role="option"
              aria-selected={w.slug === current.slug}
              onClick={() => setOpen(false)}
              className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm text-[#E6ECFA] hover:bg-[#0B1220]"
            >
              <span className="truncate">{w.name}</span>
              <span className="text-[10px] font-semibold uppercase tracking-widest text-[#8FA0C4]">{w.role}</span>
            </Link>
          ))}
          <Link
            href="/onboarding"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 border-t border-[#1C2A47] px-4 py-2.5 text-sm font-semibold text-[#3D8EFF] hover:bg-[#0B1220]"
          >
            <Icon name="plus" className="h-4 w-4" /> Novo workspace
          </Link>
        </div>
      )}
    </div>
  )
}
