'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { audit } from '../../../../lib/audit'
import { parseManualContacts } from '../../../../lib/phone'
import { ensureWorkerRunning, launchMessage, WORKER_TTL_MS as _TTL } from '../../../../lib/worker-launcher'
import { SESSION_FIELDS, type ProspectLead, type WhatsappSession } from '../../../../lib/db/disparos'
import { getWorkspaceBySlug } from '../../../../lib/db/workspaces'
import { createServerClient } from '../../../../lib/supabaseServer'

type Fail = { ok: false; error: string }
const MANAGERS = ['owner', 'coordenador']
/** Robô considerado online se bateu ponto nos últimos 30 s. */
const WORKER_TTL_MS = _TTL

async function ctx(ws: string) {
  const workspace = await getWorkspaceBySlug(ws)
  if (!workspace) return { error: 'Workspace não encontrado.' } as const
  if (!MANAGERS.includes(workspace.role)) return { error: 'Somente dono ou coordenador gerenciam os disparos.' } as const
  const db = createServerClient()
  const { data: u } = await db.auth.getUser()
  if (!u.user) return { error: 'Sessão expirada. Entre de novo.' } as const
  return { workspace, db, userId: u.user.id } as const
}

// ---------------------------------------------------------------------------
// Conexão WhatsApp
// ---------------------------------------------------------------------------

export type WhatsappStatusView = { session: WhatsappSession | null; workerOnline: boolean }

export async function whatsappStatusAction(ws: string): Promise<({ ok: true } & WhatsappStatusView) | Fail> {
  const c = await ctx(ws)
  if ('error' in c) return { ok: false, error: c.error! }
  const { data, error } = await c.db.from('whatsapp_sessions').select(SESSION_FIELDS).eq('workspace_id', c.workspace.id).maybeSingle()
  if (error) return { ok: false, error: 'Tabelas de disparo ausentes — aplique a migration 20261118120000_whatsapp_disparos.sql.' }
  const session = (data as WhatsappSession | null) ?? null
  const seen = session?.worker_seen_at ? Date.parse(session.worker_seen_at) : 0
  return { ok: true, session, workerOnline: Date.now() - seen < WORKER_TTL_MS }
}

export async function whatsappConnectAction(ws: string, connect: boolean): Promise<{ ok: true } | Fail> {
  const c = await ctx(ws)
  if ('error' in c) return { ok: false, error: c.error! }
  const desired = connect ? 'connected' : 'disconnected'
  await c.db.from('whatsapp_sessions').upsert({ workspace_id: c.workspace.id, desired_state: desired }, { onConflict: 'workspace_id', ignoreDuplicates: true })
  const { error } = await c.db.from('whatsapp_sessions').update({ desired_state: desired }).eq('workspace_id', c.workspace.id)
  if (error) return { ok: false, error: 'Não consegui salvar o pedido de conexão.' }
  await audit({ workspaceId: c.workspace.id, actorType: 'user', actorId: c.userId, action: connect ? 'whatsapp.connect_requested' : 'whatsapp.disconnect_requested', entityType: 'whatsapp_session', entityId: c.workspace.id })
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Público: números colados à mão (sem IA, sem busca externa)
// ---------------------------------------------------------------------------

export async function addManualLeadsAction(ws: string, text: string): Promise<{ ok: true; leads: ProspectLead[]; added: number; ignored: number } | Fail> {
  const c = await ctx(ws)
  if ('error' in c) return { ok: false, error: c.error! }
  if (typeof text !== 'string' || text.length > 60_000) return { ok: false, error: 'Texto inválido.' }
  const contacts = parseManualContacts(text)
  if (contacts.length === 0) return { ok: false, error: 'Não encontrei telefones. Use um contato por linha, ex.: Pizzaria do Zé; (11) 99999-8888.' }

  const phones = contacts.map((x) => x.phone)
  const { data: existing } = await c.db.from('prospect_leads').select('phone').eq('workspace_id', c.workspace.id).in('phone', phones)
  const known = new Set((existing ?? []).map((r: { phone: string }) => r.phone))
  const fresh = contacts.filter((x) => !known.has(x.phone))
  if (fresh.length) {
    const { error } = await c.db.from('prospect_leads').insert(fresh.map((x) => ({ workspace_id: c.workspace.id, source: 'manual', name: x.name, phone: x.phone, niche: 'food', status: 'novo' })))
    if (error) return { ok: false, error: 'Não consegui salvar os contatos (migration aplicada?).' }
  }
  const { data: rows } = await c.db
    .from('prospect_leads')
    .select('id, name, phone, category, city, uf, address, website, status, found_at')
    .eq('workspace_id', c.workspace.id)
    .in('phone', phones)
  await audit({ workspaceId: c.workspace.id, actorType: 'user', actorId: c.userId, action: 'broadcast_audience.add_manual', entityType: 'prospect_lead', entityId: null, metadata: { added: fresh.length } })
  return { ok: true, leads: (rows ?? []) as ProspectLead[], added: fresh.length, ignored: contacts.length - fresh.length }
}

// ---------------------------------------------------------------------------
// Campanhas
// ---------------------------------------------------------------------------

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
const campaignSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    message: z.string().trim().min(1).max(2000),
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    days_of_week: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    window_start: hhmm,
    window_end: hhmm,
    interval_min_seconds: z.number().int().min(20).max(3600),
    interval_max_seconds: z.number().int().min(20).max(3600),
    daily_limit: z.number().int().min(1).max(300),
    lead_ids: z.array(z.string().uuid()).min(1).max(2000),
  })
  .refine((v) => v.interval_max_seconds >= v.interval_min_seconds, { message: 'Intervalo máximo menor que o mínimo.' })
  .refine((v) => v.window_end > v.window_start, { message: 'O horário final precisa ser depois do inicial.' })

