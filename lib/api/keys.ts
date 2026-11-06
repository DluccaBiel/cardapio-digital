import { createHash, randomBytes } from 'crypto'

/** Escopos aceitos (docs/api.md §2). */
export const API_SCOPES = ['clientes:ler', 'clientes:escrever', 'catalogo:ler', 'catalogo:escrever', 'webhooks:gerenciar', 'extensoes:ler'] as const
export type ApiScope = (typeof API_SCOPES)[number]

/** Escopos mínimos para a extensão Orvia · iFood. */
export const IFOOD_EXTENSION_SCOPES: ApiScope[] = ['clientes:ler', 'catalogo:ler', 'catalogo:escrever']

/**
 * Gera uma chave `ck_live_<43 chars base64url>` (256 bits aleatórios).
 * O valor em claro é devolvido UMA vez; o banco guarda só o hash.
 */
export function generateApiKey(): { key: string; prefix: string; hash: string } {
  const key = `ck_live_${randomBytes(32).toString('base64url')}`
  return { key, prefix: key.slice(0, 12), hash: hashApiKey(key) }
}

/**
 * SHA-256 hex da chave. Sem salt por decisão (docs/decisoes-em-aberto.md #3):
 * a chave tem 256 bits de entropia — salt não acrescenta proteção contra força
 * bruta e impediria o lookup indexado por `key_hash` (unique).
 */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex')
}

export function looksLikeApiKey(value: string | null): value is string {
  return Boolean(value && /^ck_live_[A-Za-z0-9_-]{43}$/.test(value))
}
