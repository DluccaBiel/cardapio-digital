'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { audit } from '../../../../../lib/audit'
import { getWorkspaceBySlug } from '../../../../../lib/db/workspaces'
import { changeStage, ensureSdrDefaults, leadView, renderTemplate, STAGES, stopEnrollment } from '../../../../../lib/sdr/core'
import { createAdminClient } from '../../../../../lib/supabaseAdmin'
import { createServerClient } from '../../../../../lib/supabaseServer'

type Fail = { ok: false; error: string }
const OPERATORS = ['owner', 'coordenador', 'editor']
const MANAGERS = ['owner', 'coordenador']
const uuid = z.string().uuid()

async function ctx(ws: string, roles = OPERATORS) {
  const workspace = await getWorkspaceBySlug(ws)
  if (!workspace) return { error: 'Workspace não encontrado.' } as const
  if (!roles.includes(workspace.role)) return { error: roles === MANAGERS ? 'Somente dono ou coordenador alteram as configurações do SDR.' : 'Sem permissão para operar o SDR.' } as const
  const db = createServerClient()
  const { data: u } = await db.auth.getUser()
  if (!u.user) return { error: 'Sessão expirada. Entre de novo.' } as const
  return { workspace, db, userId: u.user.id } as const
}
const refresh = (ws: string) => revalidatePath(`/a/${ws}/sdr/whatsapp`)

// ---------------------------------------------------------------------------
// Leads / conversas
// ---------------------------------------------------------------------------
export async function setStageAction(ws: string, leadId: string, stage: string): Promise<{ ok: true } | Fail> {
  const c = await ctx(ws)
  if ('error' in c) return { ok: false, error: c.error! }
  const s = z.enum(STAGES).safeParse(stage)
  if (!uuid.safeParse(leadId).success || !s.success) return { ok: false, error: 'Pedido inválido.' }
  await changeStage(c.db, c.workspace.id, leadId, s.data)
  await audit({ workspaceId: c.workspace.id, actorType: 'user', actorId: c.userId, action: 'sdr_lead.stage', entityType: 'prospect_lead', entityId: leadId, metadata: { stage: s.data } })
  refresh(ws)
  return { ok: true }
}

const flags = z
  .object({ ai_paused: z.boolean().optional(), needs_human: z.literal(false).optional(), deal_value: z.number().min(0).max(10_000_000).nullable().optional(), opt_out: z.literal(true).optional() })
  .refine((v) => Object.keys(v).length > 0)

export async function setLeadFlagsAction(ws: string, leadId: string, input: unknown): Promise<{ ok: true } | Fail> {
  const c = await ctx(ws)
  if ('error' in c) return { ok: false, error: c.error! }
  const p = flags.safeParse(input)
  if (!uuid.safeParse(leadId).success || !p.success) return { ok: false, error: 'Pedido inválido.' }
  const patch: Record<string, unknown> = {}
  if (p.data.ai_paused !== undefined) patch.ai_paused = p.data.ai_paused
  if (p.data.needs_human === false) Object.assign(patch, { needs_human: false, handoff_reason: null })
  if (p.data.deal_value !== undefined) patch.deal_value = p.data.deal_value
  if (p.data.opt_out) Object.assign(patch, { status: 'opt_out', needs_human: false })
  const { error } = await c.db.from('prospect_leads').update(patch).eq('workspace_id', c.workspace.id).eq('id', leadId)
  if (error) return { ok: false, error: 'Não consegui salvar.' }
  if (p.data.opt_out) await stopEnrollment(c.db, c.workspace.id, leadId, 'opt-out')
  refresh(ws)
  return { ok: true }
}

export async function conversationAction(ws: string, leadId: string) {
  const c = await ctx(ws, ['owner', 'coordenador', 'editor', 'visualizador'])
  if ('error' in c) return { ok: false as const, error: c.error! }
  if (!uuid.safeParse(leadId).success) return { ok: false as const, error: 'Lead inválido.' }
  const view = await leadView(c.db, c.workspace.id, leadId)
  if (!view) return { ok: false as const, error: 'Lead não encontrado.' }
  const { data: messages } = await c.db
    .from('sdr_messages')
    .select('id, direction, body, sent_by, created_at')
    .eq('workspace_id', c.workspace.id)
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false })
    .limit(200)
  return { ok: true as const, view: { ...view, messages: (messages ?? []).reverse() } }
}

