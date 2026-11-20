/**
 * Núcleo do SDR no WhatsApp — usado pela API da extensão (service role), pelo painel
 * (sessão/RLS) e espelhado no robô local. SOMENTE servidor.
 *
 * Regras centrais:
 *   - o lead é a linha de `prospect_leads` (telefone único por workspace);
 *   - mudar de etapa PARA a cadência atual e INSCREVE na cadência ativa da nova etapa;
 *   - mensagens que nós iniciamos respeitam a janela/limites (sdr_settings) — quem aplica é o robô.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeBrPhone } from './providers/osm'

export const STAGES = ['novo', 'contatado', 'respondeu', 'qualificado', 'reuniao', 'proposta', 'cliente', 'perdido'] as const
export type Stage = (typeof STAGES)[number]

export const STAGE_LABEL: Record<Stage, string> = {
  novo: 'Novo',
  contatado: 'Contatado',
  respondeu: 'Respondeu',
  qualificado: 'Qualificado',
  reuniao: 'Reunião',
  proposta: 'Proposta',
  cliente: 'Cliente',
  perdido: 'Perdido',
}

/** Atalhos digitados na conversa do WhatsApp Web (#reuniao etc.) → etapa. */
export const HASH_COMMANDS: Record<string, Stage> = {
  '#novo': 'novo',
  '#contatado': 'contatado',
  '#respondeu': 'respondeu',
  '#qualificado': 'qualificado',
  '#reuniao': 'reuniao',
  '#reunião': 'reuniao',
  '#proposta': 'proposta',
  '#cliente': 'cliente',
  '#fechou': 'cliente',
  '#perdido': 'perdido',
}

export function isStage(v: unknown): v is Stage {
  return typeof v === 'string' && (STAGES as readonly string[]).includes(v)
}

/** Variações do número brasileiro (celulares antigos aparecem sem o 9 extra). */
export function phoneVariants(raw: string): string[] {
  const d = normalizeBrPhone(raw) ?? String(raw).replace(/\D/g, '')
  const out = new Set([d])
  if (d.startsWith('55') && d.length === 13 && d[4] === '9') out.add(d.slice(0, 4) + d.slice(5))
  else if (d.startsWith('55') && d.length === 12 && /[6-9]/.test(d[4] ?? '')) out.add(`${d.slice(0, 4)}9${d.slice(4)}`)
  return Array.from(out).filter((p) => /^\d{10,15}$/.test(p))
}

export function renderTemplate(body: string, lead: { name: string }): string {
  const first = String(lead.name ?? '').trim()
  return body.replace(/\{nome\}/gi, first || 'tudo bem')
}

// ---------------------------------------------------------------------------
// Padrões iniciais (criados na primeira vez que o workspace usa o SDR)
// ---------------------------------------------------------------------------
const OPT_OUT = 'Se não quiser receber mensagens, é só responder SAIR.'

export const DEFAULT_CADENCES: { name: string; stage: Stage; steps: { wait_hours: number; body: string }[] }[] = [
  {
    name: 'Primeiro contato',
    stage: 'novo',
    steps: [
      { wait_hours: 0, body: `Olá, {nome}! Tudo bem? Trabalho com marketing para restaurantes e vi o perfil de vocês. Posso te mostrar em 2 minutos uma ideia para aumentar os pedidos no delivery?\n\n${OPT_OUT}` },
      { wait_hours: 24, body: 'Oi, {nome}! Conseguiu ver minha mensagem? Tenho um exemplo de um restaurante da região que dobrou os pedidos em 60 dias. Quer que eu te mande?' },
      { wait_hours: 72, body: '{nome}, passando para saber se faz sentido conversarmos 15 minutos esta semana. Posso te mandar uns horários?' },
      { wait_hours: 168, body: 'Última mensagem por aqui, {nome}, para não incomodar. Se em algum momento quiser aumentar as vendas do delivery, é só me chamar. 👊' },
    ],
  },
  {
    name: 'Proposta enviada',
    stage: 'proposta',
    steps: [
      { wait_hours: 48, body: 'Oi, {nome}! Conseguiu dar uma olhada na proposta? Se tiver qualquer dúvida, te explico rapidinho.' },
      { wait_hours: 96, body: '{nome}, quer que a gente marque 15 minutos para fechar os detalhes e começar ainda este mês?' },
    ],
  },
]

