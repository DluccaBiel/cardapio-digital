'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { audit } from '../../../lib/audit'
import { getWorkspaceBySlug } from '../../../lib/db/workspaces'
import { fetchBusinesses } from '../../../lib/meta/api'
import { MetaError } from '../../../lib/meta/graph'
import { fetchAccountTotals } from '../../../lib/meta/insights'
import { isDay } from '../../../lib/overview-range'
import { refreshWatchedMeta, syncWorkspaceMeta, workspaceTokens, type SyncSummary } from '../../../lib/meta/sync'
import { createAdminClient } from '../../../lib/supabaseAdmin'
import { createServerClient } from '../../../lib/supabaseServer'

type Fail = { ok: false; error: string }
const MANAGERS = ['owner', 'coordenador']

async function managerCtx(ws: string) {
  const workspace = await getWorkspaceBySlug(ws)
  if (!workspace) return { error: 'Workspace não encontrado.' } as const
  if (!MANAGERS.includes(workspace.role)) return { error: 'Somente dono ou coordenador gerenciam a integração com a Meta.' } as const
  const db = createServerClient()
  const { data: u } = await db.auth.getUser()
  if (!u.user) return { error: 'Sessão expirada. Entre de novo.' } as const
  return { workspace, db, userId: u.user.id } as const
}

function refresh(ws: string) {
  for (const p of ['visao-geral', 'contas', 'relatorios', 'configuracoes']) revalidatePath(`/a/${ws}/${p}`)
}

/** Botão "Sincronizar" (topo): todas as contas de todos os portfólios conectados. */
export async function syncMetaAction(ws: string): Promise<({ ok: true } & SyncSummary) | Fail> {
  const c = await managerCtx(ws)
  if ('error' in c) return { ok: false, error: c.error! }
  try {
    const summary = await syncWorkspaceMeta(c.db, c.workspace.id)
    await audit({
      workspaceId: c.workspace.id,
      actorType: 'user',
      actorId: c.userId,
      action: 'ad_accounts.sync_meta',
      entityType: 'workspace',
      entityId: c.workspace.id,
      metadata: { total: summary.total, created: summary.created, linked: summary.linked, businesses: summary.businesses, errors: summary.errors.length },
    })
    refresh(ws)
    return { ok: true, ...summary }
  } catch (e) {
    return { ok: false, error: e instanceof MetaError ? e.message : 'Falha ao sincronizar com a Meta.' }
  }
}

/** Atualização automática (a cada 5 min na Visão geral): só as contas acompanhadas. */
export async function refreshWatchedAction(ws: string): Promise<{ ok: true; refreshed: number; errors: string[]; synced_at: string } | Fail> {
  const c = await managerCtx(ws)
  if ('error' in c) return { ok: false, error: c.error! }
  try {
    const r = await refreshWatchedMeta(c.db, c.workspace.id)
    revalidatePath(`/a/${ws}/visao-geral`)
    return { ok: true, ...r }
  } catch (e) {
    return { ok: false, error: e instanceof MetaError ? e.message : 'Falha ao atualizar as contas acompanhadas.' }
  }
}

/** Atualiza a lista de portfólios de uma conexão (sem mudar quais estão ativos). */
export async function refreshBusinessesAction(ws: string, connectionId: string): Promise<{ ok: true; count: number } | Fail> {
  const c = await managerCtx(ws)
  if ('error' in c) return { ok: false, error: c.error! }
  if (!z.string().uuid().safeParse(connectionId).success) return { ok: false, error: 'Conexão inválida.' }
  const token = (await workspaceTokens(c.workspace.id)).get(connectionId)
  if (!token) return { ok: false, error: 'Conexão expirada — clique em "Conectar com o Facebook" de novo.' }
  try {
    const list = await fetchBusinesses(token)
    if (list.length > 0) {
      const { error } = await c.db.from('meta_businesses').upsert(
        list.map((b) => ({ workspace_id: c.workspace.id, connection_id: connectionId, business_id: b.id, name: b.name })),
        { onConflict: 'workspace_id,business_id', ignoreDuplicates: false },
      )
      if (error) return { ok: false, error: 'Não consegui salvar os portfólios.' }
    }
    refresh(ws)
    return { ok: true, count: list.length }
  } catch (e) {
    return { ok: false, error: e instanceof MetaError ? e.message : 'Falha ao listar portfólios.' }
  }
}

