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
      <div className="relative w-full max-w-lg overflow-hidden rounded-[6px] border border-[#232326] bg-[#161618] shadow-2xl">
        <div className="flex items-center gap-3 border-b border-[#232326] px-4 py-3">
          <Icon name="search" className="h-5 w-5 text-[#9A9590]" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar cliente, tela ou ação…"
            aria-label="Buscar"
            className="w-full bg-transparent text-base text-[#F2F0EC] outline-none placeholder:text-[#9A9590]"
          />
          <button onClick={onClose} aria-label="Fechar" className="rounded p-1 text-[#9A9590] hover:text-[#F2F0EC]">
            <Icon name="x" className="h-4 w-4" />
          </button>
        </div>
        <ul className="max-h-80 overflow-y-auto py-2">
          {filtered.length === 0 && <li className="px-4 py-6 text-center text-sm text-[#9A9590]">Nada encontrado para “{query}”.</li>}
          {filtered.map((a) => (
            <li key={a.id}>
              <button
                className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm text-[#F2F0EC] hover:bg-[#0B0B0C] focus:bg-[#0B0B0C] focus:outline-none"
                onClick={() => {
                  a.run()
                  onClose()
                }}
              >
                <span>{a.label}</span>
                {a.hint && <span className="text-xs text-[#9A9590]">{a.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
