import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

/**
 * Criptografia do token da Meta (AES-256-GCM). SOMENTE servidor.
 * META_TOKEN_KEY: 32 bytes em base64 (gere com `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`).
 * Formato salvo: base64(iv).base64(tag).base64(dados).
 */
function key(): Buffer | null {
  const raw = process.env.META_TOKEN_KEY?.trim()
  if (!raw) return null
  const buf = Buffer.from(raw, 'base64')
  return buf.length === 32 ? buf : null
}

export function tokenCryptoReady(): boolean {
  return key() !== null
}

export function encryptToken(plain: string): string {
  const k = key()
  if (!k) throw new Error('META_TOKEN_KEY ausente ou inválida (precisa de 32 bytes em base64).')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', k, iv)
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64')).join('.')
}

export function decryptToken(stored: string): string {
  const k = key()
  if (!k) throw new Error('META_TOKEN_KEY ausente ou inválida.')
  const [iv, tag, data] = stored.split('.').map((p) => Buffer.from(p, 'base64'))
  if (!iv || !tag || !data) throw new Error('Token armazenado em formato inválido.')
  const decipher = createDecipheriv('aes-256-gcm', k, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}