/** Conecta (ativa) ou desconecta um portfólio para a sincronização. */
export async function toggleBusinessAction(ws: string, businessRowId: string, enabled: boolean): Promise<{ ok: true } | Fail> {
  const c = await managerCtx(ws)
  if ('error' in c) return { ok: false, error: c.error! }
  if (!z.string().uuid().safeParse(businessRowId).success) return { ok: false, error: 'Portfólio inválido.' }
  const { error } = await c.db.from('meta_businesses').update({ enabled: Boolean(enabled) }).eq('workspace_id', c.workspace.id).eq('id', businessRowId)
  if (error) return { ok: false, error: 'Não consegui salvar.' }
  await audit({ workspaceId: c.workspace.id, actorType: 'user', actorId: c.userId, action: enabled ? 'meta_business.enable' : 'meta_business.disable', entityType: 'meta_business', entityId: businessRowId })
  refresh(ws)
  return { ok: true }
}

/** Remove a conexão do Facebook (token apagado; portfólios em cascata; contas ficam, sem vínculo). */
export async function disconnectMetaAction(ws: string, connectionId: string): Promise<{ ok: true } | Fail> {
  const c = await managerCtx(ws)
  if ('error' in c) return { ok: false, error: c.error! }
  if (!z.string().uuid().safeParse(connectionId).success) return { ok: false, error: 'Conexão inválida.' }
  const admin = createAdminClient()
  await admin.from('meta_connection_tokens').delete().eq('workspace_id', c.workspace.id).eq('connection_id', connectionId)
  const { error } = await c.db.from('meta_connections').delete().eq('workspace_id', c.workspace.id).eq('id', connectionId)
  if (error) return { ok: false, error: 'Não consegui remover a conexão.' }
  await audit({ workspaceId: c.workspace.id, actorType: 'user', actorId: c.userId, action: 'meta_connection.remove', entityType: 'meta_connection', entityId: connectionId })
  refresh(ws)
  return { ok: true }
}

export type RangeMetrics = Record<string, { spend: number; revenue: number; purchases: number }>

/**
 * Métricas de gasto / valor de conversão / compras de um período exato (Visão geral),
 * por cliente (id do cliente) ou por conta sem cliente (`conta:<id>`).
 */
export async function loadRangeMetricsAction(ws: string, since: string, until: string): Promise<{ ok: true; byId: RangeMetrics; errors: string[] } | Fail> {
  if (!isDay(since) || !isDay(until) || since > until) return { ok: false, error: 'Período inválido.' }
  const c = await managerCtx(ws)
  if ('error' in c) return { ok: false, error: c.error! }
  try {
    const [{ data: watched }, { data: businesses }] = await Promise.all([
      c.db.from('ad_accounts').select('id, client_id, name, external_account_id, meta_business_id').eq('workspace_id', c.workspace.id).eq('platform', 'meta').eq('is_watched', true),
      c.db.from('meta_businesses').select('id, connection_id').eq('workspace_id', c.workspace.id),
    ])
    const rows = watched ?? []
    const tokens = await workspaceTokens(c.workspace.id)
    const anyToken = tokens.values().next().value ?? null
    const connByBiz = new Map((businesses ?? []).map((b) => [b.id as string, b.connection_id as string]))
    const byId: RangeMetrics = {}
    const errors: string[] = []
    let next = 0
    await Promise.all(
      Array.from({ length: Math.min(8, rows.length) }, async () => {
        while (next < rows.length) {
          const row = rows[next++]!
          const token = (row.meta_business_id && tokens.get(connByBiz.get(row.meta_business_id as string) ?? '')) || anyToken
          const key = (row.client_id as string | null) ?? `conta:${row.id}`
          byId[key] ??= { spend: 0, revenue: 0, purchases: 0 }
          if (!token) {
            errors.push(`${row.name}: sem conexão ativa com o Facebook.`)
            continue
          }
          try {
            const t = await fetchAccountTotals(token, row.external_account_id as string, since, until)
            byId[key].spend += t.spend
            byId[key].revenue += t.revenue
            byId[key].purchases += t.purchases
          } catch (e) {
            errors.push(`${row.name}: ${e instanceof MetaError ? e.message : 'falha ao consultar a Meta'}`)
          }
        }
      }),
    )
    return { ok: true, byId, errors }
  } catch (e) {
    return { ok: false, error: e instanceof MetaError ? e.message : 'Falha ao consultar a Meta.' }
  }
}
