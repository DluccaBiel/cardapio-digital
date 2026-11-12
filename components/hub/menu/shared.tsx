'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState, useTransition, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { formatBRL } from '@/lib/format'
import { STATUS_LABEL, type MenuItem, type MenuStatus } from '@/lib/menu/model'
import { cn } from '@/components/hub/ui'

export type ActionResult = { ok: true; id?: string } | { ok: false; error: string; conflict?: boolean }

/** Executa uma server action, mostra toast e recarrega os dados do servidor. */
export function useMenuAction() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 4500)
    return () => clearTimeout(timer)
  }, [toast])

  const run = useCallback(
    async (call: () => Promise<ActionResult>, success: string): Promise<ActionResult> => {
      let result: ActionResult
      try {
        result = await call()
      } catch {
        result = { ok: false, error: 'Falha de conexão. Tente novamente.' }
      }
      if (result.ok) {
        setToast(success)
        startTransition(() => router.refresh())
      } else {
        setToast(result.conflict ? `${result.error}` : `Não salvou: ${result.error}`)
        if (result.conflict) startTransition(() => router.refresh())
      }
      return result
    },
    [router],
  )

  return { run, pending, toast, setToast }
}

const STATUS_STYLE: Record<MenuStatus, string> = {
  active: 'border-[#34D399]/35 bg-[#34D399]/10 text-[#34D399]',
  inactive: 'border-[#3A3A40] bg-[#19191C] text-[#B8B3AC]',
  out_of_stock: 'border-[#FBBF24]/45 bg-[#FBBF24]/10 text-[#FBBF24]',
}

export function StatusBadge({ status }: { status: MenuStatus }) {
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold font-mono uppercase tracking-[0.08em]', STATUS_STYLE[status])}>
      {STATUS_LABEL[status]}
    </span>
  )
}

export function SyncBadge({ item }: { item: Pick<MenuItem, 'pending' | 'ifood_id'> }) {
  if (!item.ifood_id) {
    return (
      <span title="Ainda não existe no iFood — crie pela extensão" className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-[#A78BFA]/40 bg-[#A78BFA]/10 px-2 py-0.5 text-[10px] font-bold text-[#C4B5FD]">
        Só no Undercut
      </span>
    )
  }
  if (item.pending) {
    return (
      <span title="Alterado no Undercut — aplicar no iFood" className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-[#FBBF24]/45 bg-[#FBBF24]/10 px-2 py-0.5 text-[10px] font-bold text-[#FBBF24]">
        Pendente iFood
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-[#2E2E33] bg-[#19191C] px-2 py-0.5 text-[10px] font-bold text-[#8E8A86]">
      Em dia
    </span>
  )
}

export function Btn({
  variant = 'secondary',
  size = 'md',
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' | 'md' }) {
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D7141F]/60',
        size === 'sm' ? 'h-8 px-2.5 text-[12px]' : 'h-[38px] px-3.5 text-[13px]',
        variant === 'primary' && 'bg-[#D7141F] text-white hover:bg-[#B5121B]',
        variant === 'secondary' && 'border border-[#2A2A2E] bg-[#111113] text-[#DAD6CF] hover:border-[#D7141F]/60 hover:text-white',
        variant === 'ghost' && 'text-[#8E8A86] hover:bg-white/[0.05] hover:text-white',
        variant === 'danger' && 'border border-[#FF6A3D]/40 bg-[#FF6A3D]/10 text-[#FFB199] hover:bg-[#FF6A3D]/20',
        className,
      )}
    >
      {children}
    </button>
  )
}

/** Preço editável no clique (Enter salva, Esc cancela). */
export function InlinePrice({
  value,
  disabled,
  onSave,
}: {
  value: number
  disabled?: boolean
  onSave: (next: number) => void
}) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  if (!editing || disabled) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setText(value.toFixed(2).replace('.', ','))
          setEditing(true)
        }}
        className="rounded-md px-1.5 py-0.5 font-mono text-[13px] tabular-nums text-[#ECE9E3] enabled:hover:bg-[#D7141F]/10 enabled:hover:text-white disabled:cursor-default"
        title={disabled ? undefined : 'Clique para editar o preço'}
      >
        {formatBRL(value)}
      </button>
    )
  }
  const commit = () => {
    setEditing(false)
    const parsed = parsePrice(text)
    if (parsed !== null && parsed !== value) onSave(parsed)
  }
  return (
    <input
      autoFocus
      inputMode="decimal"
      aria-label="Novo preço"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') setEditing(false)
      }}
      className="mb-0 h-8 w-24 rounded-md border border-[#D7141F] bg-[#0B0B0C] px-2 text-right font-mono text-[13px] text-white outline-none"
    />
  )
}

export function parsePrice(text: string): number | null {
  let t = text.replace(/[R$\s]/g, '')
  if (!t) return null
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.')
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-[6px] border border-dashed border-[#2A2A2E] bg-[#0D0D0E] px-6 py-10 text-center">
      <p className="text-[14px] font-semibold text-[#ECE9E3]">{title}</p>
      {children && <div className="mt-1.5 max-w-md text-[12px] leading-relaxed text-[#8E8A86]">{children}</div>}
    </div>
  )
}

export function Textarea({ value, onChange, placeholder, rows = 3 }: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number }) {
  return (
    <textarea
      value={value}
      rows={rows}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="mb-0 w-full resize-y rounded-xl border border-[#2A2A2E] bg-[#0B0B0C] px-3 py-2 text-[13px] text-[#ECE9E3] outline-none placeholder:text-[#85817C] focus:border-[#D7141F] focus:ring-2 focus:ring-[#D7141F]/20"
    />
  )
}
