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

import { clientHealth, daysUntil } from '../lib/health'
import { finalize, firstOf } from '../lib/meta/insights'

describe('saúde do cliente (bolinha da Visão geral)', () => {
  const now = new Date('2026-11-17T15:00:00Z')
  it('vermelho com saldo devedor, saldo baixo ou término próximo', () => {
    expect(clientHealth({ accountsCount: 1, balance: -10, daysLeft: -1, termination: null, now }).health).toBe('risk')
    expect(clientHealth({ accountsCount: 1, balance: 50, daysLeft: 2.4, termination: null, now }).reason).toBe('Saldo baixo (~2d)')
    expect(clientHealth({ accountsCount: 1, balance: 900, daysLeft: 20, termination: '2026-11-19', now }).reason).toBe('Termina em 2d')
    expect(clientHealth({ accountsCount: 1, balance: 900, daysLeft: 20, termination: '2026-11-17', now }).reason).toBe('Termina hoje')
  })
  it('verde quando tudo está tranquilo; azul para conta sem cliente; cinza sem conta', () => {
    expect(clientHealth({ accountsCount: 1, balance: 900, daysLeft: 20, termination: '2026-12-20', now }).health).toBe('ok')
    expect(clientHealth({ accountsCount: 1, balance: 0, daysLeft: null, termination: null, now }).health).toBe('ok')
    expect(clientHealth({ unlinked: true, accountsCount: 1, balance: -5, daysLeft: -1, termination: null, now }).health).toBe('unlinked')
    expect(clientHealth({ accountsCount: 0, balance: null, daysLeft: null, termination: null, now }).health).toBe('none')
  })
  it('conta dias no fuso de São Paulo', () => {
    expect(daysUntil('2026-11-18T02:00:00Z', new Date('2026-11-17T12:00:00Z'))).toBe(0) // 23h de 17/11 em SP
  })
})

describe('métricas da apresentação do cliente', () => {
  it('calcula ROAS, CTR do link, CPC e custo por compra a partir das somas', () => {
    const m = finalize({ spend: 200, revenue: 800, impressions: 10000, reach: 6000, linkClicks: 250, addToCart: 40, purchases: 10 })
    expect(m.roas).toBe(4)
    expect(m.ctr).toBe(2.5)
    expect(m.cpc).toBe(0.8)
    expect(m.cpm).toBe(20)
    expect(m.costPerPurchase).toBe(20)
  })
  it('sem divisão por zero', () => {
    const m = finalize({ spend: 0, revenue: 0, impressions: 0, reach: 0, linkClicks: 0, addToCart: 0, purchases: 0 })
    expect([m.roas, m.ctr, m.cpc, m.cpm, m.costPerPurchase]).toEqual([0, 0, 0, 0, 0])
  })
  it('adições ao carrinho: primeiro tipo presente', () => {
    expect(firstOf([{ action_type: 'add_to_cart', value: '3' }, { action_type: 'omni_add_to_cart', value: '5' }], ['omni_add_to_cart', 'add_to_cart'])).toBe(5)
  })
})
