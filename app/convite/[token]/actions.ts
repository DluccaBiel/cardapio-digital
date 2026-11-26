'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { audit } from '../../../lib/audit'
import { hashInviteToken, inviteState, isInviteToken } from '../../../lib/invites'
import { createAdminClient } from '../../../lib/supabaseAdmin'
import { createServerClient } from '../../../lib/supabaseServer'

const schema = z
  .object({
    name: z.string().trim().min(2, 'Informe seu nome.').max(80),
    email: z.string().trim().email('E-mail inválido.').max(160),
    password: z.string().min(8, 'A senha precisa ter pelo menos 8 caracteres.').max(72, 'A senha pode ter no máximo 72 caracteres.'),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: 'As senhas não conferem.', path: ['confirm'] })

export type AcceptState = { error: string | null }

/**
 * A própria pessoa cria e-mail + senha a partir do link.
 * 1) "reivindica" o convite de forma atômica (uso único); 2) cria o usuário já confirmado
 * (quem tem o link foi convidado pelo owner); 3) vincula como colaborador; 4) abre a sessão
 * e manda para Extensões. Qualquer falha desfaz o que foi feito.
 */
export async function acceptInviteAction(token: string, _prev: AcceptState, form: FormData): Promise<AcceptState> {
  if (!isInviteToken(token)) return { error: 'Link inválido.' }
  const parsed = schema.safeParse({
    name: form.get('name'),
    email: form.get('email'),
    password: form.get('password'),
    confirm: form.get('confirm'),
  })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' }
  const email = parsed.data.email.toLowerCase()

  const admin = createAdminClient()
  const tokenHash = hashInviteToken(token)

  const { data: invite } = await admin
    .from('member_invites')
    .select('id, workspace_id, role, created_by, used_at, revoked_at, expires_at, workspaces ( slug )')
    .eq('token_hash', tokenHash)
    .maybeSingle()
  if (!invite || inviteState(invite) !== 'pending') return { error: 'Este link não vale mais (usado, cancelado ou vencido). Peça um novo ao responsável.' }
  const wsRow = Array.isArray(invite.workspaces) ? invite.workspaces[0] : invite.workspaces
  const slug = (wsRow as { slug?: string } | null)?.slug
  if (!slug) return { error: 'Workspace não encontrado.' }

  // Reivindica: só uma requisição vence a corrida.
  const { data: claimed } = await admin
    .from('member_invites')
    .update({ used_at: new Date().toISOString() })
    .eq('id', invite.id)
    .is('used_at', null)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('id')
  if (!claimed?.length) return { error: 'Este link já foi usado. Peça um novo ao responsável.' }
  const unclaim = () => admin.from('member_invites').update({ used_at: null, used_by: null }).eq('id', invite.id)

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: parsed.data.password,
    email_confirm: true,
    user_metadata: { name: parsed.data.name },
  })
  if (createErr || !created?.user) {
    await unclaim()
    const exists = /already|registered|exists/i.test(createErr?.message ?? '')
    return { error: exists ? 'Este e-mail já tem conta no Undercut. Use outro e-mail ou peça ao responsável para dar o acesso à conta existente.' : 'Não consegui criar sua conta. Tente de novo.' }
  }
  const userId = created.user.id

  const { error: memberErr } = await admin
    .from('members')
    .insert({ workspace_id: invite.workspace_id, user_id: userId, role: invite.role, invited_by: invite.created_by })
  if (memberErr) {
    await admin.auth.admin.deleteUser(userId)
    await unclaim()
    return { error: 'Não consegui liberar seu acesso. Tente de novo ou peça um novo link.' }
  }
  await admin.from('member_invites').update({ used_by: userId }).eq('id', invite.id)

  await audit({
    workspaceId: invite.workspace_id,
    actorType: 'user',
    actorId: userId,
    action: 'member.invite_accept',
    entityType: 'member_invite',
    entityId: invite.id,
    metadata: { role: invite.role }, // nunca senha nem token
  })

  const { error: signErr } = await createServerClient().auth.signInWithPassword({ email, password: parsed.data.password })
  if (signErr) redirect('/login')
  redirect(`/a/${slug}/extensoes`)
}
