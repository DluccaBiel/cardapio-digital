import { describe, expect, it } from 'vitest'
import { brVariants, canSendNow, isOptOut, nextDelayMs, renderMessage, spDayStartIso, spParts } from '../apps/whatsapp-worker/src/schedule.mjs'
import { foodQuery, nominatimToElements, normalizeBrPhone, parseOverpass } from '../lib/sdr/providers/osm'

// 2026-11-18 é quarta-feira. 15:00Z = 12:00 em São Paulo.
const WED_NOON = new Date('2026-11-18T15:00:00Z')
const base = {
  status: 'agendada',
  start_date: '2026-11-18',
  days_of_week: [1, 2, 3, 4, 5],
  window_start: '09:00:00',
  window_end: '18:00:00',
  next_send_at: null as string | null,
}

describe('agenda do robô (America/Sao_Paulo)', () => {
  it('converte para o fuso de São Paulo', () => {
    expect(spParts(WED_NOON)).toEqual({ date: '2026-11-18', time: '12:00', dow: 3 })
    expect(spParts(new Date('2026-11-19T02:30:00Z'))).toEqual({ date: '2026-11-18', time: '23:30', dow: 3 })
    expect(spDayStartIso(WED_NOON)).toBe('2026-11-18T03:00:00.000Z')
  })

  it('envia dentro do dia/horário e respeita o intervalo', () => {
    expect(canSendNow(base, WED_NOON)).toBe(true)
    expect(canSendNow({ ...base, next_send_at: '2026-11-18T15:01:00Z' }, WED_NOON)).toBe(false)
    expect(canSendNow({ ...base, next_send_at: '2026-11-18T14:59:00Z' }, WED_NOON)).toBe(true)
  })

  it('bloqueia fora da janela, do dia, antes do início ou pausado', () => {
    expect(canSendNow(base, new Date('2026-11-18T11:59:00Z'))).toBe(false) // 08:59 SP
    expect(canSendNow(base, new Date('2026-11-18T21:00:00Z'))).toBe(false) // 18:00 SP (fim exclusivo)
    expect(canSendNow({ ...base, days_of_week: [6, 0] }, WED_NOON)).toBe(false)
    expect(canSendNow({ ...base, start_date: '2026-11-19' }, WED_NOON)).toBe(false)
    expect(canSendNow({ ...base, status: 'pausada' }, WED_NOON)).toBe(false)
    expect(canSendNow({ ...base, status: 'enviando' }, WED_NOON)).toBe(true)
  })

  it('intervalo aleatório fica entre min e max (mínimo absoluto 20 s)', () => {
    expect(nextDelayMs(60, 180, () => 0)).toBe(60_000)
    expect(nextDelayMs(60, 180, () => 1)).toBe(180_000)
    expect(nextDelayMs(5, 10, () => 0)).toBe(20_000)
  })

  it('personaliza {nome}, detecta opt-out e gera variações do 9º dígito', () => {
    expect(renderMessage('Olá, {nome}! {NOME}', 'Pizzaria X')).toBe('Olá, Pizzaria X! Pizzaria X')
    expect(isOptOut(' SAIR ')).toBe(true)
    expect(isOptOut('parar!')).toBe(true)
    expect(isOptOut('quero saber mais')).toBe(false)
    expect(brVariants('5519991234567')).toEqual(['5519991234567', '551991234567'])
    expect(brVariants('551991234567')).toEqual(['551991234567', '5519991234567'])
    expect(brVariants('551933334444')).toEqual(['551933334444'])
  })
})

