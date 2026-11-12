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
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D7141F] focus-visible:ring-offset-2 focus-visible:ring-offset-[#111113]',
        width,
        checked ? 'border-[#D7141F] bg-[#D7141F]' : 'border-[#3A3A40] bg-[#1D1D20]',
        disabled && 'cursor-not-allowed opacity-45',
      )}
    >
      <span className={cn('rounded-full bg-white shadow transition-transform duration-200', knob, shift, !checked && 'bg-[#8E8A86]')} />
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
      <div className={cn('relative w-full overflow-hidden rounded-3xl border border-white/[0.09] bg-[#0E0E10]/95 shadow-[0_30px_90px_rgba(0,0,0,0.7)] backdrop-blur-xl', width)}>
        <div className="flex items-start justify-between gap-4 border-b border-white/[0.06] px-5 py-4">
          <div>
            <h2 className="text-[16px] font-bold text-[#F7F5F1]">{title}</h2>
            {description && <p className="mt-0.5 text-[12px] text-[#8E8A86]">{description}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="rounded-md p-1 text-[#86827D] hover:bg-white/[0.05] hover:text-white">
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
      className="uc-fade-up fixed bottom-6 right-6 z-[80] max-w-sm rounded-2xl border border-[#D7141F]/50 bg-[#1F0D0F] px-4 py-3 text-[12px] font-medium text-[#FFD9DB] shadow-2xl"
    >
      {message}
    </div>
  )
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return <span className="mb-1.5 block text-[10px] font-bold font-mono uppercase tracking-[0.12em] text-[#8E8A86]">{children}</span>
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
        'mb-0 h-[42px] w-full rounded-xl border border-[#2A2A2E] bg-[#0B0B0C] px-3 text-[13px] text-[#ECE9E3] outline-none transition-colors placeholder:text-[#85817C] focus:border-[#D7141F] focus:ring-2 focus:ring-[#D7141F]/20',
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
        'mb-0 h-[42px] w-full cursor-pointer rounded-xl border border-[#2A2A2E] bg-[#0B0B0C] px-3 text-[13px] text-[#ECE9E3] outline-none transition-colors focus:border-[#D7141F] focus:ring-2 focus:ring-[#D7141F]/20',
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