export async function sendMessageAction(ws: string, leadId: string, body: string): Promise<{ ok: true } | Fail> {
  const c = await ctx(ws)
  if ('error' in c) return { ok: false, error: c.error! }
  const text = z.string().trim().min(1).max(4000).safeParse(body)
  if (!uuid.safeParse(leadId).success || !text.success) return { ok: false, error: 'Escreva a mensagem.' }
  const { data: lead } = await c.db.from('prospect_leads').select('name, status').eq('workspace_id', c.workspace.id).eq('id', leadId).maybeSingle()
  if (!lead) return { ok: false, error: 'Lead não encontrado.' }
  if (lead.status === 'opt_out') return { ok: false, error: 'Este lead pediu para não receber mensagens.' }
  const { error } = await c.db
    .from('sdr_tasks')
    .insert({ workspace_id: c.workspace.id, lead_id: leadId, kind: 'manual', body: renderTemplate(text.data, lead), respects_window: false, created_by: c.userId })
  if (error) return { ok: false, error: 'Não consegui colocar na fila do robô.' }
  refresh(ws)
  return { ok: true }
}

export async function taskAction(ws: string, taskId: string, action: 'approve' | 'cancel', body?: string): Promise<{ ok: true } | Fail> {
  const c = await ctx(ws)
  if ('error' in c) return { ok: false, error: c.error! }
  if (!uuid.safeParse(taskId).success || !['approve', 'cancel'].includes(action)) return { ok: false, error: 'Pedido inválido.' }
  const text = body ? z.string().trim().min(1).max(4000).safeParse(body) : null
  if (text && !text.success) return { ok: false, error: 'Texto inválido.' }
  const patch = action === 'approve' ? { status: 'pendente', scheduled_at: new Date().toISOString(), ...(text?.success ? { body: text.data } : {}) } : { status: 'cancelada', error: 'cancelado pelo usuário' }
  const { data, error } = await c.db
    .from('sdr_tasks')
    .update(patch)
    .eq('workspace_id', c.workspace.id)
    .eq('id', taskId)
    .in('status', action === 'approve' ? ['aguardando_aprovacao'] : ['aguardando_aprovacao', 'pendente', 'falhou'])
    .select('id')
  if (error || !data?.length) return { ok: false, error: 'Este envio já mudou (talvez já tenha saído).' }
  refresh(ws)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Configurações (dono/coordenador)
// ---------------------------------------------------------------------------
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
const days = z.array(z.number().int().min(0).max(6)).min(1).max(7)
const settingsSchema = z
  .object({
    ai_enabled: z.boolean(),
    ai_mode: z.enum(['suggest', 'auto']),
    ai_max_replies_per_lead_day: z.number().int().min(1).max(100),
    ai_reply_delay_seconds: z.number().int().min(0).max(900),
    playbook: z.string().max(6000),
    prices: z.string().max(3000),
    forbidden: z.string().max(3000),
    outreach_days: days,
    outreach_start: hhmm,
    outreach_end: hhmm,
    daily_new_contacts: z.number().int().min(0).max(300),
    interval_min_seconds: z.number().int().min(20).max(3600),
    interval_max_seconds: z.number().int().min(20).max(3600),
    prospect_enabled: z.boolean(),
    prospect_cities: z.array(z.object({ city: z.string().trim().min(2).max(80), uf: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).nullable() })).max(50),
    prospect_every_hours: z.number().int().min(1).max(168),
    meeting_minutes: z.number().int().min(10).max(180),
    meeting_days: days,
    meeting_start: hhmm,
    meeting_end: hhmm,
  })
  .refine((v) => v.interval_max_seconds >= v.interval_min_seconds, { message: 'Intervalo máximo menor que o mínimo.' })
  .refine((v) => v.outreach_end > v.outreach_start, { message: 'Horário de envio: o fim precisa ser depois do início.' })
  .refine((v) => v.meeting_end > v.meeting_start, { message: 'Horário de reuniões: o fim precisa ser depois do início.' })

