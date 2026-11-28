import { describe, expect, it } from 'vitest'
import { nextRunAt } from '../lib/reports/format'

describe('agenda de segunda-feira', () => {
  it('próxima execução é segunda 09:00 de Brasília', () => {
    // sábado 28/11/2026 12:00 BRT
    const n = nextRunAt([1], '09:00', new Date('2026-11-28T15:00:00Z'))
    expect(n).toBe('2026-11-30T12:00:00.000Z')
  })
  it('depois do horário na segunda, pula para a semana seguinte', () => {
    const n = nextRunAt([1], '09:00', new Date('2026-11-30T12:01:00Z'))
    expect(n).toBe('2026-12-07T12:00:00.000Z')
  })
})
