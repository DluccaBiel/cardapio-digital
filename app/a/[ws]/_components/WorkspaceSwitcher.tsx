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
        className="flex items-center gap-2 rounded-[5px] border border-[#232326] bg-[#070708] py-1.5 pl-2 pr-2.5 text-sm font-semibold text-[#F2F0EC] transition-colors hover:border-[#D7141F] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D7141F]"
      >
        <Icon name="building" className="h-4 w-4 text-[#D7141F]" />
        <span className="max-w-[120px] truncate sm:max-w-[200px]">{current.name}</span>
        <Icon name="chevron-down" className="h-4 w-4 text-[#9A9590]" />
      </button>
      {open && (
        <div role="listbox" className="absolute left-0 top-full z-40 mt-2 w-64 overflow-hidden rounded-[6px] border border-[#232326] bg-[#161618] shadow-2xl">
          {workspaces.map((w) => (
            <Link
              key={w.slug}
              href={`/a/${w.slug}/visao-geral`}
              role="option"
              aria-selected={w.slug === current.slug}
              onClick={() => setOpen(false)}
              className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm text-[#F2F0EC] hover:bg-[#0B0B0C]"
            >
              <span className="truncate">{w.name}</span>
              <span className="text-[10px] font-semibold font-mono uppercase tracking-widest text-[#9A9590]">{w.role}</span>
            </Link>
          ))}
          <Link
            href="/onboarding"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 border-t border-[#232326] px-4 py-2.5 text-sm font-semibold text-[#D7141F] hover:bg-[#0B0B0C]"
          >
            <Icon name="plus" className="h-4 w-4" /> Novo workspace
          </Link>
        </div>
      )}
    </div>
  )
}
