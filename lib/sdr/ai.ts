/**
 * IA do SDR: responde LEADS no WhatsApp 24h, qualifica e marca reunião no Google Agenda.
 * SOMENTE servidor (ANTHROPIC_API_KEY). Chamada pelo robô via POST /api/v1/sdr/ai/reply.
 *
 * Proteções:
 *   - só responde se a IA está ligada, o lead não está pausado/opt-out/"precisa de você"
 *     e a última mensagem da conversa é DELE (nada de mandar 2 respostas seguidas);
 *   - no máx. `ai_max_replies_per_lead_day` respostas por lead por dia → depois chama você;
 *   - ferramenta `handoff` passa a conversa para você (pedido de humano / dúvida);
 *   - preços e promessas só os do roteiro (sdr_settings.playbook/prices/forbidden);
 *   - recusa de segurança do modelo → chama você, nada é enviado.
 */
import Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import { freeSlots, GoogleError, isSlotFree, workspaceCalendar, type Calendar } from '../google/calendar'
import { spDayStart } from './time'

export const AI_MODEL = 'claude-opus-5-5'
const MAX_STEPS = 6

export type AiOutcome =
  | { action: 'reply'; text: string; booked?: { start: string; meetLink: string | null } }
  | { action: 'handoff'; reason: string; text?: string }
  | { action: 'skip'; reason: string }

type Deps = { client?: Pick<Anthropic, 'beta'>; calendar?: Calendar; now?: Date }

