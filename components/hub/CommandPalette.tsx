'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowRight,
  CalendarDays,
  FileText,
  LayoutGrid,
  Megaphone,
  Puzzle,
  Search,
  UtensilsCrossed,
  X,
} from 'lucide-react'
import type { MockClient } from '@/lib/mock'

const shortcuts = [
  { key: 'visao-geral', label: 'Visão geral', icon: LayoutGrid },
  { key: 'contas', label: 'Contas de anúncio', icon: Megaphone },
  { key: 'relatorios', label: 'Relatórios', icon: FileText },
  { key: 'cardapio', label: 'Cardápio', icon: UtensilsCrossed },
  { key: 'agenda', label: 'Agenda', icon: CalendarDays },
  { key: 'extensoes', label: 'Extensões', icon: Puzzle },
]

export function CommandPalette({
  open,
  onClose,
  basePath,
  clients,
}: {
  open: boolean
  onClose: () => void
  basePath: string
  clients: MockClient[]
}) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)

  useEffect(() => {
    if (open) {
      setQuery('')
      setActive(0)
      const timer = setTimeout(() => inputRef.current?.focus(), 20)
      return () => clearTimeout(timer)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const filteredClients = useMemo(() => {
    const term = query.trim().toLowerCase()
    const source = term
      ? clients.filter((client) => client.name.toLowerCase().includes(term) || client.segment.toLowerCase().includes(term))
      : clients.slice(0, 4)
    return source.slice(0, 5)
  }, [clients, query])

  if (!open) return null

  const entries = [
    ...filteredClients.map((client) => ({
      id: `client-${client.id}`,
      label: client.name,
      hint: client.segment,
      action: () => router.push(`${basePath}/visao-geral?q=${encodeURIComponent(client.name)}`),
    })),
    ...shortcuts.map((shortcut) => ({
      id: shortcut.key,
      label: shortcut.label,
      hint: 'Ir para',
      action: () => router.push(`${basePath}/${shortcut.key}`),
    })),
  ]

  const go = (index: number) => {
    const entry = entries[index]
    if (entry) {
      entry.action()
      onClose()
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[14vh]" role="dialog" aria-modal="true" aria-label="Busca rápida">
      <button type="button" aria-label="Fechar busca" onClick={onClose} className="absolute inset-0 bg-black/65 backdrop-blur-[3px]" />
      <div className="relative w-full max-w-[560px] overflow-hidden rounded-[8px] border border-[#2A2A2E] bg-[#0E0E10] shadow-[0_30px_90px_rgba(0,0,0,0.65)]">
        <div className="flex items-center gap-3 border-b border-[#1C1C1F] px-4">
          <Search size={18} className="text-[#86827D]" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setActive(0)
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setActive((current) => Math.min(current + 1, entries.length - 1))
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                setActive((current) => Math.max(current - 1, 0))
              }
              if (event.key === 'Enter') {
                event.preventDefault()
                go(active)
              }
            }}
            placeholder="Buscar cliente ou navegar…"
            className="mb-0 h-[56px] flex-1 border-0 bg-transparent p-0 text-[15px] text-[#ECE9E3] outline-none placeholder:text-[#85817C] focus:ring-0"
            aria-label="Busca rápida"
          />
          <button type="button" onClick={onClose} aria-label="Fechar" className="rounded-md p-1 text-[#86827D] hover:text-white">
            <X size={16} />
          </button>
        </div>

        <div className="max-h-[380px] overflow-y-auto p-2">
          {entries.length === 0 && <p className="px-4 py-8 text-center text-sm text-[#8E8A86]">Nenhum resultado.</p>}
          {filteredClients.length > 0 && (
            <p className="px-3 pb-1 pt-2 text-[10px] font-bold font-mono uppercase tracking-[0.18em] text-[#85817C]">Clientes</p>
          )}
          {filteredClients.map((client, index) => (
            <button
              key={client.id}
              type="button"
              onMouseEnter={() => setActive(index)}
              onClick={() => go(index)}
              className={[
                'flex w-full items-center justify-between gap-3 rounded-[5px] px-3 py-2.5 text-left text-sm',
                active === index ? 'bg-[#D7141F]/15 text-white' : 'text-[#CFCBC4] hover:bg-white/[0.04]',
              ].join(' ')}
            >
              <span className="flex items-center gap-2.5">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#C8C2B8]/15 text-[10px] font-bold text-[#DAD4CA]">
                  {client.name.charAt(0)}
                </span>
                <span>{client.name}</span>
                <span className="text-[11px] text-[#86827D]">{client.segment}</span>
              </span>
              <ArrowRight size={14} className="text-[#85817C]" />
            </button>
          ))}

          <p className="px-3 pb-1 pt-3 text-[10px] font-bold font-mono uppercase tracking-[0.18em] text-[#85817C]">Navegação</p>
          {shortcuts.map((shortcut, offset) => {
            const index = filteredClients.length + offset
            const Icon = shortcut.icon
            return (
              <button
                key={shortcut.key}
                type="button"
                onMouseEnter={() => setActive(index)}
                onClick={() => go(index)}
                className={[
                  'flex w-full items-center justify-between gap-3 rounded-[5px] px-3 py-2.5 text-left text-sm',
                  active === index ? 'bg-[#D7141F]/15 text-white' : 'text-[#CFCBC4] hover:bg-white/[0.04]',
                ].join(' ')}
              >
                <span className="flex items-center gap-2.5">
                  <Icon size={16} className="text-[#8E8A86]" />
                  <span>{shortcut.label}</span>
                </span>
                <span className="text-[11px] text-[#85817C]">Ir para</span>
              </button>
            )
          })}
        </div>

        <div className="flex items-center justify-between border-t border-[#1C1C1F] px-4 py-2 text-[10px] text-[#85817C]">
          <span>↑ ↓ navegar · ↵ abrir</span>
          <span>esc fechar</span>
        </div>
      </div>
    </div>
  )
}
