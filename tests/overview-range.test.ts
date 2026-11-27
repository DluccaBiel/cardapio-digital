import { describe, expect, it } from 'vitest'
import { computeRange, isDefaultMonth } from '../lib/overview-range'

const now = new Date('2026-11-26T15:00:00Z') // 12:00 em São Paulo

describe('computeRange', () => {
  it('hoje / ontem', () => {
    expect(computeRange('today', '2026-11-01', {}, now)).toMatchObject({ since: '2026-11-26', until: '2026-11-26' })
    expect(computeRange('yesterday', '2026-11-01', {}, now)).toMatchObject({ since: '2026-11-25', until: '2026-11-25' })
  })
  it('última semana, anterior e 30 dias', () => {
    expect(computeRange('last7', '2026-11-01', {}, now)).toMatchObject({ since: '2026-11-20', until: '2026-11-26' })
    expect(computeRange('prev7', '2026-11-01', {}, now)).toMatchObject({ since: '2026-11-13', until: '2026-11-19' })
    expect(computeRange('last30', '2026-11-01', {}, now)).toMatchObject({ since: '2026-10-28', until: '2026-11-26' })
  })
  it('personalizado (inverte se necessário e limita a hoje)', () => {
    expect(computeRange('custom', '2026-11-01', { from: '2026-11-10', to: '2026-11-05' }, now)).toMatchObject({ since: '2026-11-05', until: '2026-11-10' })
    expect(computeRange('custom', '2026-11-01', { from: '2026-11-10', to: '2026-12-30' }, now).until).toBe('2026-11-26')
  })
  it('mês corrente vai até hoje; mês passado inteiro', () => {
    expect(computeRange('', '2026-11-01', {}, now)).toMatchObject({ since: '2026-11-01', until: '2026-11-26' })
    expect(computeRange('', '2026-10-01', {}, now)).toMatchObject({ since: '2026-10-01', until: '2026-10-31' })
    expect(isDefaultMonth('', '2026-11-01', now)).toBe(true)
    expect(isDefaultMonth('', '2026-10-01', now)).toBe(false)
  })
})
