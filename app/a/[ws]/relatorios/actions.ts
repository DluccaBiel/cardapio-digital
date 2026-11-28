'use server'

import { z } from 'zod'
import { audit } from '../../../../lib/audit'
import { getWorkspaceBySlug } from '../../../../lib/db/workspaces'
import { MetaError } from '../../../../lib/meta/graph'
import { nextRunAt, PERIOD_KEYS, type ReportPayload, type ReportSource } from '../../../../lib/reports/format'
import { buildSource, loadAccounts, pool, queueReports, tokenResolver, type QueueItem } from '../../../../lib/reports/generate'
import { payloadSchema } from '../../../../lib/reports/payload-schema'
import type { GroupView, HistoryRow, ScheduleView, TargetView } from '../../../../lib/reports/views'
import { createServerClient } from '../../../../lib/supabaseServer'

type Fail = { ok: false; error: string }
const WRITERS = ['owner', 'coordenador', 'editor']
const uuid = z.string().uuid()
const jid = z.string().regex(/^[0-9-]+@g\.us$/)

async function ctx(ws: string, write = false) {
  const workspace = await getWorkspaceBySlug(ws)
  if (!workspace) return { error: 'Workspace não encontrado.' } as const
  if (write && !WRITERS.includes(workspace.role)) return { error: 'Seu papel só permite visualizar os relatórios.' } as const
  const db = createServerClient()
  const { data: u } = await db.auth.getUser()
  if (!u.user) return { error: 'Sessão expirada. Entre de novo.' } as const
  return { workspace, db, userId: u.user.id } as const
}
const fail = (error: string): Fail => ({ ok: false, error })

// ---------------------------------------------------------------------------
// Prévias: dados reais da Meta por conta (o navegador pede de poucas em poucas)
// ---------------------------------------------------------------------------
const previewSchema = z.object({ accountIds: z.array(uuid).min(1).max(6), period: z.enum(PERIOD_KEYS), compare: z.boolean() })
export type PreviewItem = { adAccountId: string; source: ReportSource | null; error: string | null }

export async function previewAction(ws: string, input: unknown): Promise<{ ok: true; items: PreviewItem[] } | Fail> {
  const c = await ctx(ws)
  if ('error' in c) return fail(c.error!)
  const p = previewSchema.safeParse(input)
  if (!p.success) return fail('Pedido inválido.')
  const accounts = await loadAccounts(c.db, c.workspace.id, p.data.accountIds).catch(() => null)
  if (!accounts) return fail('Não consegui ler as contas de anúncio.')
  const tokenFor = await tokenResolver(c.db, c.workspace.id)
  const items = await pool(p.data.accountIds, 4, async (id): Promise<PreviewItem> => {
    const account = accounts.find((a) => a.id === id)
    if (!account) return { adAccountId: id, source: null, error: 'Conta não encontrada.' }
    try {
      const source = await buildSource({ account, workspaceName: c.workspace.name, period: p.data.period, compare: p.data.compare, tokenFor })
      return { adAccountId: id, source, error: null }
    } catch (e) {
      return { adAccountId: id, source: null, error: e instanceof MetaError ? e.message : 'Falha ao consultar a Meta.' }
    }
  })
  return { ok: true, items }
}

// ---------------------------------------------------------------------------
// Configuração por conta: grupo do cliente + juntar/separar campanhas
// ---------------------------------------------------------------------------
const targetSchema = z.object({
  adAccountId: uuid,
  groupJid: jid.nullable(),
  groupName: z.string().max(200).nullable(),
  campaignMode: z.enum(['merged', 'separate']),
  campaignIds: z.array(z.string().regex(/^\d{1,30}$/)).max(200),
})

