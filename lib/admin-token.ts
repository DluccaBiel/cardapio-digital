import { createHash, timingSafeEqual } from 'node:crypto'

/** Funções puras do login do ADM por chave (token) — testáveis sem Supabase. */

export const MIN_TOKEN_LENGTH = 32

const sha256 = (v: string) => createHash('sha256').update(v, 'utf8').digest()

/** Compara em tempo constante com ADMIN_ACCESS_TOKEN_HASH (sha256 hex) ou, se ausente, ADMIN_ACCESS_TOKEN. */
export function tokenMatches(given: string, env: { hash?: string | null; plain?: string | null }): boolean {
  const g = given.trim()
  if (g.length < MIN_TOKEN_LENGTH || g.length > 200) return false
  const hash = env.hash?.trim().toLowerCase()
  if (hash && /^[0-9a-f]{64}$/.test(hash)) return timingSafeEqual(sha256(g), Buffer.from(hash, 'hex'))
  const plain = env.plain?.trim()
  if (plain && plain.length >= MIN_TOKEN_LENGTH) return timingSafeEqual(sha256(g), sha256(plain))
  return false
}

export function hashToken(token: string): string {
  return sha256(token.trim()).toString('hex')
}

/** Limite simples por IP (melhor esforço em serverless): 5 erros por 15 min. */
const WINDOW_MS = 15 * 60_000
const MAX_FAILS = 5
const fails = new Map<string, number[]>()
export function tooManyFails(ip: string, now = Date.now()): boolean {
  const list = (fails.get(ip) ?? []).filter((t) => now - t < WINDOW_MS)
  fails.set(ip, list)
  return list.length >= MAX_FAILS
}
export function recordFail(ip: string, now = Date.now()) {
  const list = (fails.get(ip) ?? []).filter((t) => now - t < WINDOW_MS)
  list.push(now)
  fails.set(ip, list)
  if (fails.size > 5000) fails.clear()
}
export function clearFails(ip: string) {
  fails.delete(ip)
}
