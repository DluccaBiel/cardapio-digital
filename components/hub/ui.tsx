'use client'

import { X } from 'lucide-react'
import type { ReactNode } from 'react'

export function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ')
}

export function Toggle({
  checked,
  onChange,
  label,
  size = 'md',
  disabled = false,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
  size?: 'sm' | 'md'
  disabled?: boolean
}) {
  const width = size === 'sm' ? 'h-[20px] w-[36px]' : 'h-[26px] w-[46px]'
  const knob = size === 'sm' ? 'h-[14px] w-[14px]' : 'h-[20px] w-[20px]'
  const shift = size === 'sm' ? (checked ? 'translate-x-[18px]' : 'translate-x-[3px]') : checked ? 'translate-x-[23px]' : 'translate-x-[3px]'
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex shrink-0 items-center rounded-full border transition-colors duration-200',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3D8EFF] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0D1320]',
        width,
        checked ? 'border-[#3D8EFF] bg-[#3D8EFF]' : 'border-[#33415C] bg-[#1A2333]',
        disabled && 'cursor-not-allowed opacity-45',
      )}
    >
      <span className={cn('rounded-full bg-white shadow transition-transform duration-200', knob, shift, !checked && 'bg-[#8A97AC]')} />
    </button>
  )
}

export function Modal({
  title,
  description,
  onClose,
  children,
  width = 'max-w-md',
}: {
  title: string
  description?: string
  onClose: () => void
  children: ReactNode
  width?: string
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center px-4" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label="Fechar" onClick={onClose} className="absolute inset-0 bg-black/65 backdrop-blur-[2px]" />
      <div className={cn('relative w-full overflow-hidden rounded-2xl border border-[#26314A] bg-[#0B1120] shadow-[0_30px_90px_rgba(0,0,0,0.65)]', width)}>
        <div className="flex items-start justify-between gap-4 border-b border-[#1A2231] px-5 py-4">
          <div>
            <h2 className="text-[16px] font-bold text-[#F1F5FC]">{title}</h2>
            {description && <p className="mt-0.5 text-[12px] text-[#8A97AC]">{description}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="rounded-md p-1 text-[#7F8CA3] hover:bg-white/[0.05] hover:text-white">
            <X size={17} />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  )
}

export function Toast({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <div
      role="status"
      className="fixed bottom-6 right-6 z-[80] max-w-sm rounded-xl border border-[#3D8EFF]/50 bg-[#0C1A31] px-4 py-3 text-[12px] font-medium text-[#CFE0FF] shadow-2xl"
    >
      {message}
    </div>
  )
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.12em] text-[#8A97AC]">{children}</span>
}

export function TextInput({
  value,
  onChange,
  placeholder,
  type = 'text',
  autoFocus,
  className,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: string
  autoFocus?: boolean
  className?: string
}) {
  return (
    <input
      type={type}
      value={value}
      autoFocus={autoFocus}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className={cn(
        'mb-0 h-[42px] w-full rounded-lg border border-[#26314A] bg-[#080D18] px-3 text-[13px] text-[#E8EDF7] outline-none transition-colors placeholder:text-[#5F6B80] focus:border-[#3D8EFF] focus:ring-2 focus:ring-[#3D8EFF]/20',
        className,
      )}
    />
  )
}

export function TextSelect({
  value,
  onChange,
  options,
  className,
  ariaLabel,
}: {
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
  className?: string
  ariaLabel?: string
}) {
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={cn(
        'mb-0 h-[42px] w-full cursor-pointer rounded-lg border border-[#26314A] bg-[#080D18] px-3 text-[13px] text-[#E8EDF7] outline-none transition-colors focus:border-[#3D8EFF] focus:ring-2 focus:ring-[#3D8EFF]/20',
        className,
      )}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}