export const DEFAULT_QUICK_REPLIES: { stage: Stage | null; title: string; body: string }[] = [
  { stage: 'novo', title: 'Apresentação', body: 'Olá, {nome}! Tudo bem? Trabalho com marketing para restaurantes. Posso te mostrar uma ideia rápida para aumentar os pedidos no delivery?' },
  { stage: 'respondeu', title: 'Qualificar', body: 'Que bom, {nome}! Para eu entender melhor: vocês já anunciam no Instagram/Facebook hoje? E quantos pedidos por dia fazem no delivery, mais ou menos?' },
  { stage: 'qualificado', title: 'Convite reunião', body: '{nome}, que tal uma conversa de 30 minutos por vídeo para eu te mostrar o plano? Tenho horário amanhã às 10h ou às 15h. Qual fica melhor?' },
  { stage: 'reuniao', title: 'Confirmar reunião', body: 'Perfeito, {nome}! Reunião confirmada. Te mando o link do Google Meet por aqui. Até lá!' },
  { stage: 'proposta', title: 'Enviar proposta', body: '{nome}, segue a proposta que conversamos. Qualquer dúvida, me chama aqui.' },
  { stage: null, title: 'Sem tempo agora', body: 'Sem problema, {nome}! Quando for um bom momento para você, me avisa por aqui.' },
]

/** Garante a configuração do SDR + cadências e respostas rápidas padrão (idempotente). */
export async function ensureSdrDefaults(db: SupabaseClient, workspaceId: string): Promise<void> {
  const { data: existing } = await db.from('sdr_settings').select('workspace_id').eq('workspace_id', workspaceId).maybeSingle()
  if (existing) return
  const { error } = await db.from('sdr_settings').insert({ workspace_id: workspaceId })
  if (error && error.code !== '23505') throw new Error(`sdr_settings: ${error.code}`)
  if (error) return // outra requisição criou ao mesmo tempo

  const { data: cads } = await db
    .from('sdr_cadences')
    .insert(DEFAULT_CADENCES.map((c) => ({ workspace_id: workspaceId, name: c.name, stage: c.stage, steps: c.steps })))
    .select('id, stage')
  const first = (cads ?? []).find((c) => c.stage === 'novo')
  if (first) await db.from('sdr_settings').update({ first_contact_cadence_id: first.id }).eq('workspace_id', workspaceId)
  await db
    .from('sdr_quick_replies')
    .insert(DEFAULT_QUICK_REPLIES.map((q, i) => ({ workspace_id: workspaceId, stage: q.stage, title: q.title, body: q.body, sort_order: i })))
}

// ---------------------------------------------------------------------------
// Funil + cadência
// ---------------------------------------------------------------------------
type Cadence = { id: string; name: string; stage: string; steps: { wait_hours: number; body: string }[] }

/** Para a cadência ativa do lead (ex.: respondeu, mudou de etapa, opt-out). */
export async function stopEnrollment(db: SupabaseClient, workspaceId: string, leadId: string, reason: string): Promise<void> {
  const { data: active } = await db
    .from('sdr_enrollments')
    .update({ status: 'parada', stop_reason: reason.slice(0, 120), next_run_at: null })
    .eq('workspace_id', workspaceId)
    .eq('lead_id', leadId)
    .eq('status', 'ativa')
    .select('id')
  const ids = (active ?? []).map((e) => e.id)
  if (ids.length) {
    await db
      .from('sdr_tasks')
      .update({ status: 'cancelada', error: `cadência parada: ${reason}`.slice(0, 200) })
      .eq('workspace_id', workspaceId)
      .in('enrollment_id', ids)
      .in('status', ['pendente', 'aguardando_aprovacao'])
  }
}

/** Inscreve o lead na cadência ativa da etapa (se houver). Primeiro passo agenda a partir de agora. */
export async function enrollForStage(db: SupabaseClient, workspaceId: string, leadId: string, stage: Stage): Promise<string | null> {
  const { data: cad } = await db
    .from('sdr_cadences')
    .select('id, name, stage, steps')
    .eq('workspace_id', workspaceId)
    .eq('stage', stage)
    .eq('active', true)
    .order('created_at')
    .limit(1)
    .maybeSingle()
  const cadence = cad as Cadence | null
  if (!cadence || !Array.isArray(cadence.steps) || cadence.steps.length === 0) return null
  const first = cadence.steps[0]!
  const { data, error } = await db
    .from('sdr_enrollments')
    .insert({
      workspace_id: workspaceId,
      lead_id: leadId,
      cadence_id: cadence.id,
      step_index: 0,
      next_run_at: new Date(Date.now() + Math.max(0, Number(first.wait_hours) || 0) * 3_600_000).toISOString(),
    })
    .select('id')
    .single()
  if (error) return null // já tem cadência ativa (índice único) — mantém a atual
  return data.id
}

