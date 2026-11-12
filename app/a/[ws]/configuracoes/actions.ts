'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { brand } from '@undercut/brand'
import { audit } from '../../../../lib/audit'
import { getWorkspaceBySlug } from '../../../../lib/db/workspaces'
import { createAdminClient } from '../../../../lib/supabaseAdmin'
import { createServerClient } from '../../../../lib/supabaseServer'

const MANAGERS = ['owner', 'coordenador']
const ROLES = ['owner', 'coordenador', 'editor', 'visualizador'] as const
type Role = (typeof ROLES)[number]

async function ctx(ws: string, roles: string[] = MANAGERS) {
  const workspace = await getWorkspaceBySlug(ws)
  if (!workspace) return { error: 'Workspace não encontrado.' } as const
  if (!roles.includes(workspace.role)) return { error: 'Sem permissão para esta ação.' } as const
  const db = createServerClient()
  const { data } = await db.auth.getUser()
  if (!data.user) return { error: 'Sessão expirada. Entre de novo.' } as const
  return { workspace, userId: data.user.id } as const
}

type Fail = { ok: false; error: string }

const inviteSchema = z.object({
  email: z.string().trim().email('E-mail inválido.').max(160),
  role: z.enum(ROLES),
})

/**
 * Convida (ou atualiza o papel de) um acesso ao workspace.
 * Somente OWNER. Usa service role apenas depois de validar sessão + papel.
 */
export async function inviteMemberAction(ws: string, input: unknown): Promise<{ ok: true; email: string; role: Role; invited: boolean } | Fail> {
  const c = await ctx(ws, ['owner'])
  if ('error' in c) return { ok: false, error: c.error! }
  const parsed = inviteSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' }
  const email = parsed.data.email.toLowerCase()

  const admin = createAdminClient()
  const { data: listed } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  let invited = false
  let userId = listed?.users.find((u) => u.email?.toLowerCase() === email)?.id
  if (!userId) {
    const base = (process.env.NEXT_PUBLIC_APP_URL || brand.baseUrl).replace(/\/+$/, '')
    const { data: inv, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: `${base}/login` })
    if (error || !inv?.user) return { ok: false, error: 'Não consegui enviar o convite. Confira o SMTP do Supabase e tente de novo.' }
    userId = inv.user.id
    invited = true
  }

  const { error } = await admin
    .from('members')
    .upsert({ workspace_id: c.workspace.id, user_id: userId, role: parsed.data.role, invited_by: c.userId }, { onConflict: 'workspace_id,user_id' })
  if (error) return { ok: false, error: 'Não consegui salvar o acesso. Tente de novo.' }

  await audit({
    workspaceId: c.workspace.id,
    actorType: 'user',
    actorId: c.userId,
    action: invited ? 'member.invite' : 'member.role_update',
    entityType: 'member',
    entityId: userId,
    metadata: { role: parsed.data.role, invited },
  })
  revalidatePath(`/a/${ws}/configuracoes`)
  return { ok: true, email, role: parsed.data.role, invited }
}

const memberSchema = z.object({ memberId: z.string().uuid(), role: z.enum(ROLES) })

export async function updateMemberRoleAction(ws: string, input: unknown): Promise<{ ok: true } | Fail> {
  const c = await ctx(ws, ['owner'])
  if ('error' in c) return { ok: false, error: c.error! }
  const parsed = memberSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Dados inválidos.' }
  const admin = createAdminClient()
  const { data: member } = await admin.from('members').select('id, role, user_id').eq('workspace_id', c.workspace.id).eq('id', parsed.data.memberId).maybeSingle()
  if (!member) return { ok: false, error: 'Acesso não encontrado.' }
  if (member.role === 'owner' && parsed.data.role !== 'owner') {
    const { count } = await admin.from('members').select('id', { count: 'exact', head: true }).eq('workspace_id', c.workspace.id).eq('role', 'owner')
    if ((count ?? 0) <= 1) return { ok: false, error: 'O workspace precisa de pelo menos um owner.' }
  }
  const { error } = await admin.from('members').update({ role: parsed.data.role }).eq('workspace_id', c.workspace.id).eq('id', parsed.data.memberId)
  if (error) return { ok: false, error: 'Não consegui alterar o papel.' }
  await audit({ workspaceId: c.workspace.id, actorType: 'user', actorId: c.userId, action: 'member.role_update', entityType: 'member', entityId: member.user_id, metadata: { role: parsed.data.role } })
  revalidatePath(`/a/${ws}/configuracoes`)
  return { ok: true }
}

