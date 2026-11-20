import { createClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { freeSlots, isSlotFree, type Calendar } from '../lib/google/calendar'
import { generateAiReply, toClaudeMessages } from '../lib/sdr/ai'

// ---------------------------------------------------------------------------
// Puros: horários livres e montagem da conversa
// ---------------------------------------------------------------------------
describe('agenda: horários livres (America/Sao_Paulo)', () => {
  const rules = { meeting_days: [1, 2, 3, 4, 5], meeting_start: '10:00:00', meeting_end: '17:00:00', meeting_minutes: 30 }
  // 2026-11-20 sexta 12:00 SP (15:00Z)
  const now = new Date('2026-11-20T15:00:00Z')
  it('respeita dias úteis, janela, 2 h de antecedência e compromissos ocupados', () => {
    const busy = [{ start: '2026-11-23T13:00:00Z', end: '2026-11-23T14:00:00Z' }] // seg 10:00-11:00 SP ocupado
    const slots = freeSlots(rules, busy, now)
    expect(slots.length).toBeGreaterThan(0)
    for (const s of slots) {
      const sp = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(s.start))
      expect(sp).not.toMatch(/Sat|Sun/)
      const hhmm = sp.slice(-5)
      expect(hhmm >= '10:00' && hhmm <= '16:30').toBe(true)
      expect(Date.parse(s.start)).toBeGreaterThanOrEqual(now.getTime() + 2 * 3_600_000)
      expect(isSlotFree(s.start, 30, busy)).toBe(true)
    }
    expect(slots.some((s) => s.start === '2026-11-23T13:00:00.000Z')).toBe(false) // seg 10:00 ocupado
    expect(slots[0]!.start).toBe('2026-11-20T17:00:00.000Z') // hoje 14:00 SP (12:00 + 2 h)
  })
  it('isSlotFree detecta sobreposição', () => {
    expect(isSlotFree('2026-11-23T13:30:00Z', 30, [{ start: '2026-11-23T13:00:00Z', end: '2026-11-23T14:00:00Z' }])).toBe(false)
    expect(isSlotFree('2026-11-23T14:00:00Z', 30, [{ start: '2026-11-23T13:00:00Z', end: '2026-11-23T14:00:00Z' }])).toBe(true)
  })
})

describe('conversa → mensagens do Claude', () => {
  it('lead = user, nós = assistant, junta seguidas e começa em user', () => {
    const m = toClaudeMessages([
      { direction: 'out', body: 'Olá! (1º contato)' },
      { direction: 'in', body: 'oi' },
      { direction: 'in', body: 'quero saber' },
      { direction: 'out', body: 'claro' },
      { direction: 'in', body: 'quanto custa?' },
    ])
    expect(m).toEqual([
      { role: 'user', content: 'oi\nquero saber' },
      { role: 'assistant', content: 'claro' },
      { role: 'user', content: 'quanto custa?' },
    ])
  })
})

// ---------------------------------------------------------------------------
// Integração com o Supabase LOCAL (Claude e Google simulados) — pula sem banco local
// ---------------------------------------------------------------------------
const SB = process.env.LOCAL_API_URL
const SR = process.env.LOCAL_SERVICE_ROLE_KEY
const local = !!SB && !!SR && /^http:\/\/(127\.0\.0\.1|localhost)/.test(SB)

