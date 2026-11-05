'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createAdminClient } from '../../lib/supabaseAdmin'
import { createServerClient } from '../../lib/supabaseServer'

const schema = z.object({
  name: z.string().trim().min(2, 'Nome muito curto').max(80, 'Nome muito longo'),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,62}$/, 'Use letras minúsculas, números e hífens (ex.: orvia-assessoria)'),
})

export type CreateWorkspaceState = { error: string | null }

export async function createWorkspace(prev: CreateWorkspaceState, formData: FormData): Promise<CreateWorkspaceState> {
  const parsed = schema.safeParse({ name: formData.get('name'), slug: formData.get('slug') })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Dados inválidos' }
  }

  const supabase = createServerClient()
  const { data: userData } = await supabase.auth.getUser()
  const user = userData.user
  if (!user) return { error: 'Sessão expirada. Faça login novamente.' }

  // Bootstrap do primeiro workspace: usa service role (o RLS impede o membro inicial de entrar como dono por RLS comum)
  const admin = createAdminClient()

  const { data: ws, error: wsError } = await admin
    .from('workspaces')
    .insert({ name: parsed.data.name, slug: parsed.data.slug, plan: 'free' })
    .select('id, slug')
    .single()

  if (wsError) {
    if (wsError.code === '23505') return { error: 'Esse identificador (slug) já está em uso. Escolha outro.' }
    return { error: 'Não foi possível criar o workspace. Tente novamente.' }
  }

  const { error: memberError } = await admin
    .from('members')
    .insert({ workspace_id: ws.id, user_id: user.id, role: 'owner' })

  if (memberError) {
    await admin.from('workspaces').delete().eq('id', ws.id) // compensação
    return { error: 'Não foi possível vincular você ao workspace. Tente novamente.' }
  }

  revalidatePath('/')
  redirect(`/a/${ws.slug}/visao-geral`)
}