export async function saveTargetAction(ws: string, input: unknown): Promise<{ ok: true; target: TargetView } | Fail> {
  const c = await ctx(ws, true)
  if ('error' in c) return fail(c.error!)
  const p = targetSchema.safeParse(input)
  if (!p.success) return fail('Dados inválidos.')

  if (p.data.groupJid) {
    // O grupo precisa existir na lista sincronizada (evita vincular a um grupo que o robô nem enxerga).
    const { data: g } = await c.db.from('whatsapp_groups').select('jid, name').eq('workspace_id', c.workspace.id).eq('jid', p.data.groupJid).maybeSingle()
    if (!g) return fail('Esse grupo não está na lista sincronizada. Clique em "Sincronizar grupos" e tente de novo.')
    p.data.groupName = g.name ?? p.data.groupName

    // Um grupo = um cliente. Contas do MESMO cliente podem compartilhar o grupo; de clientes diferentes, não.
    const { data: mine } = await c.db.from('ad_accounts').select('id, client_id').eq('workspace_id', c.workspace.id).eq('id', p.data.adAccountId).maybeSingle()
    if (!mine) return fail('Conta de anúncio não encontrada.')
    const { data: others } = await c.db
      .from('report_targets')
      .select('ad_account_id')
      .eq('workspace_id', c.workspace.id)
      .eq('group_jid', p.data.groupJid)
      .neq('ad_account_id', p.data.adAccountId)
    if (others?.length) {
      const { data: accs } = await c.db
        .from('ad_accounts')
        .select('id, name, client_id, clients ( name )')
        .eq('workspace_id', c.workspace.id)
        .in('id', others.map((o) => o.ad_account_id as string))
      const clash = (accs ?? []).find((a) => !mine.client_id || a.client_id !== mine.client_id)
      if (clash) {
        const who = (Array.isArray(clash.clients) ? clash.clients[0]?.name : (clash.clients as { name?: string } | null)?.name) ?? clash.name
        return fail(`Esse grupo já está vinculado a "${who}". Desfaça aquele vínculo antes, para não mandar o relatório de um cliente no grupo de outro.`)
      }
    }
  }

  const { data, error } = await c.db
    .from('report_targets')
    .upsert(
      {
        workspace_id: c.workspace.id,
        ad_account_id: p.data.adAccountId,
        group_jid: p.data.groupJid,
        group_name: p.data.groupJid ? p.data.groupName : null,
        campaign_mode: p.data.campaignMode,
        campaign_ids: p.data.campaignIds,
      },
      { onConflict: 'workspace_id,ad_account_id' },
    )
    .select('id, ad_account_id, group_jid, group_name, campaign_mode, campaign_ids')
    .single()
  if (error || !data) return fail('Não consegui salvar a configuração da conta.')
  return { ok: true, target: data as TargetView }
}

// ---------------------------------------------------------------------------
// Grupos do WhatsApp (o robô lista; o painel pede atualização)
// ---------------------------------------------------------------------------
export async function groupsAction(ws: string): Promise<{ ok: true; groups: GroupView[]; syncedAt: string | null; requestedAt: string | null } | Fail> {
  const c = await ctx(ws)
  if ('error' in c) return fail(c.error!)
  const [{ data: groups }, { data: s }] = await Promise.all([
    c.db.from('whatsapp_groups').select('jid, name, participants').eq('workspace_id', c.workspace.id).order('name').limit(1000),
    c.db.from('whatsapp_sessions').select('groups_synced_at, groups_sync_requested_at').eq('workspace_id', c.workspace.id).maybeSingle(),
  ])
  return { ok: true, groups: (groups ?? []) as GroupView[], syncedAt: s?.groups_synced_at ?? null, requestedAt: s?.groups_sync_requested_at ?? null }
}

