'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { brand } from '@undercut/brand'
import { audit } from '../../../../lib/audit'
import { getWorkspaceBySlug } from '../../../../lib/db/workspaces'
import { hashInviteToken, INVITE_TTL_DAYS, newInviteToken } from '../../../../lib/invites'
import { createAdminClient } from '../../../../lib/supabaseAdmin'
import { createServerClient } from '../../../../lib/supabaseServer'

type Fail = { ok: false; error: string }

async function ownerCtx(ws: string) {
  const workspace = await getWorkspaceBySlug(ws)
  if (!workspace) return { error: 'Workspace não encontrado.' } as const
  if (workspace.role !== 'owner') return { error: 'Somente o owner cria links de acesso.' } as const
  const { data } = await createServerClient().auth.getUser()
  if (!data.user) return { error: 'Sessão expirada. Entre de novo.' } as const
  return { workspace, userId: data.user.id } as const
}

const createSchema = z.object({ label: z.string().trim().min(2, 'Dê um nome para identificar a pessoa (ex.: Ana — design).').max(80) })

/**
 * Cria um link de convite de COLABORADOR (só vê o menu Extensões).
 * O link abre uma página pública em que a própria pessoa escolhe e-mail e senha.
 * O valor em claro aparece UMA vez aqui; no banco fica só o hash.
 */
export async function createInviteLinkAction(ws: string, input: unknown): Promise<{ ok: true; link: string; expiresAt: string } | Fail> {
  const c = await ownerCtx(ws)
  if ('error' in c) return { ok: false, error: c.error! }
  const parsed = createSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' }

  const token = newInviteToken()
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000).toISOString()
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('member_invites')
    .insert({
      workspace_id: c.workspace.id,
      token_hash: hashInviteToken(token),
      role: 'colaborador',
      label: parsed.data.label,
      created_by: c.userId,
      expires_at: expiresAt,
    })
    .select('id')
    .single()
  if (error || !data) return { ok: false, error: 'Não consegui criar o link. A migration 20261125120100 foi aplicada?' }

  await audit({
    workspaceId: c.workspace.id,
    actorType: 'user',
    actorId: c.userId,
    action: 'member.invite_link',
    entityType: 'member_invite',
    entityId: data.id,
    metadata: { role: 'colaborador', label: parsed.data.label.slice(0, 80) }, // nunca o token
  })
  revalidatePath(`/a/${ws}/configuracoes`)
  const base = (process.env.NEXT_PUBLIC_APP_URL || brand.baseUrl).replace(/\/+$/, '')
  return { ok: true, link: `${base}/convite/${token}`, expiresAt }
}

export async function revokeInviteLinkAction(ws: string, inviteId: string): Promise<{ ok: true } | Fail> {
  const c = await ownerCtx(ws)
  if ('error' in c) return { ok: false, error: c.error! }
  if (!z.string().uuid().safeParse(inviteId).success) return { ok: false, error: 'Convite inválido.' }
  const { data, error } = await createAdminClient()
    .from('member_invites')
    .update({ revoked_at: new Date().toISOString() })
    .eq('workspace_id', c.workspace.id)
    .eq('id', inviteId)
    .is('used_at', null)
    .is('revoked_at', null)
    .select('id')
  if (error || !data?.length) return { ok: false, error: 'Não foi possível cancelar (já usado ou cancelado?).' }
  await audit({ workspaceId: c.workspace.id, actorType: 'user', actorId: c.userId, action: 'member.invite_revoke', entityType: 'member_invite', entityId: inviteId })
  revalidatePath(`/a/${ws}/configuracoes`)
  return { ok: true }
}
