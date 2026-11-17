'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { audit } from '../../../../lib/audit'
import { getWorkspaceBySlug } from '../../../../lib/db/workspaces'
import { createServerClient } from '../../../../lib/supabaseServer'

/** Situação da Visão geral → status do cliente no banco (enum client_status). */
const TO_DB = { ativo: 'ativo', stand_by: 'pausado', churn: 'encerrado' } as const

export async function setClientSituationAction(ws: string, clientId: string, situation: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!z.string().uuid().safeParse(clientId).success) return { ok: false, error: 'Cliente inválido.' }
  const status = TO_DB[situation as keyof typeof TO_DB]
  if (!status) return { ok: false, error: 'Onboarding ainda não é um status salvo no banco — use Ativo, Stand-by ou Churn.' }
  const workspace = await getWorkspaceBySlug(ws)
  if (!workspace) return { ok: false, error: 'Workspace não encontrado.' }
  const db = createServerClient()
  const { data: u } = await db.auth.getUser()
  if (!u.user) return { ok: false, error: 'Sessão expirada.' }
  const { data, error } = await db.from('clients').update({ status }).eq('workspace_id', workspace.id).eq('id', clientId).select('id')
  if (error || !data?.length) return { ok: false, error: 'Sem permissão para alterar este cliente.' }
  await audit({ workspaceId: workspace.id, actorType: 'user', actorId: u.user.id, action: 'client.status', entityType: 'client', entityId: clientId, metadata: { status } })
  revalidatePath(`/a/${ws}/visao-geral`)
  return { ok: true }
}
