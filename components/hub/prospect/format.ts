import type { Niche, ProspectClient } from '../../../lib/db/prospects'

/** Helpers puros (servidor e cliente). */
export const NICHE_LABEL: Record<Niche, string> = { food: 'Food', health: 'Saúde' }
export const STATUS_LABEL: Record<ProspectClient['status'], string> = { ativo: 'Ativo', pausado: 'Pausado', encerrado: 'Encerrado' }

export type NicheFilter = 'all' | Niche
export type TriState = 'all' | 'yes' | 'no'

export function matchesTri(value: string | null, filter: TriState): boolean {
  if (filter === 'all') return true
  return filter === 'yes' ? !!value : !value
}

/** Telefone → número para wa.me (só dígitos, com DDI 55 quando faltar). */
export function waNumber(raw: string | null): string | null {
  const digits = (raw ?? '').replace(/\D/g, '')
  if (digits.length < 10) return null
  return digits.length <= 11 ? `55${digits}` : digits
}

export function instagramUrl(handle: string): string {
  const clean = handle.trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//, '').replace(/\/$/, '')
  return `https://instagram.com/${encodeURIComponent(clean)}`
}

export function websiteUrl(site: string): string | null {
  const value = /^https?:\/\//i.test(site) ? site : `https://${site}`
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

export function formatBRL(value: number | null): string {
  if (value == null) return '—'
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