export async function requestGroupsSyncAction(ws: string): Promise<{ ok: true } | Fail> {
  const c = await ctx(ws, true)
  if ('error' in c) return fail(c.error!)
  const { data, error } = await c.db.from('whatsapp_sessions').update({ groups_sync_requested_at: new Date().toISOString() }).eq('workspace_id', c.workspace.id).select('workspace_id')
  if (error) return fail('Sem permissão para pedir a lista de grupos.')
  if (!data?.length) return fail('Conecte o WhatsApp primeiro.')
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Relatórios: salvar, marcar como enviado, enfileirar no grupo, cancelar, reenviar
// ---------------------------------------------------------------------------
const reportInput = z.object({ payload: payloadSchema, message: z.string().trim().min(1).max(4000) })

function reportRow(workspaceId: string, userId: string, payload: ReportPayload, message: string) {
  return {
    workspace_id: workspaceId,
    ad_account_id: payload.adAccountId,
    client_id: payload.clientId,
    title: payload.title.slice(0, 200),
    period_key: payload.periodKey,
    period_since: payload.period.since,
    period_until: payload.period.until,
    payload,
    message,
    created_by: userId,
  }
}
const HISTORY_FIELDS = 'id, title, period_since, period_until, status, group_name, scheduled_at, sent_at, error, created_at, message, schedule_id'

export async function saveReportAction(ws: string, input: unknown): Promise<{ ok: true; report: HistoryRow } | Fail> {
  const c = await ctx(ws, true)
  if ('error' in c) return fail(c.error!)
  const p = reportInput.extend({ sent: z.boolean().default(false) }).safeParse(input)
  if (!p.success) return fail('Relatório inválido — gere a prévia de novo.')
  const payload = p.data.payload as unknown as ReportPayload
  const { data: target } = await c.db.from('report_targets').select('group_jid, group_name').eq('workspace_id', c.workspace.id).eq('ad_account_id', payload.adAccountId).maybeSingle()
  const { data, error } = await c.db
    .from('reports')
    .insert({
      ...reportRow(c.workspace.id, c.userId, payload, p.data.message),
      status: p.data.sent ? 'enviado' : 'rascunho',
      sent_at: p.data.sent ? new Date().toISOString() : null,
      group_jid: target?.group_jid ?? null,
      group_name: target?.group_name ?? null,
    })
    .select(HISTORY_FIELDS)
    .single()
  if (error || !data) return fail('Não consegui salvar o relatório.')
  await audit({ workspaceId: c.workspace.id, actorType: 'user', actorId: c.userId, action: p.data.sent ? 'reports.marked_sent' : 'reports.saved', entityType: 'report', entityId: data.id })
  return { ok: true, report: data as HistoryRow }
}

export async function markSentAction(ws: string, id: string): Promise<{ ok: true } | Fail> {
  const c = await ctx(ws, true)
  if ('error' in c) return fail(c.error!)
  if (!uuid.safeParse(id).success) return fail('Relatório inválido.')
  const { data, error } = await c.db
    .from('reports')
    .update({ status: 'enviado', sent_at: new Date().toISOString(), error: null })
    .eq('workspace_id', c.workspace.id)
    .eq('id', id)
    .in('status', ['rascunho', 'falhou', 'cancelado'])
    .select('id')
  if (error || !data?.length) return fail('Não deu para marcar (o relatório pode estar na fila do robô).')
  await audit({ workspaceId: c.workspace.id, actorType: 'user', actorId: c.userId, action: 'reports.marked_sent', entityType: 'report', entityId: id })
  return { ok: true }
}

const queueSchema = z.object({
  items: z.array(reportInput).min(1).max(200),
  intervalMin: z.number().int().min(20).max(3600),
  intervalMax: z.number().int().min(20).max(3600),
})

/** Coloca relatórios na fila do robô: vão para o grupo de cada cliente, um por vez, com intervalo aleatório. */
export async function queueSendAction(ws: string, input: unknown): Promise<{ ok: true; queued: number; firstAt: string; lastAt: string; skipped: string[] } | Fail> {
  const c = await ctx(ws, true)
  if ('error' in c) return fail(c.error!)
  const p = queueSchema.safeParse(input)
  if (!p.success) return fail('Relatórios inválidos — gere as prévias de novo.')
  if (p.data.intervalMax < p.data.intervalMin) return fail('O intervalo máximo precisa ser maior que o mínimo.')
  const ids = p.data.items.map((i) => (i.payload as unknown as ReportPayload).adAccountId)
  const { data: targets } = await c.db.from('report_targets').select('ad_account_id, group_jid, group_name').eq('workspace_id', c.workspace.id).in('ad_account_id', ids)
  const byAccount = new Map((targets ?? []).map((t) => [t.ad_account_id as string, t]))
  const skipped: string[] = []
  const items: QueueItem[] = []
  for (const it of p.data.items) {
    const payload = it.payload as unknown as ReportPayload
    const t = byAccount.get(payload.adAccountId)
    if (!t?.group_jid) skipped.push(payload.title)
    else items.push({ payload, message: it.message, groupJid: t.group_jid, groupName: t.group_name })
  }
  if (!items.length) return fail('Nenhum dos relatórios tem grupo do WhatsApp vinculado.')
  try {
    const { times } = await queueReports(c.db, c.workspace.id, items, { intervalMin: p.data.intervalMin, intervalMax: p.data.intervalMax, userId: c.userId })
    await audit({ workspaceId: c.workspace.id, actorType: 'user', actorId: c.userId, action: 'reports.queued', entityType: 'workspace', entityId: c.workspace.id, metadata: { count: items.length } })
    return { ok: true, queued: items.length, firstAt: times[0]!, lastAt: times[times.length - 1]!, skipped }
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Falha ao enfileirar.')
  }
}

export async function setReportStatusAction(ws: string, id: string, action: 'cancel' | 'retry'): Promise<{ ok: true } | Fail> {
  const c = await ctx(ws, true)
  if ('error' in c) return fail(c.error!)
  if (!uuid.safeParse(id).success) return fail('Relatório inválido.')
  const q =
    action === 'cancel'
      ? c.db.from('reports').update({ status: 'cancelado' }).eq('workspace_id', c.workspace.id).eq('id', id).eq('status', 'agendado')
      : c.db.from('reports').update({ status: 'agendado', scheduled_at: new Date().toISOString(), error: null }).eq('workspace_id', c.workspace.id).eq('id', id).in('status', ['falhou', 'cancelado', 'rascunho']).not('group_jid', 'is', null)
  const { data, error } = await q.select('id')
  if (error || !data?.length) return fail(action === 'cancel' ? 'Esse relatório já saiu da fila.' : 'Só dá para reenviar relatório com grupo vinculado que não esteja na fila.')
  return { ok: true }
}

export async function historyAction(ws: string): Promise<{ ok: true; rows: HistoryRow[] } | Fail> {
  const c = await ctx(ws)
  if ('error' in c) return fail(c.error!)
  const { data, error } = await c.db.from('reports').select(HISTORY_FIELDS).eq('workspace_id', c.workspace.id).order('created_at', { ascending: false }).limit(100)
  if (error) return fail('Não consegui ler o histórico.')
  return { ok: true, rows: (data ?? []) as HistoryRow[] }
}

// ---------------------------------------------------------------------------
// Agendamentos (disparo automático)
// ---------------------------------------------------------------------------
const scheduleSchema = z.object({
  id: uuid.optional(),
  name: z.string().trim().min(1).max(120),
  active: z.boolean(),
  days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  period: z.enum(PERIOD_KEYS),
  compare: z.boolean(),
  accountIds: z.array(uuid).min(1).max(500),
  intervalMin: z.number().int().min(20).max(3600),
  intervalMax: z.number().int().min(20).max(3600),
})
const SCHEDULE_FIELDS = 'id, name, active, days_of_week, send_time, period_key, compare, target_ids, interval_min_seconds, interval_max_seconds, next_run_at, last_run_at, last_error'

export async function saveScheduleAction(ws: string, input: unknown): Promise<{ ok: true; schedule: ScheduleView; targets: TargetView[] } | Fail> {
  const c = await ctx(ws, true)
  if ('error' in c) return fail(c.error!)
  const p = scheduleSchema.safeParse(input)
  if (!p.success) return fail('Confira nome, dias, horário e contas do agendamento.')
  const s = p.data
  if (s.intervalMax < s.intervalMin) return fail('O intervalo máximo precisa ser maior que o mínimo.')

  // Garante a configuração (report_targets) de cada conta escolhida.
  await c.db
    .from('report_targets')
    .upsert(
      s.accountIds.map((id) => ({ workspace_id: c.workspace.id, ad_account_id: id })),
      { onConflict: 'workspace_id,ad_account_id', ignoreDuplicates: true },
    )
  const { data: targets, error: tErr } = await c.db
    .from('report_targets')
    .select('id, ad_account_id, group_jid, group_name, campaign_mode, campaign_ids')
    .eq('workspace_id', c.workspace.id)
    .in('ad_account_id', s.accountIds)
  if (tErr || !targets?.length) return fail('Não consegui preparar as contas do agendamento.')

  const days = Array.from(new Set(s.days)).sort()
  const row = {
    workspace_id: c.workspace.id,
    name: s.name,
    active: s.active,
    days_of_week: days,
    send_time: s.time,
    period_key: s.period,
    compare: s.compare,
    target_ids: targets.map((t) => t.id as string),
    interval_min_seconds: s.intervalMin,
    interval_max_seconds: s.intervalMax,
    next_run_at: s.active ? nextRunAt(days, s.time) : null,
  }
  const q = s.id ? c.db.from('report_schedules').update(row).eq('workspace_id', c.workspace.id).eq('id', s.id) : c.db.from('report_schedules').insert({ ...row, created_by: c.userId })
  const { data, error } = await q.select(SCHEDULE_FIELDS).single()
  if (error || !data) return fail('Não consegui salvar o agendamento.')
  await audit({ workspaceId: c.workspace.id, actorType: 'user', actorId: c.userId, action: s.id ? 'reports.schedule_updated' : 'reports.schedule_created', entityType: 'report_schedule', entityId: data.id })
  return { ok: true, schedule: data as ScheduleView, targets: targets as TargetView[] }
}

export async function toggleScheduleAction(ws: string, id: string, active: boolean): Promise<{ ok: true; schedule: ScheduleView } | Fail> {
  const c = await ctx(ws, true)
  if ('error' in c) return fail(c.error!)
  if (!uuid.safeParse(id).success) return fail('Agendamento inválido.')
  const { data: cur } = await c.db.from('report_schedules').select('days_of_week, send_time').eq('workspace_id', c.workspace.id).eq('id', id).maybeSingle()
  if (!cur) return fail('Agendamento não encontrado.')
  const { data, error } = await c.db
    .from('report_schedules')
    .update({ active, next_run_at: active ? nextRunAt(cur.days_of_week as number[], cur.send_time as string) : null })
    .eq('workspace_id', c.workspace.id)
    .eq('id', id)
    .select(SCHEDULE_FIELDS)
    .single()
  if (error || !data) return fail('Não consegui alterar o agendamento.')
  return { ok: true, schedule: data as ScheduleView }
}

export async function deleteScheduleAction(ws: string, id: string): Promise<{ ok: true } | Fail> {
  const c = await ctx(ws, true)
  if ('error' in c) return fail(c.error!)
  if (!uuid.safeParse(id).success) return fail('Agendamento inválido.')
  const { data, error } = await c.db.from('report_schedules').delete().eq('workspace_id', c.workspace.id).eq('id', id).select('id')
  if (error || !data?.length) return fail('Só dono ou coordenador apagam agendamentos.')
  await audit({ workspaceId: c.workspace.id, actorType: 'user', actorId: c.userId, action: 'reports.schedule_deleted', entityType: 'report_schedule', entityId: id })
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Modelo do workspace (blocos, período, intervalo padrão)
// ---------------------------------------------------------------------------
const settingsSchema = z.object({
  show: z.object({ general: z.boolean(), byObjective: z.boolean(), topCreatives: z.boolean(), balance: z.boolean() }),
  period: z.enum(PERIOD_KEYS),
  compare: z.boolean(),
  intervalMin: z.number().int().min(20).max(3600),
  intervalMax: z.number().int().min(20).max(3600),
})

export async function saveSettingsAction(ws: string, input: unknown): Promise<{ ok: true } | Fail> {
  const c = await ctx(ws, true)
  if ('error' in c) return fail(c.error!)
  const p = settingsSchema.safeParse(input)
  if (!p.success) return fail('Modelo inválido.')
  if (p.data.intervalMax < p.data.intervalMin) return fail('O intervalo máximo precisa ser maior que o mínimo.')
  const { error } = await c.db.from('report_settings').upsert(
    {
      workspace_id: c.workspace.id,
      blocks: p.data.show,
      period_key: p.data.period,
      compare: p.data.compare,
      interval_min_seconds: p.data.intervalMin,
      interval_max_seconds: p.data.intervalMax,
    },
    { onConflict: 'workspace_id' },
  )
  if (error) return fail('Não consegui salvar o modelo.')
  return { ok: true }
}
