'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { audit } from '../../../../lib/audit'
import { getWorkspaceBySlug } from '../../../../lib/db/workspaces'
import { MetaError } from '../../../../lib/meta/graph'
import { syncWorkspaceMeta } from '../../../../lib/meta/sync'
import { createServerClient } from '../../../../lib/supabaseServer'

type Fail = { ok: false; error: string }
export type SyncResult = { ok: true; total: number; created: number; updated: number; linked: number; synced_at: string } | Fail

const MANAGERS = ['owner', 'coordenador']

async function managerCtx(ws: string) {
  const workspace = await getWorkspaceBySlug(ws)
  if (!workspace) return { error: 'Workspace não encontrado.' } as const
  if (!MANAGERS.includes(workspace.role)) return { error: 'Somente dono ou coordenador gerenciam contas de anúncio.' } as const
  const db = createServerClient()
  const { data: u } = await db.auth.getUser()
  if (!u.user) return { error: 'Sessão expirada. Entre de novo.' } as const
  return { workspace, db, userId: u.user.id } as const
}

/**
 * "Buscar contas" / Sincronizar: todos os portfólios conectados em Configurações →
 * Integrações (ou o modo legado por env). Ver lib/meta/sync.ts.
 */
export async function syncMetaAccountsAction(ws: string): Promise<SyncResult> {
  const c = await managerCtx(ws)
  if ('error' in c) return { ok: false, error: c.error! }
  try {
    const s = await syncWorkspaceMeta(c.db, c.workspace.id)
    await audit({
      workspaceId: c.workspace.id,
      actorType: 'user',
      actorId: c.userId,
      action: 'ad_accounts.sync_meta',
      entityType: 'workspace',
      entityId: c.workspace.id,
      metadata: { total: s.total, created: s.created, linked: s.linked, businesses: s.businesses, errors: s.errors.length }, // nunca o token
    })
    revalidatePath(`/a/${ws}/contas`)
    revalidatePath(`/a/${ws}/visao-geral`)
    if (s.total === 0 && s.errors.length > 0) return { ok: false, error: s.errors[0]! }
    return { ok: true, total: s.total, created: s.created, updated: s.updated, linked: s.linked, synced_at: s.synced_at }
  } catch (e) {
    return { ok: false, error: e instanceof MetaError ? e.message : 'Falha ao consultar a Meta.' }
  }
}

const idSchema = z.string().uuid()

export async function setWatchedAction(ws: string, accountId: string, watched: boolean): Promise<{ ok: true } | Fail> {
  const c = await managerCtx(ws)
  if ('error' in c) return { ok: false, error: c.error! }
  if (!idSchema.safeParse(accountId).success) return { ok: false, error: 'Conta inválida.' }
  const { error } = await c.db.from('ad_accounts').update({ is_watched: Boolean(watched) }).eq('workspace_id', c.workspace.id).eq('id', accountId)
  if (error) return { ok: false, error: 'Não consegui salvar o acompanhamento.' }
  return { ok: true }
}

/** Vincula (clientId) ou desvincula (null) a conta a um cliente do mesmo workspace (FK composta garante). */
export async function linkAccountAction(ws: string, accountId: string, clientId: string | null): Promise<{ ok: true } | Fail> {
  const c = await managerCtx(ws)
  if ('error' in c) return { ok: false, error: c.error! }
  if (!idSchema.safeParse(accountId).success || (clientId !== null && !idSchema.safeParse(clientId).success)) return { ok: false, error: 'Dados inválidos.' }
  const { error } = await c.db.from('ad_accounts').update({ client_id: clientId }).eq('workspace_id', c.workspace.id).eq('id', accountId)
  if (error) return { ok: false, error: 'Não consegui salvar o vínculo.' }
  await audit({ workspaceId: c.workspace.id, actorType: 'user', actorId: c.userId, action: clientId ? 'ad_account.link' : 'ad_account.unlink', entityType: 'ad_account', entityId: accountId, metadata: { client_id: clientId } })
  revalidatePath(`/a/${ws}/contas`)
  return { ok: true }
}

/** Cria o cliente com o nome informado (ex.: nome da BM do cliente) e já vincula a conta. */
export async function createClientAndLinkAction(ws: string, accountId: string, name: string): Promise<{ ok: true; client: { id: string; name: string } } | Fail> {
  const c = await managerCtx(ws)
  if ('error' in c) return { ok: false, error: c.error! }
  const parsed = z.string().trim().min(1).max(160).safeParse(name)
  if (!parsed.success || !idSchema.safeParse(accountId).success) return { ok: false, error: 'Informe o nome do cliente.' }
  const { data: client, error } = await c.db.from('clients').insert({ workspace_id: c.workspace.id, name: parsed.data }).select('id, name').single()
  if (error || !client) return { ok: false, error: 'Não consegui criar o cliente (permissão?).' }
  const linked = await linkAccountAction(ws, accountId, client.id)
  if (!linked.ok) return linked
  return { ok: true, client }
}
