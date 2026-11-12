'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { audit } from '../../../../lib/audit'
import { getWorkspaceBySlug } from '../../../../lib/db/workspaces'
import { fetchBusinessAdAccounts, MetaError, metaConfig } from '../../../../lib/meta/graph'
import { createServerClient } from '../../../../lib/supabaseServer'

type Fail = { ok: false; error: string }
export type SyncResult = { ok: true; total: number; created: number; updated: number; linked: number; synced_at: string } | Fail

const MANAGERS = ['owner', 'coordenador']
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()

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
 * "Buscar contas da BM" / Sincronizar: lê o portfólio na Meta (token só no servidor)
 * e faz upsert em ad_accounts (RLS: owner/coordenador). Não apaga contas que sumiram
 * da Meta — só deixam de ser atualizadas. Vincula automaticamente ao cliente do Undercut
 * cujo nome bate com o nome da BM dona (ou da conta), se a conta ainda não tem cliente.
 */
export async function syncMetaAccountsAction(ws: string): Promise<SyncResult> {
  const c = await managerCtx(ws)
  if ('error' in c) return { ok: false, error: c.error! }
  const cfg = metaConfig()
  if (!cfg) return { ok: false, error: 'Integração com a Meta não configurada no servidor: cadastre META_ACCESS_TOKEN e META_BUSINESS_ID na Vercel e refaça o deploy.' }

  let remote
  try {
    remote = await fetchBusinessAdAccounts(cfg)
  } catch (e) {
    return { ok: false, error: e instanceof MetaError ? e.message : 'Falha ao consultar a Meta.' }
  }

  const { workspace, db } = c
  const [{ data: existing, error: exErr }, { data: clients }] = await Promise.all([
    db.from('ad_accounts').select('id, external_account_id, client_id').eq('workspace_id', workspace.id).eq('platform', 'meta'),
    db.from('clients').select('id, name').eq('workspace_id', workspace.id).is('archived_at', null),
  ])
  if (exErr) return { ok: false, error: 'Não consegui ler as contas do Undercut (migration 0007 aplicada?).' }
  const byExt = new Map((existing ?? []).map((r) => [r.external_account_id as string, r]))
  const clientByName = new Map<string, string>()
  for (const cl of clients ?? []) if (!clientByName.has(norm(cl.name))) clientByName.set(norm(cl.name), cl.id)

  const now = new Date().toISOString()
  let created = 0
  let linked = 0
  const rows = remote.map((a) => {
    const prev = byExt.get(a.external_account_id)
    if (!prev) created += 1
    let client_id: string | null = prev?.client_id ?? null
    if (!client_id) {
      client_id = (a.owner_business_name && clientByName.get(norm(a.owner_business_name))) || clientByName.get(norm(a.name)) || null
      if (client_id) linked += 1
    }
    return {
      workspace_id: workspace.id,
      platform: 'meta' as const,
      ...a,
      client_id,
      last_synced_at: now,
      sync_error: null,
    }
  })

  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await db.from('ad_accounts').upsert(rows.slice(i, i + 200), { onConflict: 'workspace_id,platform,external_account_id' })
    if (error) return { ok: false, error: `Não consegui salvar as contas (${error.code ?? 'erro'}). Confira se a migration 0007 foi aplicada.` }
  }

  await audit({
    workspaceId: workspace.id,
    actorType: 'user',
    actorId: c.userId,
    action: 'ad_accounts.sync_meta',
    entityType: 'workspace',
    entityId: workspace.id,
    metadata: { total: rows.length, created, linked }, // nunca o token
  })
  revalidatePath(`/a/${ws}/contas`)
  return { ok: true, total: rows.length, created, updated: rows.length - created, linked, synced_at: now }
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