describe.skipIf(!local)('IA do SDR (banco local, Claude/Google simulados)', () => {
  const WS = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const db = local ? createClient(SB!, SR!, { auth: { persistSession: false } }) : (null as any)
  const now = new Date('2026-11-20T15:00:00Z')
  let leadId = ''

  /** Claude simulado: devolve as respostas roteirizadas, uma por chamada; registra o que recebeu. */
  function fakeClaude(script: ((req: any) => any)[]) {
    const calls: any[] = []
    return {
      calls,
      client: { beta: { messages: { create: async (req: any) => { calls.push(JSON.parse(JSON.stringify(req))); const f = script[calls.length - 1]; if (!f) throw new Error('roteiro acabou'); return f(req) } } } } as any,
    }
  }
  const text = (t: string) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: t }] })
  const tool = (name: string, input: any, id = `tu_${name}`) => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name, input }] })
  const created: any[] = []
  const calendar: Calendar = {
    connected: true,
    busy: async () => [],
    createMeeting: async (i) => {
      created.push(i)
      return { id: 'ev1', meetLink: 'https://meet.google.com/abc-defg-hij', htmlLink: null }
    },
  }

  async function resetLead(extra: Record<string, unknown> = {}) {
    await db.from('sdr_messages').delete().eq('lead_id', leadId)
    await db.from('sdr_tasks').delete().eq('lead_id', leadId)
    await db.from('sdr_notes').delete().eq('lead_id', leadId)
    await db.from('prospect_leads').update({ stage: 'respondeu', status: 'respondeu', ai_paused: false, needs_human: false, handoff_reason: null, meeting_at: null, score: null, ...extra }).eq('id', leadId)
    const t0 = Date.now() - 60_000
    await db.from('sdr_messages').insert([
      { workspace_id: WS, lead_id: leadId, direction: 'out', body: 'Olá! Posso te mostrar uma ideia?', sent_by: 'cadence', created_at: new Date(t0).toISOString() },
      { workspace_id: WS, lead_id: leadId, direction: 'in', body: 'Pode sim, quero marcar uma conversa', sent_by: 'lead', created_at: new Date(t0 + 30_000).toISOString() },
    ])
  }

  beforeAll(async () => {
    await db.from('sdr_settings').delete().eq('workspace_id', WS)
    await db.from('sdr_settings').insert({ workspace_id: WS, ai_enabled: true, ai_max_replies_per_lead_day: 2, playbook: 'Somos a Undercut.', prices: 'Plano a partir de R$ 1.500/mês.' })
    const { data } = await db.from('prospect_leads').insert({ workspace_id: WS, name: 'Pizzaria IA', phone: '5519955554444', source: 'manual' }).select('id').single()
    leadId = data.id
  })
  afterAll(async () => {
    if (leadId) await db.from('prospect_leads').delete().eq('id', leadId)
    await db.from('sdr_settings').delete().eq('workspace_id', WS)
  })

  it('marca reunião: consulta horários, agenda o oferecido e responde com o link do Meet', async () => {
    await resetLead()
    created.length = 0
    let offered = ''
    const f = fakeClaude([
      () => tool('get_free_slots', {}),
      (req) => {
        const last = req.messages[req.messages.length - 1].content[0]
        offered = JSON.parse(last.content)[0].start
        return tool('book_meeting', { start: offered })
      },
      () => text('Fechado! Reunião confirmada. Link: https://meet.google.com/abc-defg-hij'),
    ])
    const out = await generateAiReply(db, WS, leadId, { client: f.client, calendar, now })
    expect(out.action).toBe('reply')
    expect(out.action === 'reply' && out.booked?.meetLink).toBe('https://meet.google.com/abc-defg-hij')
    const { data: lead } = await db.from('prospect_leads').select('stage, meeting_at').eq('id', leadId).single()
    expect(lead.stage).toBe('reuniao')
    expect(Date.parse(lead.meeting_at)).toBe(Date.parse(offered))
    expect(created).toHaveLength(1)
    const { data: notes } = await db.from('sdr_notes').select('body, remind_at').eq('lead_id', leadId)
    expect(notes[0].body).toMatch(/Reunião marcada pela IA/)
    expect(Date.parse(notes[0].remind_at)).toBe(Date.parse(offered) - 86_400_000)
    // prompt: roteiro e preços do workspace no system, modelo e esforço baixos, fallbacks ligados
    expect(f.calls[0].model).toBe('claude-opus-5-5')
    expect(f.calls[0].output_config.effort).toBe('low')
    expect(f.calls[0].fallbacks).toBe('default')
    expect(f.calls[0].system[0].text).toContain('R$ 1.500/mês')
    expect(f.calls[0].tools.map((t: any) => t.name)).toEqual(['get_free_slots', 'book_meeting', 'update_lead', 'handoff'])
  })

  it('horário inventado é recusado (erro para o modelo), sem criar evento', async () => {
    await resetLead()
    created.length = 0
    const f = fakeClaude([() => tool('book_meeting', { start: '2026-11-25T13:00:00.000Z' }), () => text('Desculpe, vou te passar horários disponíveis.')])
    const out = await generateAiReply(db, WS, leadId, { client: f.client, calendar, now })
    expect(out.action).toBe('reply')
    expect(created).toHaveLength(0)
    const result = f.calls[1].messages[f.calls[1].messages.length - 1].content[0]
    expect(result.is_error).toBe(true)
  })

  it('handoff: marca "precisa de você" com o motivo', async () => {
    await resetLead()
    const f = fakeClaude([() => tool('handoff', { reason: 'Pediu desconto especial' }), () => text('Vou pedir para o responsável te chamar, tudo bem?')])
    const out = await generateAiReply(db, WS, leadId, { client: f.client, calendar, now })
    expect(out.action).toBe('handoff')
    expect(out.action === 'handoff' && out.text).toMatch(/responsável/)
    const { data: lead } = await db.from('prospect_leads').select('needs_human, handoff_reason').eq('id', leadId).single()
    expect(lead).toEqual({ needs_human: true, handoff_reason: 'Pediu desconto especial' })
  })

  it('recusa de segurança do modelo → passa para você, nada é enviado', async () => {
    await resetLead()
    const f = fakeClaude([() => ({ stop_reason: 'refusal', content: [] })])
    const out = await generateAiReply(db, WS, leadId, { client: f.client, calendar, now })
    expect(out.action).toBe('handoff')
    expect(out.action === 'handoff' && out.text).toBeUndefined()
  })

  it('agenda não conectada: a ferramenta pede handoff em vez de inventar horário', async () => {
    await resetLead()
    const f = fakeClaude([() => tool('get_free_slots', {}), () => tool('handoff', { reason: 'Combinar horário' }), () => text('')])
    await generateAiReply(db, WS, leadId, { client: f.client, calendar: { connected: false } as any, now })
    const r = f.calls[1].messages[f.calls[1].messages.length - 1].content[0]
    expect(r.content).toMatch(/Agenda não conectada/)
  })

  it('não responde: IA pausada, aguardando você, opt-out, ou última mensagem é nossa', async () => {
    const f = fakeClaude([])
    await resetLead({ ai_paused: true })
    expect((await generateAiReply(db, WS, leadId, { client: f.client, calendar, now })).action).toBe('skip')
    await resetLead({ needs_human: true })
    expect((await generateAiReply(db, WS, leadId, { client: f.client, calendar, now })).action).toBe('skip')
    await resetLead({ status: 'opt_out' })
    expect((await generateAiReply(db, WS, leadId, { client: f.client, calendar, now })).action).toBe('skip')
    await resetLead()
    await db.from('sdr_messages').insert({ workspace_id: WS, lead_id: leadId, direction: 'out', body: 'já respondemos', sent_by: 'ai', created_at: new Date(Date.now() + 1000).toISOString() })
    expect((await generateAiReply(db, WS, leadId, { client: f.client, calendar, now })).action).toBe('skip')
    expect(f.calls).toHaveLength(0)
  })

  it('limite de respostas da IA por lead no dia → passa para você', async () => {
    await resetLead()
    const today = new Date().toISOString()
    await db.from('sdr_tasks').insert([
      { workspace_id: WS, lead_id: leadId, kind: 'ai_reply', body: 'a', status: 'enviada', created_at: today },
      { workspace_id: WS, lead_id: leadId, kind: 'ai_reply', body: 'b', status: 'enviada', created_at: today },
    ])
    const f = fakeClaude([])
    const out = await generateAiReply(db, WS, leadId, { client: f.client, calendar })
    expect(out.action).toBe('handoff')
    const { data: lead } = await db.from('prospect_leads').select('needs_human, handoff_reason').eq('id', leadId).single()
    expect(lead.needs_human).toBe(true)
    expect(lead.handoff_reason).toMatch(/Limite de 2 respostas/)
  })
})