const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'get_free_slots',
    description:
      'Lista horários livres na agenda do vendedor para uma reunião online (Google Meet) com o lead. Use ANTES de sugerir qualquer horário; ofereça 2 ou 3 opções da lista, nunca invente horários.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'book_meeting',
    description:
      'Marca a reunião no Google Agenda quando o lead CONFIRMAR um dos horários oferecidos. `start` deve ser exatamente um valor `start` retornado por get_free_slots. Retorna o link do Meet para você enviar ao lead.',
    input_schema: { type: 'object', properties: { start: { type: 'string', description: 'ISO 8601 do início, copiado de get_free_slots' } }, required: ['start'], additionalProperties: false },
    strict: true,
  },
  {
    name: 'update_lead',
    description:
      'Registra a qualificação do lead (o que você descobriu na conversa) e, se fizer sentido, avança a etapa: "qualificado" quando há interesse real e perfil; "perdido" quando ele deixou claro que não quer.',
    input_schema: {
      type: 'object',
      properties: {
        stage: { type: 'string', enum: ['respondeu', 'qualificado', 'perdido'] },
        score: { type: 'integer', minimum: 0, maximum: 100, description: 'Chance de virar cliente (0-100)' },
        notes: { type: 'string', description: 'Resumo curto do que o lead disse (pedidos/dia, se anuncia, quem decide, dor principal)' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'handoff',
    description:
      'Passa a conversa para o vendedor humano. Use quando o lead pedir para falar com uma pessoa, reclamar, ou quando você não tiver certeza da resposta pelo roteiro (preço não informado, pedido fora do escopo, negociação).',
    input_schema: { type: 'object', properties: { reason: { type: 'string', description: 'Motivo curto, para o vendedor ler' } }, required: ['reason'], additionalProperties: false },
    strict: true,
  },
]

function systemPrompt(s: any): string {
  return [
    'Você é o SDR (pré-vendas) de uma assessoria de marketing para restaurantes e negócios de alimentação, conversando pelo WhatsApp em português do Brasil.',
    'Objetivo: entender o negócio do lead, qualificar (pedidos por dia, se já anuncia, quem decide, principal dor) e, havendo interesse, marcar uma reunião online de 30 minutos.',
    '',
    'Como escrever:',
    '- Mensagens curtas de WhatsApp (1 a 3 frases), tom humano e direto, sem formalidade excessiva, no máximo 1 emoji.',
    '- Uma pergunta por mensagem. Não repita o que já foi dito na conversa.',
    '- Responda só com o texto da mensagem que será enviada ao lead — sem aspas, sem explicações, sem markdown.',
    '',
    'Regras que você nunca quebra:',
    '- Só fale preços, prazos e condições que estiverem no ROTEIRO/PREÇOS abaixo. Se o lead pedir algo que não está lá, use a ferramenta handoff.',
    '- Nunca prometa resultados garantidos.',
    '- Para propor horários, chame get_free_slots e ofereça 2 ou 3 opções da lista. Quando o lead escolher, chame book_meeting e envie o link do Meet retornado.',
    '- Se o lead pedir para falar com uma pessoa, reclamar, ou você não souber responder com segurança, chame handoff.',
    '- Se o lead disser que não tem interesse, agradeça, chame update_lead com stage "perdido" e não insista.',
    '- Não revele que é uma IA a menos que perguntem diretamente; se perguntarem, diga a verdade.',
    '',
    `ROTEIRO DO VENDEDOR:\n${s.playbook?.trim() || '(vazio — apresente-se como assessoria de marketing para restaurantes e foque em entender o negócio e marcar a reunião)'}`,
    '',
    `PREÇOS E CONDIÇÕES QUE PODE FALAR:\n${s.prices?.trim() || '(nenhum — se perguntarem preço, diga que depende do tamanho da operação e proponha a reunião; se insistirem, use handoff)'}`,
    '',
    `NUNCA FALE OU PROMETA:\n${s.forbidden?.trim() || '(nada além das regras acima)'}`,
  ].join('\n')
}

function leadContext(lead: any, now: Date): string {
  const when = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'full', timeStyle: 'short' }).format(now)
  return [
    `Agora: ${when} (horário de Brasília).`,
    `Lead: ${lead.name}${lead.category ? ` (${lead.category})` : ''}${lead.city ? ` — ${lead.city}${lead.uf ? `/${lead.uf}` : ''}` : ''}.`,
    `Etapa no funil: ${lead.stage}.`,
    lead.qualification && Object.keys(lead.qualification).length ? `Já sabemos: ${JSON.stringify(lead.qualification)}` : '',
    lead.meeting_at ? `Reunião já marcada para ${new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(new Date(lead.meeting_at))}.` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

/** Histórico → mensagens do Claude (lead = user; nós = assistant). Começa sempre em user. */
export function toClaudeMessages(history: { direction: string; body: string }[]): Anthropic.Beta.BetaMessageParam[] {
  const out: Anthropic.Beta.BetaMessageParam[] = []
  for (const m of history) {
    const role = m.direction === 'in' ? 'user' : 'assistant'
    if (!out.length && role === 'assistant') continue
    const last = out[out.length - 1]
    if (last && last.role === role && typeof last.content === 'string') last.content = `${last.content}\n${m.body}`
    else out.push({ role, content: m.body })
  }
  return out
}

export async function generateAiReply(db: SupabaseClient, workspaceId: string, leadId: string, deps: Deps = {}): Promise<AiOutcome> {
  const now = deps.now ?? new Date()
  const [{ data: s }, { data: lead }, { data: hist }] = await Promise.all([
    db.from('sdr_settings').select('*').eq('workspace_id', workspaceId).maybeSingle(),
    db.from('prospect_leads').select('id, name, phone, category, city, uf, stage, status, ai_paused, needs_human, qualification, meeting_at').eq('workspace_id', workspaceId).eq('id', leadId).maybeSingle(),
    db.from('sdr_messages').select('direction, body, created_at').eq('workspace_id', workspaceId).eq('lead_id', leadId).order('created_at', { ascending: false }).limit(40),
  ])
  if (!s?.ai_enabled) return { action: 'skip', reason: 'IA desligada' }
  if (!lead) return { action: 'skip', reason: 'lead não encontrado' }
  if (lead.status === 'opt_out' || lead.status === 'invalido') return { action: 'skip', reason: 'lead opt-out/inválido' }
  if (lead.ai_paused) return { action: 'skip', reason: 'você assumiu este lead' }
  if (lead.needs_human) return { action: 'skip', reason: 'aguardando você' }
  const history = (hist ?? []).reverse()
  if (!history.length || history[history.length - 1]!.direction !== 'in') return { action: 'skip', reason: 'nada novo do lead' }

  const { count: today } = await db
    .from('sdr_tasks')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .eq('lead_id', leadId)
    .eq('kind', 'ai_reply')
    .gte('created_at', spDayStart(now))
  if ((today ?? 0) >= s.ai_max_replies_per_lead_day) {
    await flagHuman(db, workspaceId, leadId, `Limite de ${s.ai_max_replies_per_lead_day} respostas da IA hoje — continue você.`)
    return { action: 'handoff', reason: 'limite diário de respostas da IA' }
  }

  const client = deps.client ?? new Anthropic()
  const calendar = deps.calendar ?? (await workspaceCalendar(db, workspaceId))
  const rules = { meeting_days: s.meeting_days, meeting_start: s.meeting_start, meeting_end: s.meeting_end, meeting_minutes: s.meeting_minutes }
  let offered: string[] = []
  let booked: { start: string; meetLink: string | null } | undefined
  let handoffReason: string | null = null

  const messages = toClaudeMessages(history)
  if (!messages.length) return { action: 'skip', reason: 'sem mensagem do lead' }

  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await client.beta.messages.create({
      model: AI_MODEL,
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low' },
      system: [
        { type: 'text', text: systemPrompt(s), cache_control: { type: 'ephemeral' } },
        { type: 'text', text: leadContext(lead, now) },
      ],
      tools: TOOLS,
      messages,
    })

    if (res.stop_reason === 'refusal') {
      await flagHuman(db, workspaceId, leadId, 'A IA preferiu não responder esta mensagem — veja a conversa.')
      return { action: 'handoff', reason: 'recusa do modelo' }
    }

    const toolUses = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')
    if (res.stop_reason !== 'tool_use' || !toolUses.length) {
      const text = res.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim()
      if (handoffReason) return { action: 'handoff', reason: handoffReason, ...(text ? { text } : {}) }
      if (!text) {
        await flagHuman(db, workspaceId, leadId, 'A IA não conseguiu montar uma resposta — veja a conversa.')
        return { action: 'handoff', reason: 'resposta vazia' }
      }
      return { action: 'reply', text: text.slice(0, 1500), ...(booked ? { booked } : {}) }
    }

    messages.push({ role: 'assistant', content: res.content })
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = []
    for (const tu of toolUses) {
      const input = (tu.input ?? {}) as Record<string, unknown>
      let content = ''
      let isError = false
      try {
        if (tu.name === 'get_free_slots') {
          if (!calendar.connected) {
            content = 'Agenda não conectada. Não proponha horários: use handoff para o vendedor combinar o horário.'
          } else {
            const from = now.toISOString()
            const to = new Date(now.getTime() + 8 * 86_400_000).toISOString()
            const slots = freeSlots(rules, await calendar.busy(from, to), now)
            offered = slots.map((x) => x.start)
            content = slots.length ? JSON.stringify(slots) : 'Sem horários livres nos próximos dias. Use handoff.'
          }
        } else if (tu.name === 'book_meeting') {
          const start = String(input.start ?? '')
          if (!offered.includes(start)) {
            isError = true
            content = 'Horário inválido: use exatamente um "start" retornado por get_free_slots nesta conversa (chame get_free_slots de novo se precisar).'
          } else {
            const busy = await calendar.busy(start, new Date(Date.parse(start) + s.meeting_minutes * 60_000).toISOString())
            if (!isSlotFree(start, s.meeting_minutes, busy)) {
              isError = true
              content = 'Esse horário acabou de ser ocupado. Chame get_free_slots e ofereça outros.'
            } else {
              const ev = await calendar.createMeeting({
                startIso: start,
                minutes: s.meeting_minutes,
                title: `Reunião · ${lead.name}`,
                description: `Marcada pela IA do SDR (Undercut) via WhatsApp.\nLead: ${lead.name} · +${lead.phone}`,
              })
              booked = { start, meetLink: ev.meetLink }
              await db.from('prospect_leads').update({ stage: 'reuniao', meeting_at: start }).eq('workspace_id', workspaceId).eq('id', leadId)
              await db.from('sdr_enrollments').update({ status: 'parada', stop_reason: 'reunião marcada', next_run_at: null }).eq('workspace_id', workspaceId).eq('lead_id', leadId).eq('status', 'ativa')
              await db.from('sdr_notes').insert({
                workspace_id: workspaceId,
                lead_id: leadId,
                body: `Reunião marcada pela IA: ${new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'full', timeStyle: 'short' }).format(new Date(start))}${ev.meetLink ? ` · ${ev.meetLink}` : ''}`,
                remind_at: new Date(Date.parse(start) - 24 * 3_600_000).toISOString(),
              })
              content = JSON.stringify({ ok: true, start, meet_link: ev.meetLink })
            }
          }
        } else if (tu.name === 'update_lead') {
          const patch: Record<string, unknown> = {}
          if (typeof input.score === 'number') patch.score = Math.max(0, Math.min(100, Math.round(input.score)))
          if (typeof input.notes === 'string' && input.notes.trim()) patch.qualification = { ...(lead.qualification ?? {}), resumo: input.notes.trim().slice(0, 600) }
          if (input.stage === 'qualificado' || input.stage === 'perdido' || input.stage === 'respondeu') patch.stage = input.stage
          if (Object.keys(patch).length) await db.from('prospect_leads').update(patch).eq('workspace_id', workspaceId).eq('id', leadId)
          content = 'ok'
        } else if (tu.name === 'handoff') {
          handoffReason = String(input.reason ?? 'pedido de atendimento humano').slice(0, 200)
          await flagHuman(db, workspaceId, leadId, handoffReason)
          content = 'Vendedor avisado. Se fizer sentido, escreva uma mensagem curta dizendo que a pessoa responsável vai continuar o atendimento; senão, responda vazio.'
        } else {
          isError = true
          content = `Ferramenta desconhecida: ${tu.name}`
        }
      } catch (e) {
        isError = true
        content = e instanceof GoogleError ? `${e.message} Use handoff.` : 'Falha ao executar. Use handoff.'
      }
      results.push({ type: 'tool_result', tool_use_id: tu.id, content, ...(isError ? { is_error: true } : {}) })
    }
    messages.push({ role: 'user', content: results })
  }
  await flagHuman(db, workspaceId, leadId, 'A IA não concluiu a resposta — veja a conversa.')
  return { action: 'handoff', reason: 'limite de passos' }
}

async function flagHuman(db: SupabaseClient, workspaceId: string, leadId: string, reason: string) {
  await db.from('prospect_leads').update({ needs_human: true, handoff_reason: reason.slice(0, 200) }).eq('workspace_id', workspaceId).eq('id', leadId)
}
