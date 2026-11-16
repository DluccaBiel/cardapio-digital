'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { audit } from '../../../lib/audit'
import { getWorkspaceBySlug } from '../../../lib/db/workspaces'
import { fetchBusinesses } from '../../../lib/meta/api'
import { MetaError } from '../../../lib/meta/graph'
import { syncWorkspaceMeta, workspaceTokens, type SyncSummary } from '../../../lib/meta/sync'
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
