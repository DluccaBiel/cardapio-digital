'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { audit } from '../../../../lib/audit'
import { API_SCOPES, generateApiKey, IFOOD_EXTENSION_SCOPES } from '../../../../lib/api/keys'
import { isExtensionSlug, PLATFORM_LABEL, PLATFORM_OF } from '../../../../lib/api/extensions'
import { researchAnswer } from '../../../../lib/api/research'
import { getWorkspaceBySlug } from '../../../../lib/db/workspaces'
import { createAdminClient } from '../../../../lib/supabaseAdmin'
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
  const [{ data, error }, { data: catalog }] = await Promise.all([
    db
      .from('extension_installs')
      .select('extension_id, version, last_seen_at, api_keys ( name, revoked_at, expires_at, last_used_at )')
      .eq('workspace_id', workspace.id),
    db.from('extensions').select('id, slug, name').order('name'),
  ])
  if (error) return { ok: false, error: 'Não consegui consultar as extensões.' }
  const now = Date.now()
  const byId = new Map<string, ExtensionLiveStatus>()
  for (const row of data ?? []) {
    const r = row as any
    const k = Array.isArray(r.api_keys) ? r.api_keys[0] : r.api_keys
    const key: ExtensionLiveStatus['key'] = !k ? 'missing' : k.revoked_at ? 'revoked' : k.expires_at && new Date(k.expires_at).getTime() < now ? 'expired' : 'active'
    byId.set(r.extension_id, { extension_id: r.extension_id, version: r.version, last_seen_at: r.last_seen_at, key, key_name: k?.name ?? null, key_last_used_at: k?.last_used_at ?? null })
  }
  // O "Sincronizar" puxa TODAS as extensões cadastradas, inclusive as que nunca conectaram.
  const installs: ExtensionLiveStatus[] = (catalog ?? []).map(
    (e) => byId.get(e.id) ?? { extension_id: e.id, version: null, last_seen_at: null, key: 'missing', key_name: null, key_last_used_at: null },
  )
  return { ok: true, installs, checked_at: new Date().toISOString() }
}

const saveExtensionSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,62}$/, 'Slug inválido (use letras minúsculas, números e hífen).'),
  name: z.string().trim().min(2, 'Dê um nome à extensão.').max(80),
  description: z.string().trim().max(400).nullable().optional(),
  homepage_url: z.union([z.string().trim().url('Endereço inválido.').max(300), z.literal(''), z.null()]).optional(),
})

export type SaveExtensionResult = { ok: true; id: string } | { ok: false; error: string }

/**
 * Cadastra ou atualiza uma extensão no catálogo global (owner/coordenador = ADM).
 * O catálogo é global (não por workspace) — por isso a escrita usa service role
 * APÓS validar a sessão e o papel do usuário.
 */
export async function saveExtensionAction(ws: string, input: unknown): Promise<SaveExtensionResult> {
  const workspace = await getWorkspaceBySlug(ws)
  if (!workspace) return { ok: false, error: 'Workspace não encontrado.' }
  if (!['owner', 'coordenador'].includes(workspace.role)) return { ok: false, error: 'Somente dono ou suporte (coordenador) alteram o catálogo.' }
  const parsed = saveExtensionSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' }

  const db = createServerClient()
  const { data: userData } = await db.auth.getUser()
  if (!userData.user) return { ok: false, error: 'Sessão expirada.' }

  const admin = createAdminClient()
  const row = {
    slug: parsed.data.slug,
    name: parsed.data.name,
    description: parsed.data.description || null,
    homepage_url: parsed.data.homepage_url || null,
  }
  const result = parsed.data.id
    ? await admin.from('extensions').update(row).eq('id', parsed.data.id).select('id').single()
    : await admin.from('extensions').insert(row).select('id').single()
  if (result.error || !result.data) {
    return { ok: false, error: result.error?.code === '23505' ? 'Já existe uma extensão com esse slug.' : 'Não consegui salvar a extensão.' }
  }

  await audit({
    workspaceId: workspace.id,
    actorType: 'user',
    actorId: userData.user.id,
    action: parsed.data.id ? 'extension.update' : 'extension.create',
    entityType: 'extension',
    entityId: result.data.id,
    metadata: { slug: row.slug },
  })
  revalidatePath(`/a/${ws}/extensoes`)
  revalidatePath(`/a/${ws}/configuracoes`)
  return { ok: true, id: result.data.id }
}

const researchSchema = z.object({
  question: z.string().trim().min(5, 'Escreva uma pergunta com pelo menos 5 caracteres.').max(500, 'Pergunta muito longa (máx. 500).'),
  context: z.string().trim().max(1200).optional(),
})

/** Agente de pesquisa usado pelo painel (mesma engine do /api/v1/research). */
export async function researchAction(ws: string, input: unknown): Promise<{ ok: true; data: Awaited<ReturnType<typeof researchAnswer>> } | { ok: false; error: string }> {
  const workspace = await getWorkspaceBySlug(ws)
  if (!workspace) return { ok: false, error: 'Workspace não encontrado.' }
  const parsed = researchSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Pergunta inválida.' }
  const db = createServerClient()
  const { data: userData } = await db.auth.getUser()
  if (!userData.user) return { ok: false, error: 'Sessão expirada.' }

  try {
    const data = await researchAnswer(parsed.data)
    await audit({
      workspaceId: workspace.id,
      actorType: 'user',
      actorId: userData.user.id,
      action: 'research.answered',
      entityType: 'workspace',
      entityId: workspace.id,
      metadata: { mode: data.mode, status: data.status, sources: data.sources.length, panel: true },
    })
    return { ok: true, data }
  } catch {
    return { ok: false, error: 'O agente de pesquisa não conseguiu responder agora. Tente de novo em instantes.' }
  }
}

/**
 * Código de conexão de uma extensão (iFood, Cardápio Web ou Anota AI): cria uma chave
 * vinculada à extensão escolhida (escopos mínimos, 365 dias) e devolve o valor UMA vez.
 * Usado pelo "Conectar com um clique" (entrega direto à extensão pela ponte) e pelo
 * painel de conexão, onde o usuário copia o código e cola nas opções da extensão.
 */
export async function pairExtensionAction(ws: string, slug: string): Promise<CreateResult> {
  const workspace = await getWorkspaceBySlug(ws)
  if (!workspace) return { ok: false, error: 'Workspace não encontrado.' }
  if (!['owner', 'coordenador'].includes(workspace.role)) return { ok: false, error: 'Somente dono ou coordenador podem conectar a extensão.' }
  if (!isExtensionSlug(slug)) return { ok: false, error: 'Extensão desconhecida.' }
  const db = createServerClient()
  const { data: ext } = await db.from('extensions').select('id').eq('slug', slug).maybeSingle()
  if (!ext) return { ok: false, error: `Extensão ${PLATFORM_LABEL[PLATFORM_OF[slug]]} ainda não registrada no servidor (migration pendente).` }
  const today = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
  return createApiKeyAction(ws, {
    name: `Código de conexão ${PLATFORM_LABEL[PLATFORM_OF[slug]]} · ${today}`,
    extension_id: ext.id,
    scopes: IFOOD_EXTENSION_SCOPES,
    expires_in_days: 365,
  })
}

/** Compatibilidade: conexão automática da extensão iFood. */
export async function pairIfoodExtensionAction(ws: string): Promise<CreateResult> {
  return pairExtensionAction(ws, 'orvia-ifood')
}
