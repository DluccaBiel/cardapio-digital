import { describe, expect, it } from 'vitest'
import { hashToken, recordFail, tokenMatches, tooManyFails } from '../lib/admin-token'

const TOKEN = 'a'.repeat(40)
describe('login do ADM por chave', () => {
  it('aceita a chave certa por hash ou texto e recusa o resto', () => {
    expect(tokenMatches(TOKEN, { hash: hashToken(TOKEN) })).toBe(true)
    expect(tokenMatches(TOKEN, { plain: TOKEN })).toBe(true)
    expect(tokenMatches('b'.repeat(40), { hash: hashToken(TOKEN) })).toBe(false)
    expect(tokenMatches('curta', { plain: 'curta' })).toBe(false)
    expect(tokenMatches(TOKEN, {})).toBe(false)
  })
  it('bloqueia depois de 5 erros por IP', () => {
    const ip = 'x1'
    for (let i = 0; i < 5; i++) recordFail(ip)
    expect(tooManyFails(ip)).toBe(true)
    expect(tooManyFails('outro')).toBe(false)
  })
})