export async function removeMemberAction(ws: string, memberId: string): Promise<{ ok: true } | Fail> {
  const c = await ctx(ws, ['owner'])
  if ('error' in c) return { ok: false, error: c.error! }
  if (!z.string().uuid().safeParse(memberId).success) return { ok: false, error: 'Acesso inválido.' }
  const admin = createAdminClient()
  const { data: member } = await admin.from('members').select('id, role, user_id').eq('workspace_id', c.workspace.id).eq('id', memberId).maybeSingle()
  if (!member) return { ok: false, error: 'Acesso não encontrado.' }
  if (member.role === 'owner') {
    const { count } = await admin.from('members').select('id', { count: 'exact', head: true }).eq('workspace_id', c.workspace.id).eq('role', 'owner')
    if ((count ?? 0) <= 1) return { ok: false, error: 'O workspace precisa de pelo menos um owner.' }
  }
  const { error } = await admin.from('members').delete().eq('workspace_id', c.workspace.id).eq('id', memberId)
  if (error) return { ok: false, error: 'Não consegui remover o acesso.' }
  await audit({ workspaceId: c.workspace.id, actorType: 'user', actorId: c.userId, action: 'member.remove', entityType: 'member', entityId: member.user_id })
  revalidatePath(`/a/${ws}/configuracoes`)
  return { ok: true }
}

const clientSchema = z.object({
  name: z.string().trim().min(1, 'Informe o nome do cliente.').max(160),
  email: z.union([z.string().trim().email('E-mail inválido.').max(160), z.literal('')]).optional(),
  phone: z.string().trim().max(40).optional(),
  instagram: z.string().trim().max(80).optional(),
  monthly_fee: z.union([z.number().min(0).max(1_000_000), z.literal('')]).optional(),
  notes: z.string().trim().max(1000).optional(),
})

export type NewClientInput = z.input<typeof clientSchema>

/** Cadastra um cliente do workspace (owner/coordenador) — cada um com seus canais. */
export async function createClientAction(ws: string, input: unknown): Promise<{ ok: true; id: string } | Fail> {
  const c = await ctx(ws)
  if ('error' in c) return { ok: false, error: c.error! }
  const parsed = clientSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' }
  const db = createServerClient()
  const { data, error } = await db
    .from('clients')
    .insert({
      workspace_id: c.workspace.id,
      name: parsed.data.name,
      email: parsed.data.email || null,
      phone: parsed.data.phone || null,
      instagram: parsed.data.instagram || null,
      monthly_fee: typeof parsed.data.monthly_fee === 'number' ? parsed.data.monthly_fee : null,
      notes: parsed.data.notes || null,
    })
    .select('id')
    .single()
  if (error || !data) return { ok: false, error: 'Não consegui criar o cliente (permissão?).' }
  await audit({
    workspaceId: c.workspace.id,
    actorType: 'user',
    actorId: c.userId,
    action: 'client.create',
    entityType: 'client',
    entityId: data.id,
    metadata: { name: parsed.data.name.slice(0, 80) },
  })
  revalidatePath(`/a/${ws}/configuracoes`)
  revalidatePath(`/a/${ws}/visao-geral`)
  return { ok: true, id: data.id }
}
