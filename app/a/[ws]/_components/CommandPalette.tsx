'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Icon } from './Icon'

type Action = { id: string; label: string; hint?: string; run: () => void }

export function CommandPalette({ open, onClose, ws }: { open: boolean; onClose: () => void; ws: { slug: string; name: string } }) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setTimeout(() => inputRef.current?.focus(), 30)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const actions: Action[] = useMemo(() => {
    const nav = (label: string, path: string, hint = ''): Action => ({
      id: `nav-${path}`,
      label,
      hint,
      run: () => router.push(`/a/${ws.slug}${path}`),
    })
    return [
      nav('Ir para Visão geral', '/visao-geral'),
      nav('Ir para Agenda', '/agenda'),
      nav('Ir para Contas de anúncio', '/contas'),
      nav('Ir para Relatórios', '/relatorios'),
      nav('Ir para Cardápio', '/cardapio'),
      nav('Ir para Extensões', '/extensoes'),
      { id: 'new-client', label: 'Novo cliente…', hint: 'Visão geral', run: () => router.push(`/a/${ws.slug}/visao-geral?new=1`) },
      { id: 'export-csv', label: 'Exportar CSV de clientes', hint: 'Visão geral', run: () => router.push(`/a/${ws.slug}/visao-geral?export=1`) },
    ]
  }, [router, ws.slug])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return actions
    return actions.filter((a) => a.label.toLowerCase().includes(q) || a.hint?.toLowerCase().includes(q))
  }, [actions, query])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-28" role="dialog" aria-modal="true" aria-label="Paleta de comandos">
      <button aria-label="Fechar" className="absolute inset-0" onClick={onClose} />
      <div className="relative w-full max-w-lg overflow-hidden rounded-xl border border-[#1C2A47] bg-[#111A2E] shadow-2xl">
        <div className="flex items-center gap-3 border-b border-[#1C2A47] px-4 py-3">
          <Icon name="search" className="h-5 w-5 text-[#8FA0C4]" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar cliente, tela ou ação…"
            aria-label="Buscar"
            className="w-full bg-transparent text-base text-[#E6ECFA] outline-none placeholder:text-[#8FA0C4]"
          />
          <button onClick={onClose} aria-label="Fechar" className="rounded p-1 text-[#8FA0C4] hover:text-[#E6ECFA]">
            <Icon name="x" className="h-4 w-4" />
          </button>
        </div>
        <ul className="max-h-80 overflow-y-auto py-2">
          {filtered.length === 0 && <li className="px-4 py-6 text-center text-sm text-[#8FA0C4]">Nada encontrado para “{query}”.</li>}
          {filtered.map((a) => (
            <li key={a.id}>
              <button
                className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm text-[#E6ECFA] hover:bg-[#0B1220] focus:bg-[#0B1220] focus:outline-none"
                onClick={() => {
                  a.run()
                  onClose()
                }}
              >
                <span>{a.label}</span>
                {a.hint && <span className="text-xs text-[#8FA0C4]">{a.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
