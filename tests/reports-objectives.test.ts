import { describe, expect, it } from 'vitest'
import { buildBlocks, classifyCampaign, resultOf, type CampaignResult } from '../lib/meta/reports'

describe('tipo da campanha pelo objetivo + conjuntos', () => {
  it('vendas, mensagens, visitas ao perfil, tráfego, cadastros, engajamento e alcance', () => {
    expect(classifyCampaign('OUTCOME_SALES')).toBe('sales')
    expect(classifyCampaign('CONVERSIONS')).toBe('sales')
    expect(classifyCampaign('OUTCOME_ENGAGEMENT', ['CONVERSATIONS'], ['MESSENGER'])).toBe('messages')
    expect(classifyCampaign('OUTCOME_ENGAGEMENT', [], ['WHATSAPP'])).toBe('messages')
    expect(classifyCampaign('OUTCOME_TRAFFIC', ['VISIT_INSTAGRAM_PROFILE'], ['INSTAGRAM_PROFILE'])).toBe('profile')
    expect(classifyCampaign('OUTCOME_TRAFFIC', ['LANDING_PAGE_VIEWS'], ['WEBSITE'])).toBe('traffic')
    expect(classifyCampaign('OUTCOME_LEADS', ['LEAD_GENERATION'])).toBe('leads')
    expect(classifyCampaign('OUTCOME_ENGAGEMENT', ['POST_ENGAGEMENT'])).toBe('engagement')
    expect(classifyCampaign('OUTCOME_AWARENESS')).toBe('awareness')
    expect(classifyCampaign(null)).toBe('other')
  })
})

describe('resultado conforme o tipo', () => {
  const raw = {
    spend: '100',
    reach: '5000',
    inline_link_clicks: '80',
    actions: [
      { action_type: 'offsite_conversion.fb_pixel_purchase', value: '6' },
      { action_type: 'omni_purchase', value: '9' },
      { action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '23' },
      { action_type: 'link_click', value: '70' },
      { action_type: 'landing_page_view', value: '55' },
      { action_type: 'post_engagement', value: '310' },
    ],
    action_values: [{ action_type: 'offsite_conversion.fb_pixel_purchase', value: '600' }],
  }
  it('vendas usa a compra do PIXEL (não o omni) e o faturamento', () => expect(resultOf('sales', raw)).toEqual({ result: 6, revenue: 600 }))
  it('mensagens = conversas iniciadas', () => expect(resultOf('messages', raw).result).toBe(23))
  it('tráfego = visualizações da página', () => expect(resultOf('traffic', raw).result).toBe(55))
  it('engajamento e alcance', () => {
    expect(resultOf('engagement', raw).result).toBe(310)
    expect(resultOf('awareness', raw).result).toBe(5000)
  })
})

describe('juntar ou separar campanhas', () => {
  const c = (id: string, kind: CampaignResult['kind'], spend: number, result: number, revenue = 0, prev?: { spend: number; result: number }): CampaignResult => ({
    id,
    name: `Campanha ${id}`,
    status: 'ACTIVE',
    objective: null,
    kind,
    spend,
    reach: 0,
    impressions: 0,
    clicks: 0,
    result,
    revenue,
    prev: prev ? { ...prev, revenue: 0 } : null,
  })
  const list = [c('1', 'sales', 300, 10, 1500, { spend: 200, result: 5 }), c('2', 'sales', 100, 5, 400, { spend: 100, result: 5 }), c('3', 'messages', 50, 25), c('4', 'traffic', 0, 0)]

  it('juntar: um bloco por tipo, somando só o mesmo objetivo; ignora campanha sem gasto', () => {
    const b = buildBlocks(list, 'merged')
    expect(b.map((x) => x.kind)).toEqual(['sales', 'messages'])
    expect(b[0]).toMatchObject({ spend: 400, result: 15, revenue: 1900, roas: 4.75, costPerResult: 26.67, resultLabel: 'Compras' })
    expect(b[0]!.deltaResult).toBe(50) // 15 vs 10
    expect(b[1]).toMatchObject({ result: 25, costPerResult: 2, resultLabel: 'Conversas iniciadas', roas: null })
  })
  it('separar: um bloco por campanha (maior gasto primeiro)', () => {
    const b = buildBlocks(list, 'separate')
    expect(b.map((x) => x.title)).toEqual(['Campanha 1', 'Campanha 2', 'Campanha 3'])
  })
  it('só as campanhas escolhidas', () => {
    const b = buildBlocks(list, 'merged', ['2', '3'])
    expect(b[0]).toMatchObject({ kind: 'sales', spend: 100, result: 5 })
  })
})
