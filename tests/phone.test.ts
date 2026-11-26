import { describe, expect, it } from 'vitest'
import { normalizeBrPhone, parseManualContacts } from '../lib/phone'

describe('telefones do público', () => {
  it('normaliza para DDI 55', () => {
    expect(normalizeBrPhone('(61) 99999-8888')).toBe('5561999998888')
    expect(normalizeBrPhone('+55 61 3333-4444')).toBe('556133334444')
    expect(normalizeBrPhone('123')).toBeNull()
  })
  it('lê um contato por linha, sem duplicar', () => {
    const r = parseManualContacts('Pizzaria do Zé; 61 99999-8888\n61999998888\n\nlixo\n5561988887777 - Bar Alfa')
    expect(r).toEqual([
      { name: 'Pizzaria do Zé', phone: '5561999998888' },
      { name: 'Bar Alfa', phone: '5561988887777' },
    ])
  })
})
