'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { audit } from '../../../../lib/audit'
import { API_SCOPES, generateApiKey } from '../../../../lib/api/keys'
import { getWorkspaceBySlug } from '../../../../lib/db/workspaces'
import { createServerClient } from '../../../../lib/supabaseServer'

const createSchema = z.object({
  name: z.string().trim().min(2, 'Dê um nome à chave (ex.: Notebook do Gabriel)').max(80),
  extension_id: z.string().uuid().nullable(),
  scopes: z.array(z.enum(API_SCOPES)).min(1, 'Selecione pelo menos um escopo'),
  expires_in_days: z.number().int().min(0).max(730),
})

type CreateResult = { ok: true; key: string; prefix: string } | { ok: false; error: string }

/** Cria a chave: devolve o valor em claro UMA vez; o banco guarda só o hash. RLS: owner/coordenador. */
export async function createApiKeyAction(ws: string, input: unknown): Promise<CreateResult> {
  const workspace = await getWorkspaceBySlug(ws)
  if (!workspace) return { ok: false, error: 'Workspace não encontrado.' }
  if (!['owner', 'coordenador'].includes(workspace.role)) return { ok: false, error: 'Somente dono ou coordenador gerenciam chaves.' }
  const parsed = createSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos' }

  const db = createServerClient()
  const { data: userData } = await db.auth.getUser()
  if (!userData.user) return { ok: false, error: 'Sessão expirada.' }

  const { key, prefix, hash } = generateApiKey()
  const expires_at = parsed.data.expires_in_days > 0 ? new Date(Date.now() + parsed.data.expires_in_days * 86_400_000).toISOString() : null
  const { data, error } = await db
    .from('api_keys')
    .insert({
      workspace_id: workspace.id,
      extension_id: parsed.data.extension_id,
      name: parsed.data.name,
      key_hash: hash,
      key_prefix: prefix,
      scopes: parsed.data.scopes,
      expires_at,
      created_by: userData.user.id,
    })
    .select('id')
    .single()
  if (error) return { ok: false, error: 'Não foi possível criar a chave.' }

  await audit({
    workspaceId: workspace.id,
    actorType: 'user',
    actorId: userData.user.id,
    action: 'api_key.create',
    entityType: 'api_key',
    entityId: data.id,
    metadata: { scopes: parsed.data.scopes, prefix }, // nunca o valor da chave
  })
  revalidatePath(`/a/${ws}/extensoes`)
  return { ok: true, key, prefix }
}

export async function revokeApiKeyAction(ws: string, id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const workspace = await getWorkspaceBySlug(ws)
  if (!workspace || !['owner', 'coordenador'].includes(workspace.role)) return { ok: false, error: 'Sem permissão.' }
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: 'id inválido' }
  const db = createServerClient()
  const { data: userData } = await db.auth.getUser()
  const { data, error } = await db
    .from('api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('workspace_id', workspace.id)
    .eq('id', id)
    .is('revoked_at', null)
    .select('id')
  if (error || !data?.length) return { ok: false, error: 'Não foi possível revogar (já revogada?).' }
  await audit({ workspaceId: workspace.id, actorType: 'user', actorId: userData.user?.id ?? null, action: 'api_key.revoke', entityType: 'api_key', entityId: id })
  revalidatePath(`/a/${ws}/extensoes`)
  return { ok: true }
}

const idsSchema = z.array(z.string().uuid()).min(1, 'Selecione pelo menos uma chave.').max(200)
type BulkResult = { ok: true; count: number } | { ok: false; error: string }

