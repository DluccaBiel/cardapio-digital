// Agente IA de Primeiro Atendimento - Tools (Tool Use)
// Cada ferramenta validada por Zod e executada no servidor

// ============================================================
// TYPES E TYPEsCRIT
// ============================================================

import { z } from 'zod'

export type LeadContext = {
  id: string
  nome: string
  nicho: 'food' | 'estetica'
  anotacao: string
  bant: {
    need: number // 0-3
    authority: number // 0-3
    timing: number // 0-3
    budget: number // 0-3
  }
  ultimas_mensagens: Array<{
    papel: 'humano' | 'ia'
    conteudo: string
    ai_generated: boolean
  }>
  reunioes_marcadas: number
  opt_out: boolean
}

export type BANTResult = {
  need: number // 0-3
  authority: number // 0-3
  timing: number // 0-3
  budget: number // 0-3
  total: number // 0-12
  evidencias: string[]
}

export type MeetingSlot = {
  start_at: string // ISO string
  end_at: string // ISO string
  disponivel: boolean
}

// ============================================================
// TOOL: get_lead_context
// ============================================================

/**
 * Retorna o contexto do lead para o agente IA.
 * Dados do lead, sinais, histórico resumido, BANT atual.
 */
function get_lead_context(lead_id: string): LeadContext {
  // Em produção, consultaríamos o Supabase/Redis
  // Aqui retornamos um objeto placeholder
  return {
    id: lead_id,
    nome: 'Nome do Lead',
    nicho: 'food',
    anotacao: 'Lead importado da base Receita + Google Places',
    bant: {
      need: 2,
      authority: 1,
      timing: 3,
      budget: 1,
    },
    ultimas_mensagens: [
      { papel: 'ia', conteudo: 'Olá! Tudo bem? Vi que sua empresa tem 50 avaliações no Google.', ai_generated: true },
      { papel: 'humano', conteudo: 'Oi, tudo bem. E as vendas?', ai_generated: false },
    ],
    reunioes_marcadas: 0,
    opt_out: false,
  }
}

// ============================================================
// TOOL: update_bant
// ============================================================

/**
 * Atualiza a avaliação BANT com evidência (trecho da conversa).
 */
function update_bant(
  lead_id: string,
  dimension: 'need' | 'authority' | 'timing' | 'budget',
  score: 0 | 1 | 2 | 3,
  evidence: string
) {
  // Em produção, gravaríamos no Supabase/Redis
  // Aqui apenas registramos o que seria feito
  console.log(`BANT atualizado: lead=${lead_id}, dimensão=${dimension}, score=${score}, evidência="${evidence}"`)
}

// ============================================================
// TOOL: get_available_slots
// ============================================================

/**
 * Consulta Google Calendar (OAuth do dono) ou Cal.com
 * para disponibilidade de horários.
 * @returns Promise with available slots
 */
async function get_available_slots(
  lead_id: string,
  range_days: number = 14
): Promise<MeetingSlot[]> {
  // Em produção, consultaríamos o Google Calendar ou Cal.com
  // usando OAuth do dono da agência

  // Placeholder: retorna slots mockados para os próximos 14 dias
  const slots: MeetingSlot[] = []
  const hoje = new Date()

  for (let i = 0; i < range_days; i++) {
    const data = new Date(hoje)
    data.setDate(hoje.getDate() + i)
    if (data.getDay() >= 1 && data.getDay() <= 5) { // Apenas seg–sex
      const inicio = new Date(data)
      inicio.setHours(9, 0, 0)
      const fim = new Date(data)
      fim.setHours(10, 0, 0)
      slots.push({
        start_at: inicio.toISOString(),
        end_at: fim.toISOString(),
        disponivel: true,
      })
      // Segundo slot
      inicio.setHours(11, 0, 0)
      fim.setHours(12, 0, 0)
      slots.push({
        start_at: inicio.toISOString(),
        end_at: fim.toISOString(),
        disponivel: true,
      })
    }
  }

  return slots
}

// ============================================================
// TOOL: book_meeting
// ============================================================

/**
 * Cria evento no Google Calendar/Cal.com e grava em `meetings`.
 * Move stage para `reuniao_marcada`.
 */