export async function createCampaignAction(ws: string, input: unknown): Promise<{ ok: true; id: string; total: number } | Fail> {
  const c = await ctx(ws)
  if ('error' in c) return { ok: false, error: c.error! }
  const parsed = campaignSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados do disparo inválidos.' }
  const v = parsed.data

  const { data: leads, error: leadErr } = await c.db
    .from('prospect_leads')
    .select('id, name, phone, status')
    .eq('workspace_id', c.workspace.id)
    .in('id', v.lead_ids)
    .not('status', 'in', '(opt_out,invalido)')
  if (leadErr) return { ok: false, error: 'Não consegui ler o público.' }
  if (!leads || leads.length === 0) return { ok: false, error: 'Nenhum contato válido no público (opt-out e inválidos ficam de fora).' }

  const { data: camp, error } = await c.db
    .from('broadcast_campaigns')
    .insert({
      workspace_id: c.workspace.id,
      name: v.name,
      message: v.message,
      status: 'agendada',
      start_date: v.start_date,
      days_of_week: Array.from(new Set(v.days_of_week)).sort(),
      window_start: v.window_start,
      window_end: v.window_end,
      interval_min_seconds: v.interval_min_seconds,
      interval_max_seconds: v.interval_max_seconds,
      daily_limit: v.daily_limit,
      total: leads.length,
      created_by: c.userId,
    })
    .select('id')
    .single()
  if (error || !camp) return { ok: false, error: 'Não consegui criar o disparo.' }

  const { error: recErr } = await c.db.from('broadcast_recipients').insert(
    leads.map((l) => ({ workspace_id: c.workspace.id, campaign_id: camp.id, lead_id: l.id, name: l.name, phone: l.phone })),
  )
  if (recErr) {
    await c.db.from('broadcast_campaigns').delete().eq('workspace_id', c.workspace.id).eq('id', camp.id)
    return { ok: false, error: 'Não consegui montar a fila do disparo.' }
  }
  await c.db.from('prospect_leads').update({ status: 'na_fila' }).eq('workspace_id', c.workspace.id).in('id', leads.map((l) => l.id)).eq('status', 'novo')

  await audit({
    workspaceId: c.workspace.id,
    actorType: 'user',
    actorId: c.userId,
    action: 'broadcast_campaign.create',
    entityType: 'broadcast_campaign',
    entityId: camp.id,
    metadata: { total: leads.length, interval: [v.interval_min_seconds, v.interval_max_seconds], daily_limit: v.daily_limit },
  })
  revalidatePath(`/a/${ws}/disparos`)
  return { ok: true, id: camp.id, total: leads.length }
}

const NEXT_STATUS = z.enum(['pausada', 'agendada', 'cancelada'])

export async function setCampaignStatusAction(ws: string, id: string, status: string): Promise<{ ok: true } | Fail> {
  const c = await ctx(ws)
  if ('error' in c) return { ok: false, error: c.error! }
  const s = NEXT_STATUS.safeParse(status)
  if (!z.string().uuid().safeParse(id).success || !s.success) return { ok: false, error: 'Pedido inválido.' }
  const { error } = await c.db
    .from('broadcast_campaigns')
    .update({ status: s.data, ...(s.data === 'agendada' ? { last_error: null } : {}) })
    .eq('workspace_id', c.workspace.id)
    .eq('id', id)
    .in('status', s.data === 'agendada' ? ['pausada'] : ['agendada', 'enviando', 'pausada'])
  if (error) return { ok: false, error: 'Não consegui atualizar o disparo.' }
  if (s.data === 'cancelada') {
    await c.db.from('broadcast_recipients').update({ status: 'ignorado', error: 'disparo cancelado' }).eq('workspace_id', c.workspace.id).eq('campaign_id', id).eq('status', 'pendente')
  }
  await audit({ workspaceId: c.workspace.id, actorType: 'user', actorId: c.userId, action: `broadcast_campaign.${s.data}`, entityType: 'broadcast_campaign', entityId: id })
  revalidatePath(`/a/${ws}/disparos`)
  return { ok: true }
}

function todaySP(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}
function dowSP(): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short' }).format(new Date())
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return map[parts] ?? 0
}