/** Revoga várias chaves de uma vez (owner/coordenador). Já revogadas são ignoradas. */
export async function revokeApiKeysAction(ws: string, ids: unknown): Promise<BulkResult> {
  const workspace = await getWorkspaceBySlug(ws)
  if (!workspace || !['owner', 'coordenador'].includes(workspace.role)) return { ok: false, error: 'Sem permissão.' }
  const parsed = idsSchema.safeParse(ids)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Seleção inválida.' }
  const db = createServerClient()
  const { data: userData } = await db.auth.getUser()
  const { data, error } = await db
    .from('api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('workspace_id', workspace.id)
    .in('id', parsed.data)
    .is('revoked_at', null)
    .select('id')
  if (error) return { ok: false, error: 'Não foi possível revogar.' }
  for (const row of data ?? []) {
    await audit({ workspaceId: workspace.id, actorType: 'user', actorId: userData.user?.id ?? null, action: 'api_key.revoke', entityType: 'api_key', entityId: row.id, metadata: { bulk: true } })
  }
  revalidatePath(`/a/${ws}/extensoes`)
  return { ok: true, count: data?.length ?? 0 }
}

/**
 * Exclui várias chaves (somente OWNER — mesma regra da policy api_keys_delete).
 * A chave para de funcionar na hora (a API procura pelo hash). Vínculos ficam:
 * extension_installs.api_key_id e menu_optimizations.created_by_key viram NULL;
 * o audit_log mantém o registro (actor_id), sem segredo.
 */
export async function deleteApiKeysAction(ws: string, ids: unknown): Promise<BulkResult> {
  const workspace = await getWorkspaceBySlug(ws)
  if (!workspace) return { ok: false, error: 'Workspace não encontrado.' }
  if (workspace.role !== 'owner') return { ok: false, error: 'Somente o dono do workspace exclui chaves. Você pode revogá-las.' }
  const parsed = idsSchema.safeParse(ids)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Seleção inválida.' }
  const db = createServerClient()
  const { data: userData } = await db.auth.getUser()
  const { data, error } = await db.from('api_keys').delete().eq('workspace_id', workspace.id).in('id', parsed.data).select('id, key_prefix')
  if (error) return { ok: false, error: 'Não foi possível excluir as chaves.' }
  for (const row of data ?? []) {
    await audit({ workspaceId: workspace.id, actorType: 'user', actorId: userData.user?.id ?? null, action: 'api_key.delete', entityType: 'api_key', entityId: row.id, metadata: { prefix: row.key_prefix, bulk: true } })
  }
  revalidatePath(`/a/${ws}/extensoes`)
  return { ok: true, count: data?.length ?? 0 }
}

export type ExtensionLiveStatus = {
  extension_id: string
  version: string | null
  last_seen_at: string | null
  key: 'active' | 'revoked' | 'expired' | 'missing'
  key_name: string | null
  key_last_used_at: string | null
}

/**
 * "Sincronizar" na tela de Extensões: relê do banco, na hora, se cada extensão
 * segue conectada (chave vinculada ainda válida + último contato da extensão).
 * O contato (last_seen_at) é renovado pela extensão a cada ~1 min enquanto o portal iFood está aberto.
 */
export async function checkExtensionsAction(ws: string): Promise<{ ok: true; installs: ExtensionLiveStatus[]; checked_at: string } | { ok: false; error: string }> {
  const workspace = await getWorkspaceBySlug(ws)
  if (!workspace) return { ok: false, error: 'Workspace não encontrado.' }
  if (!['owner', 'coordenador'].includes(workspace.role)) return { ok: false, error: 'Somente dono ou coordenador veem o status das extensões.' }
  const db = createServerClient()
  const { data, error } = await db
    .from('extension_installs')
    .select('extension_id, version, last_seen_at, api_keys ( name, revoked_at, expires_at, last_used_at )')
    .eq('workspace_id', workspace.id)
  if (error) return { ok: false, error: 'Não consegui consultar as extensões.' }
  const now = Date.now()
  const installs = (data ?? []).map((row: any): ExtensionLiveStatus => {
    const k = Array.isArray(row.api_keys) ? row.api_keys[0] : row.api_keys
    const key: ExtensionLiveStatus['key'] = !k ? 'missing' : k.revoked_at ? 'revoked' : k.expires_at && new Date(k.expires_at).getTime() < now ? 'expired' : 'active'
    return { extension_id: row.extension_id, version: row.version, last_seen_at: row.last_seen_at, key, key_name: k?.name ?? null, key_last_used_at: k?.last_used_at ?? null }
  })
  return { ok: true, installs, checked_at: new Date().toISOString() }
}

/**
 * Conexão automática ("conectar com um clique"): cria uma chave para a extensão
 * iFood e devolve o valor UMA vez para a própria página, que entrega direto à
 * extensão instalada neste navegador (ponte hub-bridge). O usuário nunca vê/cola a chave.
 */
export async function pairIfoodExtensionAction(ws: string): Promise<CreateResult> {
  const workspace = await getWorkspaceBySlug(ws)
  if (!workspace) return { ok: false, error: 'Workspace não encontrado.' }
  if (!['owner', 'coordenador'].includes(workspace.role)) return { ok: false, error: 'Somente dono ou coordenador podem conectar a extensão.' }
  const db = createServerClient()
  const { data: ext } = await db.from('extensions').select('id').eq('slug', 'orvia-ifood').maybeSingle()
  if (!ext) return { ok: false, error: 'Extensão iFood não registrada (migration 0004 pendente).' }
  const today = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
  return createApiKeyAction(ws, {
    name: `Conexão automática · ${today}`,
    extension_id: ext.id,
    scopes: ['clientes:ler', 'catalogo:ler', 'catalogo:escrever'],
    expires_in_days: 365,
  })
}