function book_meeting(
  lead_id: string,
  slot: MeetingSlot,
  attendee_email?: string
) {
  // Em produção:
  // 1. Criar evento no Google Calendar/Cal.com
  // 2. Gravar em `meetings` table: lead_id, start_at, end_at, calendar_event_id, status
  // 3. Mover stage para `reuniao_marcada`
  // 4. Notificar o consultor (push/e-mail)

  console.log(`Meeting agendado: lead=${lead_id}, slot=${slot.start_at}-${slot.end_at}, attendee=${attendee_email || 'não informado'}`)
}

// ============================================================
// TOOL: handoff_to_human
// ============================================================

/**
 * Pausa o agente IA, notifica o dono (push/e-mail), move para fila "Assumir".
 */
function handoff_to_human(
  lead_id: string,
  reason: string
) {
  // Em produção:
  // 1. Pausar o agente IA nesta conversa
  // 2. Notificar o consultor (push notification / e-mail)
  // 3. Mover o lead para fila "Assumir" (stage especial)
  // 4. Registrar activity: handoff_to_human

  console.log(`Hand-off para humano: lead=${lead_id}, reason="${reason}"`)
}

// ============================================================
// TOOL: mark_opt_out
// ============================================================

/**
 * Grava suppression e encerra.
 */
function mark_opt_out(lead_id: string, channel: 'whatsapp' | 'email') {
  // Em produção:
  // 1. Gravar na suppression_list (valor_hash do contato, kind, reason, created_at)
  // 2. Encadear inscrições de cadência
  // 2. Bloquear novos envios para este lead/neste canal
  // 3. Respondê-lo com confirmação educada

  console.log(`Opt-out registrado: lead=${lead_id}, canal=${channel}`)
}

// ============================================================
// EXPORTS
// ============================================================

export { get_lead_context, update_bant, get_available_slots, book_meeting, handoff_to_human, mark_opt_out }

// ============================================================
// RUBRICA BANT PARA VALIDAÇÃO NO LADO DO SERVIDOR
// ============================================================

// Rubrica BANT adaptada a PMEs de food/estética (cada item 0–3, total 12):
// Need: 3 = dor clara e específica, com impacto | 0 = "está tudo ótimo"
// Authority: 3 = dono/sócio decisor | 0 = funcionário sem influência
// Timing: 3 = ≤ 30 dias | 0 = sem previsão / > 6 meses
// Budget: 3 = já investe e aceita investir | 0 = zero e sem intenção

// Critério de qualificação: BANT >= 7/12 com Authority >= 2
// → Oferecer 2 horários de get_available_slots e agendar com book_meeting
// → Se BANT < 7 após 6 trocas: agradeça, ofereça material/contato futuro e encerre
// → Máximo de 12 mensagens suas por conversa; depois disso, handoff_to_human

// ============================================================
// VALIDAÇÃO ZOD PARA ENTRADA DO AGENTE
// ============================================================

// Schema para validar a entrada do agente IA
export const bantValidationSchema = z.object({
  need: z.number().int().min(0).max(3),
  authority: z.number().int().min(0).max(3),
  timing: z.number().int().min(0).max(3),
  budget: z.number().int().min(0).max(3),
})

export type BantValidationResult = z.infer<typeof bantValidationSchema>

// Função para validar se BANT >= 7/12 com Authority >= 2
export function isBANTQualificado(bant: BantValidationResult): boolean {
  const total = bant.need + bant.authority + bant.timing + bant.budget
  return total >= 7 && bant.authority >= 2
}

// Função para verificar se já passou do limite de mensagens
export function excedeuLimiteMensagens(mensagensRealizadas: number): boolean {
  return mensagensRealizadas >= 12
}

// ============================================================
// SYSTEM PROMPT RESUMO (para ser injetado no prompt do modelo)
// ============================================================

/*
System Prompt Resumo:
- Tom: Português do Brasil, WhatsApp, mensagens curtas (máx. 3 linhas)
- Nunca invente preço/resultado/resultados garantidos
- Se pedir para parar → mark_opt_out + resposta educada
- Se houver irritação/reclamação → handoff_to_human
- Qualifique em BANT conversacional (Need → Authority → Timing → Budget)
- BANT >= 7/12 e Authority >= 2 → ofereça 2 horários e agende
- Máx. 12 mensagens por conversa → depois handoff_to_human
*/