/** Muda a etapa: para a cadência atual e inscreve na da nova etapa. */
export async function changeStage(db: SupabaseClient, workspaceId: string, leadId: string, stage: Stage, opts: { enroll?: boolean } = {}): Promise<void> {
  await stopEnrollment(db, workspaceId, leadId, `etapa → ${stage}`)
  const patch: Record<string, unknown> = { stage }
  if (stage === 'perdido' || stage === 'cliente') patch.needs_human = false
  await db.from('prospect_leads').update(patch).eq('workspace_id', workspaceId).eq('id', leadId)
  if (opts.enroll !== false && stage !== 'perdido' && stage !== 'cliente') await enrollForStage(db, workspaceId, leadId, stage)
}

// ---------------------------------------------------------------------------
// Ficha do lead (o que a extensão mostra ao lado da conversa)
// ---------------------------------------------------------------------------
export const LEAD_COLS =
  'id, name, phone, niche, category, city, uf, address, website, source, status, stage, deal_value, score, qualification, ai_paused, needs_human, handoff_reason, last_inbound_at, last_outbound_at, wa_exists, meeting_at, found_at, updated_at'

export async function findLeadByPhone(db: SupabaseClient, workspaceId: string, phone: string) {
  const variants = phoneVariants(phone)
  if (!variants.length) return null
  const { data } = await db.from('prospect_leads').select(LEAD_COLS).eq('workspace_id', workspaceId).in('phone', variants).limit(1).maybeSingle()
  return data
}

export async function leadView(db: SupabaseClient, workspaceId: string, leadId: string) {
  const [lead, notes, tasks, messages, enrollment, settings] = await Promise.all([
    db.from('prospect_leads').select(LEAD_COLS).eq('workspace_id', workspaceId).eq('id', leadId).maybeSingle(),
    db.from('sdr_notes').select('id, body, remind_at, done, created_at, updated_at').eq('workspace_id', workspaceId).eq('lead_id', leadId).order('created_at', { ascending: false }).limit(30),
    db
      .from('sdr_tasks')
      .select('id, kind, body, status, scheduled_at, respects_window, error, updated_at')
      .eq('workspace_id', workspaceId)
      .eq('lead_id', leadId)
      .in('status', ['aguardando_aprovacao', 'pendente', 'enviando', 'falhou'])
      .order('scheduled_at')
      .limit(20),
    db.from('sdr_messages').select('id, direction, body, sent_by, created_at').eq('workspace_id', workspaceId).eq('lead_id', leadId).order('created_at', { ascending: false }).limit(30),
    db
      .from('sdr_enrollments')
      .select('id, step_index, next_run_at, status, sdr_cadences ( name, steps )')
      .eq('workspace_id', workspaceId)
      .eq('lead_id', leadId)
      .eq('status', 'ativa')
      .maybeSingle(),
    db.from('sdr_settings').select('stage_labels, ai_enabled, ai_mode').eq('workspace_id', workspaceId).maybeSingle(),
  ])
  if (!lead.data) return null
  const l = lead.data as any
  const stageLabels = { ...STAGE_LABEL, ...((settings.data?.stage_labels as Record<string, string>) ?? {}) }
  const { data: quick } = await db
    .from('sdr_quick_replies')
    .select('id, stage, title, body')
    .eq('workspace_id', workspaceId)
    .or(`stage.is.null,stage.eq.${l.stage}`)
    .order('sort_order')
  const enr = enrollment.data as any
  const cad = enr ? (Array.isArray(enr.sdr_cadences) ? enr.sdr_cadences[0] : enr.sdr_cadences) : null
  return {
    lead: { ...l, deal_value: l.deal_value == null ? null : Number(l.deal_value), etag: `"${l.updated_at}"` },
    stages: STAGES.map((key) => ({ key, label: stageLabels[key] ?? STAGE_LABEL[key] })),
    commands: HASH_COMMANDS,
    notes: notes.data ?? [],
    tasks: (tasks.data ?? []).map((t: any) => ({ ...t, etag: `"${t.updated_at}"` })),
    messages: (messages.data ?? []).reverse(),
    cadence: enr && cad ? { name: cad.name, step: enr.step_index + 1, total: Array.isArray(cad.steps) ? cad.steps.length : 0, next_run_at: enr.next_run_at } : null,
    quick_replies: (quick ?? []).map((q: any) => ({ ...q, preview: renderTemplate(q.body, l) })),
    ai: { enabled: Boolean(settings.data?.ai_enabled), mode: settings.data?.ai_mode ?? 'auto' },
  }
}