describe('agente de prospecção (OpenStreetMap)', () => {
  it('normaliza telefones brasileiros', () => {
    expect(normalizeBrPhone('+55 19 99123-4567')).toBe('5519991234567')
    expect(normalizeBrPhone('(19) 3333-4444')).toBe('551933334444')
    expect(normalizeBrPhone('019 99123 4567')).toBe('5519991234567')
    expect(normalizeBrPhone('0 21 19 99123-4567')).toBe('5519991234567') // 0 + operadora
    expect(normalizeBrPhone('+55 19 3333-4444; +55 19 99999-0000')).toBe('551933334444')
    expect(normalizeBrPhone('1234')).toBeNull()
    expect(normalizeBrPhone('(19) 8123-45678')).toBeNull() // 11 dígitos sem o 9
    expect(normalizeBrPhone(undefined)).toBeNull()
  })

  it('extrai leads com nome + telefone, sem duplicar número', () => {
    const leads = parseOverpass({
      elements: [
        { type: 'node', id: 1, tags: { name: 'Burger da Vila', amenity: 'fast_food', phone: '+55 19 99123-4567', 'addr:street': 'Rua A', 'addr:housenumber': '10' } },
        { type: 'way', id: 2, tags: { name: 'Padaria Sol', shop: 'bakery', 'contact:whatsapp': '19 98888-7777', website: 'https://padariasol.com' } },
        { type: 'node', id: 3, tags: { name: 'Sem telefone', amenity: 'restaurant' } },
        { type: 'node', id: 4, tags: { amenity: 'cafe', phone: '19 3333-1111' } }, // sem nome
        { type: 'node', id: 5, tags: { name: 'Filial Burger', amenity: 'fast_food', phone: '(19) 99123-4567' } }, // duplicado
      ],
    })
    expect(leads).toHaveLength(2)
    expect(leads[0]).toMatchObject({ external_id: 'node/1', name: 'Burger da Vila', phone: '5519991234567', category: 'Lanchonete / fast food', address: 'Rua A, 10' })
    expect(leads[1]).toMatchObject({ external_id: 'way/2', phone: '5519988887777', category: 'Padaria', website: 'https://padariasol.com' })
  })

  it('consulta só estabelecimentos food com telefone na área', () => {
    const q = foodQuery(3600298285)
    expect(q).toContain('area(id:3600298285)')
    expect(q).toContain('fast_food')
    expect(q).toContain('bakery')
    expect(q).toContain('contact:whatsapp')
  })

  it('plano B (Nominatim): converte resultados para o formato de leads', () => {
    const leads = parseOverpass({
      elements: nominatimToElements([
        {
          place_id: 1,
          osm_type: 'node',
          osm_id: 10,
          category: 'shop',
          type: 'bakery',
          name: 'Padaria Central',
          extratags: { phone: '+55 19 3232-1010' },
          address: { road: 'Av. Brasil', house_number: '500', suburb: 'Centro' },
        },
        { place_id: 2, osm_type: 'way', osm_id: 20, category: 'amenity', type: 'restaurant', name: 'Sem tel', extratags: null },
      ]),
    })
    expect(leads).toEqual([
      { external_id: 'node/10', name: 'Padaria Central', phone: '551932321010', category: 'Padaria', address: 'Av. Brasil, 500 — Centro', website: null },
    ])
  })
})

describe('SDR no robô: janela, cadência e texto', async () => {
  const { inOutreachWindow, advanceCadence, messageText, typingMs } = await import('../apps/whatsapp-worker/src/schedule.mjs')
  // 2026-11-21 é sábado; 23:00Z = 20:00 em SP; 2026-11-22 é domingo.
  it('janela seg-sáb 9h-20h (fim exclusivo)', () => {
    const s = { outreach_days: [1, 2, 3, 4, 5, 6], outreach_start: '09:00:00', outreach_end: '20:00:00' }
    expect(inOutreachWindow(s, new Date('2026-11-21T22:59:00Z'))).toBe(true) // sáb 19:59
    expect(inOutreachWindow(s, new Date('2026-11-21T23:00:00Z'))).toBe(false) // sáb 20:00
    expect(inOutreachWindow(s, new Date('2026-11-22T15:00:00Z'))).toBe(false) // domingo
    expect(inOutreachWindow(s, new Date('2026-11-20T11:59:00Z'))).toBe(false) // sex 08:59
  })
  it('cadência: próximo passo agenda a espera dele a partir do envio; último passo conclui', () => {
    const steps = [{ wait_hours: 0 }, { wait_hours: 24 }, { wait_hours: 72 }]
    const now = new Date('2026-11-20T12:00:00Z')
    expect(advanceCadence(steps, 0, now)).toEqual({ done: false, stepIndex: 1, nextRunAt: '2026-11-21T12:00:00.000Z' })
    expect(advanceCadence(steps, 2, now)).toEqual({ done: true, stepIndex: 3, nextRunAt: null })
  })
  it('texto de mensagens recebidas (texto, legenda, áudio, temporária)', () => {
    expect(messageText({ conversation: 'oi' })).toBe('oi')
    expect(messageText({ extendedTextMessage: { text: 'link' } })).toBe('link')
    expect(messageText({ imageMessage: { caption: 'cardápio' } })).toBe('cardápio')
    expect(messageText({ audioMessage: {} })).toBe('[áudio]')
    expect(messageText({ ephemeralMessage: { message: { conversation: 'some' } } })).toBe('some')
  })
  it('"digitando…" proporcional ao texto, entre ~2 e 9 s', () => {
    expect(typingMs('oi', () => 0.5)).toBeLessThan(2500)
    expect(typingMs('x'.repeat(1000), () => 0.5)).toBe(9000)
  })
})
