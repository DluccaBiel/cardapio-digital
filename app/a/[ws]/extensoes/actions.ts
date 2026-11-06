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
