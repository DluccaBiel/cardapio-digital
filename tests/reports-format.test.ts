import { describe, expect, it } from 'vitest'
import type { CampaignResult } from '../lib/reports/blocks'
import { emptyMetrics } from '../lib/reports/blocks'
import { composeReport, DEFAULT_SHOW, highlights, nextRunAt, rangeLong, ranges, reportMessage, staggered, type ReportSource } from '../lib/reports/format'

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

// Números do modelo de relatório de vendas enviado pelo cliente.
const sales: ReportSource = {
  ...src,
  period: { since: '2026-10-18', until: '2026-11-16' },
  previous: null,
  topAds: [],
  balance: { kind: 'card', available: 0, debt: 0, unbilled: 0, daysLeft: null },
  campaigns: [
    {
      ...camp('9', 'sales', 245.6, 67, 7755),
      prev: null,
      reach: 15251,
      impressions: 46216,
      metrics: {
        ...emptyMetrics(),
        impressions: 46216, reach: 15251, clicks: 3697, linkClicks: 2110, outboundClicks: 2110, engagements: 32396, reactions: 406, comments: 13,
        saves: 25, follows: 37, landingViews: 1462, purchases: 67, revenue: 7755, addToCart: 121, checkout: 87, videoViews: 29790, video50: 8564,
        video75: 5488, video100: 3626,
      },
    },
  ],
  reach: 15251,
  impressions: 46216,
}

describe('relatório montado', () => {
  it('separa por objetivo: vendas (compras/ROAS), mensagens (conversas), perfil (visitas)', () => {
    const p = composeReport(src, { mode: 'merged', selected: [], show: DEFAULT_SHOW })
    expect(p.blocks.map((b) => b.kind)).toEqual(['sales', 'messages', 'profile'])
    expect(p.totals).toMatchObject({ spend: 450, reach: 2500, spendDelta: 100 })
    const msg = reportMessage(p)
    expect(msg).toContain('📊 *RELATÓRIO DE RESULTADOS — Pizzaria Teste*')
    expect(msg).toContain('📅 Período: 16 a 22 de novembro de 2026')
    expect(msg).toContain('🎯 Objetivo: 🛒 Vendas + 💬 Mensagens + 📲 Visitas ao perfil')
    expect(msg).toContain('🛒 *VENDAS*')
    expect(msg).toContain('• Compras: 12')
    expect(msg).toContain('• ROAS: 5x')
    expect(msg).toContain('• Conversas iniciadas: 40')
    expect(msg).toContain('• Visitas ao perfil: 200')
    expect(msg).toContain('Total investido')
    expect(msg).toContain('Saldo (Pix)')
    expect(msg).toContain('Melhor anúncio:* Vídeo pizza')
  })
  it('só campanhas escolhidas: totais e melhores anúncios seguem a seleção', () => {
    const p = composeReport(src, { mode: 'separate', selected: ['2'], show: DEFAULT_SHOW })
    expect(p.blocks).toHaveLength(1)
    expect(p.totals.spend).toBe(100)
    expect(p.totals.reach).toBe(1000)
    expect(p.topAds).toHaveLength(0)
  })
  it('modelo sem saldo e sem alcance some da mensagem', () => {
    const p = composeReport(sales, { mode: 'merged', selected: [], show: { ...DEFAULT_SHOW, balance: false, general: false } })
    const msg = reportMessage(p)
    expect(msg).not.toContain('Alcance & Impressões')
    expect(msg).not.toContain('Saldo')
  })
})

describe('mensagem completa (modelo do relatório de vendas)', () => {
  const p = composeReport(sales, { mode: 'merged', selected: [], show: DEFAULT_SHOW })
  const msg = reportMessage(p)
  const has = (re: RegExp) => expect(msg).toMatch(re)
  it('cabeçalho por extenso e objetivo', () => {
    has(/📅 Período: 18 de outubro a 16 de novembro de 2026/)
    has(/🎯 Objetivo: 🛒 Vendas\n/)
    expect(msg).not.toContain('━━') // um objetivo só: sem divisórias
  })
  it('investimento & retorno', () => {
    has(/💰 \*Investimento & Retorno\*/)
    has(/• Investimento: R\$\s245,60/)
    has(/• Receita Ads: R\$\s7\.755,00/)
    has(/• ROAS: 31,6x/)
    has(/• Compras: 67/)
    has(/• CPA: R\$\s3,67/)
  })
  it('alcance, cliques, engajamento, perfil, conversões e vídeo', () => {
    has(/• Alcance: 15\.251 pessoas/)
    has(/• Impressões: 46\.216/)
    has(/• Cliques totais: 3\.697/)
    has(/• Cliques no link: 2\.110/)
    has(/• Cliques de saída: 2\.110/)
    has(/• CTR: 4,57%/)
    has(/• Reações: 406/)
    has(/• Salvamentos: 25/)
    has(/• Novos seguidores: 37/)
    has(/• Landing page views: 1\.462/)
    has(/• Taxa de LP view: 69,29%/)
    has(/• Adicionar ao carrinho: 121/)
    has(/• Checkout iniciado: 87/)
    has(/🎬 \*Vídeo\*\n• Visualizações: 29\.790\n• 50% assistido: 8\.564\n• 75% assistido: 5\.488\n• 100% assistido: 3\.626/)
  })
  it('pontos fortes calculados', () => {
    has(/✅ \*Pontos fortes:\*\n• ROAS excelente \(31,6x\) — retorno muito acima da média\./)
    expect(highlights(p).strong.length).toBeGreaterThan(0)
  })
  it('sem métrica (zero) a linha não aparece', () => {
    expect(msg).not.toContain('Cadastros')
    expect(msg).not.toContain('Compartilhamentos')
  })
  it('datas por extenso', () => {
    expect(rangeLong({ since: '2026-11-16', until: '2026-11-22' })).toBe('16 a 22 de novembro de 2026')
    expect(rangeLong({ since: '2025-12-28', until: '2026-01-03' })).toBe('28 de dezembro de 2025 a 3 de janeiro de 2026')
    expect(rangeLong({ since: '2026-11-22', until: '2026-11-22' })).toBe('22 de novembro de 2026')
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
