import { describe, expect, it } from 'vitest'
import type { CampaignResult } from '../lib/reports/blocks'
import { composeReport, DEFAULT_SHOW, nextRunAt, ranges, reportMessage, staggered, type ReportSource } from '../lib/reports/format'

const camp = (id: string, kind: CampaignResult['kind'], spend: number, result: number, revenue = 0): CampaignResult => ({
  id,
  name: `Campanha ${id}`,
  status: 'ACTIVE',
  objective: null,
  kind,
  spend,
  reach: 1000,
  impressions: 3000,
  clicks: 50,
  result,
  revenue,
  prev: { spend: spend / 2, result: result / 2, revenue: 0 },
})

const src: ReportSource = {
  adAccountId: '11111111-1111-1111-1111-111111111111',
  clientId: null,
  title: 'Pizzaria Teste',
  accountName: 'CA Pizzaria',
  accountId: 'act_1',
  workspaceName: 'Agência',
  periodKey: 'last',
  period: { since: '2026-11-16', until: '2026-11-22' },
  previous: { since: '2026-11-09', until: '2026-11-15' },
  campaigns: [camp('1', 'sales', 300, 12, 1500), camp('2', 'messages', 100, 40), camp('3', 'profile', 50, 200)],
  reach: 2500,
  impressions: 9000,
  topAds: [{ id: 'a1', name: 'Vídeo pizza', campaignId: '1', kind: 'sales', spend: 120, result: 7, thumbnail: null }],
  balance: { kind: 'pix', available: 420, debt: 0, unbilled: 0, daysLeft: 6 },
  generatedAt: '2026-11-23T12:00:00Z',
}

describe('relatório montado', () => {
  it('separa por objetivo: vendas (compras/ROAS), mensagens (conversas), perfil (visitas)', () => {
    const p = composeReport(src, { mode: 'merged', selected: [], show: DEFAULT_SHOW })
    expect(p.blocks.map((b) => b.kind)).toEqual(['sales', 'messages', 'profile'])
    expect(p.totals).toMatchObject({ spend: 450, reach: 2500, spendDelta: 100 })
    const msg = reportMessage(p)
    expect(msg).toContain('*Relatório de tráfego — Pizzaria Teste*')
    expect(msg).toContain('Compras: *12*')
    expect(msg).toContain('ROAS 5,00x')
    expect(msg).toContain('Conversas iniciadas: *40*')
    expect(msg).toContain('Visitas ao perfil: *200*')
    expect(msg).toContain('Saldo (Pix)')
    expect(msg).toContain('Melhor anúncio: Vídeo pizza')
  })
  it('só campanhas escolhidas: totais e melhores anúncios seguem a seleção', () => {
    const p = composeReport(src, { mode: 'separate', selected: ['2'], show: DEFAULT_SHOW })
    expect(p.blocks).toHaveLength(1)
    expect(p.totals.spend).toBe(100)
    expect(p.totals.reach).toBe(1000)
    expect(p.topAds).toHaveLength(0)
  })
  it('modelo sem saldo e sem visão geral some da mensagem', () => {
    const p = composeReport(src, { mode: 'merged', selected: [], show: { ...DEFAULT_SHOW, balance: false, general: false } })
    const msg = reportMessage(p)
    expect(msg).not.toContain('Investimento')
    expect(msg).not.toContain('Saldo')
  })
})

describe('agenda (São Paulo)', () => {
  // 2026-11-23 é segunda. 11:00Z = 08:00 em SP.
  it('próxima execução no mesmo dia se o horário ainda não passou', () => {
    expect(nextRunAt([1], '09:00', new Date('2026-11-23T11:00:00Z'))).toBe('2026-11-23T12:00:00.000Z')
  })
  it('passou o horário → próxima semana; outros dias', () => {
    expect(nextRunAt([1], '09:00', new Date('2026-11-23T12:00:00Z'))).toBe('2026-11-30T12:00:00.000Z')
    expect(nextRunAt([3, 5], '18:30', new Date('2026-11-23T12:00:00Z'))).toBe('2026-11-25T21:30:00.000Z')
    expect(nextRunAt([], '09:00')).toBeNull()
  })
  it('período "semana passada" = seg a dom anteriores', () => {
    expect(ranges('last', new Date('2026-11-23T12:00:00Z')).cur).toEqual({ since: '2026-11-16', until: '2026-11-22' })
  })
  it('envios escalonados com intervalo entre min e max (mínimo 20 s)', () => {
    const t = staggered(new Date('2026-11-23T12:00:00Z'), 3, 60, 180, () => 0.5)
    expect(t).toEqual(['2026-11-23T12:00:00.000Z', '2026-11-23T12:02:00.000Z', '2026-11-23T12:04:00.000Z'])
    expect(staggered(new Date('2026-11-23T12:00:00Z'), 2, 5, 5)[1]).toBe('2026-11-23T12:00:20.000Z')
  })
})
