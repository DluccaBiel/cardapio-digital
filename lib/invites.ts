import { createHash, randomBytes } from 'crypto'

/** Validade do link de convite. */
export const INVITE_TTL_DAYS = 7

/** Token do link: 24 bytes aleatórios (192 bits), em base64url. Só o hash vai para o banco. */
export function newInviteToken(): string {
  return randomBytes(24).toString('base64url')
}

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Formato esperado do token (evita consulta ao banco com lixo). */
export function isInviteToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{32}$/.test(token)
}

export type InviteState = 'pending' | 'used' | 'revoked' | 'expired'

export function inviteState(i: { used_at: string | null; revoked_at: string | null; expires_at: string }, now = Date.now()): InviteState {
  if (i.used_at) return 'used'
  if (i.revoked_at) return 'revoked'
  if (new Date(i.expires_at).getTime() < now) return 'expired'
  return 'pending'
}
