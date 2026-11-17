import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { decryptToken, encryptToken, tokenCryptoReady } from '../lib/meta/crypto'
import { firstPurchase, spDate } from '../lib/meta/api'
import { authParams } from '../lib/meta/graph'

describe('criptografia do token da Meta', () => {
  const prev = process.env.META_TOKEN_KEY
  beforeAll(() => {
    process.env.META_TOKEN_KEY = randomBytes(32).toString('base64')
  })
  afterAll(() => {
    if (prev === undefined) delete process.env.META_TOKEN_KEY
    else process.env.META_TOKEN_KEY = prev
  })

  it('cifra e decifra (ida e volta) sem expor o texto', () => {
    expect(tokenCryptoReady()).toBe(true)
    const stored = encryptToken('EAAB-token-de-teste')
    expect(stored).not.toContain('EAAB')
    expect(decryptToken(stored)).toBe('EAAB-token-de-teste')
  })

  it('usa IV aleatório (mesmo token gera textos diferentes)', () => {
    expect(encryptToken('x')).not.toBe(encryptToken('x'))
  })

  it('rejeita conteúdo adulterado (GCM)', () => {
    const [iv, tag, data] = encryptToken('segredo').split('.')
    const tampered = Buffer.from(data!, 'base64')
    tampered[0] = tampered[0]! ^ 0xff
    expect(() => decryptToken([iv, tag, tampered.toString('base64')].join('.'))).toThrow()
  })

  it('recusa chave com tamanho errado', () => {
    process.env.META_TOKEN_KEY = Buffer.from('curta').toString('base64')
    expect(tokenCryptoReady()).toBe(false)
    expect(() => encryptToken('x')).toThrow()
    process.env.META_TOKEN_KEY = randomBytes(32).toString('base64')
  })
})

describe('leitura das compras da Meta', () => {
  it('usa o primeiro tipo de compra presente, sem somar duplicados', () => {
    expect(
      firstPurchase([
        { action_type: 'purchase', value: '10' },
        { action_type: 'omni_purchase', value: '12' },
        { action_type: 'offsite_conversion.fb_pixel_purchase', value: '10' },
      ]),
    ).toBe(12)
    expect(firstPurchase([{ action_type: 'purchase', value: '7.5' }])).toBe(7.5)
    expect(firstPurchase([{ action_type: 'link_click', value: '99' }])).toBe(0)
    expect(firstPurchase(undefined)).toBe(0)
  })

  it('datas no fuso de São Paulo (virada do dia às 03:00 UTC)', () => {
    expect(spDate(0, new Date('2026-11-16T02:30:00Z'))).toBe('2026-11-15')
    expect(spDate(0, new Date('2026-11-16T03:30:00Z'))).toBe('2026-11-16')
    expect(spDate(-1, new Date('2026-11-16T12:00:00Z'))).toBe('2026-11-15')
  })
})

describe('appsecret_proof', () => {
  it('é adicionado quando META_APP_SECRET existe', () => {
    const prev = process.env.META_APP_SECRET
    process.env.META_APP_SECRET = 'segredo-teste'
    const qs = authParams('tok', { fields: 'id' })
    expect(qs.get('appsecret_proof')).toMatch(/^[a-f0-9]{64}$/)
    delete process.env.META_APP_SECRET
    expect(authParams('tok').has('appsecret_proof')).toBe(false)
    if (prev !== undefined) process.env.META_APP_SECRET = prev
  })
})