export async function saveSettingsAction(ws: string, input: unknown): Promise<{ ok: true } | Fail> {
  const c = await ctx(ws, MANAGERS)
  if ('error' in c) return { ok: false, error: c.error! }
  const p = settingsSchema.safeParse(input)
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? 'Configuração inválida.' }
  await ensureSdrDefaults(c.db, c.workspace.id)
  const { error } = await c.db.from('sdr_settings').update(p.data).eq('workspace_id', c.workspace.id)
  if (error) return { ok: false, error: 'Não consegui salvar as configurações.' }
  await audit({ workspaceId: c.workspace.id, actorType: 'user', actorId: c.userId, action: 'sdr_settings.update', entityType: 'workspace', entityId: c.workspace.id, metadata: { ai_enabled: p.data.ai_enabled, ai_mode: p.data.ai_mode, prospect_enabled: p.data.prospect_enabled } })
  refresh(ws)
  return { ok: true }
}

const cadenceSchema = z.object({
  id: uuid.optional(),
  name: z.string().trim().min(1).max(120),
  stage: z.enum(['novo', 'contatado', 'respondeu', 'qualificado', 'reuniao', 'proposta']),
  active: z.boolean(),
  steps: z.array(z.object({ wait_hours: z.number().min(0).max(2160), body: z.string().trim().min(1).max(2000) })).min(1).max(12),
})

export async function saveCadenceAction(ws: string, input: unknown): Promise<{ ok: true } | Fail> {
  const c = await ctx(ws)
  if ('error' in c) return { ok: false, error: c.error! }
  const p = cadenceSchema.safeParse(input)
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? 'Cadência inválida.' }
  const { id, ...row } = p.data
  const q = id
    ? c.db.from('sdr_cadences').update(row).eq('workspace_id', c.workspace.id).eq('id', id)
    : c.db.from('sdr_cadences').insert({ ...row, workspace_id: c.workspace.id })
  const { error } = await q
  if (error) return { ok: false, error: 'Não consegui salvar a cadência.' }
  refresh(ws)
  return { ok: true }
}

export async function deleteCadenceAction(ws: string, id: string): Promise<{ ok: true } | Fail> {
  const c = await ctx(ws, MANAGERS)
  if ('error' in c) return { ok: false, error: c.error! }
  if (!uuid.safeParse(id).success) return { ok: false, error: 'Pedido inválido.' }
  const { error } = await c.db.from('sdr_cadences').delete().eq('workspace_id', c.workspace.id).eq('id', id)
  if (error) return { ok: false, error: 'Não consegui apagar.' }
  refresh(ws)
  return { ok: true }
}

const quickSchema = z.object({
  id: uuid.optional(),
  stage: z.enum(STAGES).nullable(),
  title: z.string().trim().min(1).max(80),
  body: z.string().trim().min(1).max(2000),
})

export async function saveQuickReplyAction(ws: string, input: unknown): Promise<{ ok: true } | Fail> {
  const c = await ctx(ws)
  if ('error' in c) return { ok: false, error: c.error! }
  const p = quickSchema.safeParse(input)
  if (!p.success) return { ok: false, error: 'Preencha título e texto.' }
  const { id, ...row } = p.data
  const { error } = id
    ? await c.db.from('sdr_quick_replies').update(row).eq('workspace_id', c.workspace.id).eq('id', id)
    : await c.db.from('sdr_quick_replies').insert({ ...row, workspace_id: c.workspace.id })
  if (error) return { ok: false, error: 'Não consegui salvar.' }
  refresh(ws)
  return { ok: true }
}

export async function deleteQuickReplyAction(ws: string, id: string): Promise<{ ok: true } | Fail> {
  const c = await ctx(ws, MANAGERS)
  if ('error' in c) return { ok: false, error: c.error! }
  if (!uuid.safeParse(id).success) return { ok: false, error: 'Pedido inválido.' }
  await c.db.from('sdr_quick_replies').delete().eq('workspace_id', c.workspace.id).eq('id', id)
  refresh(ws)
  return { ok: true }
}

export async function disconnectGoogleAction(ws: string): Promise<{ ok: true } | Fail> {
  const c = await ctx(ws, MANAGERS)
  if ('error' in c) return { ok: false, error: c.error! }
  await createAdminClient().from('google_tokens').delete().eq('workspace_id', c.workspace.id)
  await c.db.from('google_connections').delete().eq('workspace_id', c.workspace.id)
  await audit({ workspaceId: c.workspace.id, actorType: 'user', actorId: c.userId, action: 'google_calendar.disconnect', entityType: 'google_connection', entityId: c.workspace.id })
  refresh(ws)
  return { ok: true }
}