/** Inicia ou despausa imediatamente um disparo específico. */
export async function triggerCampaignNowAction(ws: string, id: string): Promise<{ ok: true } | Fail> {
  const c = await ctx(ws)
  if ('error' in c) return { ok: false, error: c.error! }
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: 'Disparo inválido.' }

  const { data: camp, error: fetchErr } = await c.db
    .from('broadcast_campaigns')
    .select('id, days_of_week')
    .eq('workspace_id', c.workspace.id)
    .eq('id', id)
    .single()
  if (fetchErr || !camp) return { ok: false, error: 'Disparo não encontrado.' }

  const today = todaySP()
  const dow = dowSP()
  const currentDays = (camp.days_of_week as number[]) ?? []
  const days = Array.from(new Set([...currentDays, dow])).sort()

  const { error } = await c.db
    .from('broadcast_campaigns')
    .update({
      status: 'enviando',
      start_date: today,
      days_of_week: days,
      next_send_at: null,
      last_error: null,
    })
    .eq('workspace_id', c.workspace.id)
    .eq('id', id)
  if (error) return { ok: false, error: 'Não consegui iniciar o disparo.' }

  await c.db.from('whatsapp_sessions').upsert({ workspace_id: c.workspace.id, desired_state: 'connected' }, { onConflict: 'workspace_id', ignoreDuplicates: true })
  await ensureWorkerRunning(c.db, c.workspace.id, 3_000).catch(() => undefined)
  await audit({ workspaceId: c.workspace.id, actorType: 'user', actorId: c.userId, action: 'broadcast_campaign.start_now', entityType: 'broadcast_campaign', entityId: id })
  revalidatePath(`/a/${ws}/disparos`)
  return { ok: true }
}

/** Inicia os disparos da primeira campanha agendada ou pausada encontrada. */
export async function triggerDisparosAction(ws: string): Promise<{ ok: true; message: string } | Fail> {
  const c = await ctx(ws)
  if ('error' in c) return { ok: false, error: c.error! }

  // Garante que o WhatsApp está com pedido de conexão
  await c.db
    .from('whatsapp_sessions')
    .upsert({ workspace_id: c.workspace.id, desired_state: 'connected' }, { onConflict: 'workspace_id' })
  await c.db
    .from('whatsapp_sessions')
    .update({ desired_state: 'connected' })
    .eq('workspace_id', c.workspace.id)

  const { data: campaigns } = await c.db
    .from('broadcast_campaigns')
    .select('id, name, status, days_of_week')
    .eq('workspace_id', c.workspace.id)
    .in('status', ['agendada', 'pausada', 'enviando'])
    .order('created_at', { ascending: true })

  if (!campaigns || campaigns.length === 0) {
    return { ok: false, error: 'Nenhum disparo agendado. Monte o público e agende a mensagem abaixo para disparar.' }
  }

  // Liga o robô sozinho se estiver desligado (servidor 24 h ou processo local).
  const launch = await ensureWorkerRunning(c.db, c.workspace.id)

  const active = campaigns.find((x) => x.status === 'enviando')
  if (active) {
    return { ok: true, message: `O robô já está disparando a campanha "${active.name}". ${launch.state === 'online' ? '' : launchMessage(launch)}`.trim() }
  }

  const target = campaigns[0]
  const today = todaySP()
  const dow = dowSP()
  const currentDays = (target.days_of_week as number[]) ?? []
  const days = Array.from(new Set([...currentDays, dow])).sort()

  const { error } = await c.db
    .from('broadcast_campaigns')
    .update({
      status: 'enviando',
      start_date: today,
      days_of_week: days,
      next_send_at: null,
      last_error: null,
    })
    .eq('workspace_id', c.workspace.id)
    .eq('id', target.id)

  if (error) return { ok: false, error: 'Não consegui ativar os envios.' }

  await audit({ workspaceId: c.workspace.id, actorType: 'user', actorId: c.userId, action: 'broadcast_campaign.start_now', entityType: 'broadcast_campaign', entityId: target.id })
  revalidatePath(`/a/${ws}/disparos`)
  return { ok: true, message: `Disparos iniciados para "${target.name}"! ${launchMessage(launch)}`.trim() }
}

/** Tenta iniciar o robô localmente no computador do usuário ou registra o pedido na nuvem. */
export async function startLocalWorkerAction(ws: string): Promise<{ ok: true; isVercel?: boolean; message: string } | Fail> {
  const c = await ctx(ws)
  if ('error' in c) return { ok: false, error: c.error! }

  // Garante o pedido de conexão no banco
  await c.db
    .from('whatsapp_sessions')
    .upsert({ workspace_id: c.workspace.id, desired_state: 'connected' }, { onConflict: 'workspace_id' })
  await c.db
    .from('whatsapp_sessions')
    .update({ desired_state: 'connected' })
    .eq('workspace_id', c.workspace.id)

  const r = await ensureWorkerRunning(c.db, c.workspace.id)
  return { ok: true, isVercel: r.state === 'manual', message: launchMessage(r) }
}
