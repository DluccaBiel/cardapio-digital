'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createAdminClient } from '../../lib/supabaseAdmin'
import { createServerClient } from '../../lib/supabaseServer'
import { isValidWorkspaceSlug, toWorkspaceSlug } from '../../lib/slug'

const schema = z.object({
  name: z.string().trim().min(2, 'Nome muito curto').max(80, 'Nome muito longo'),
  // Aceita qualquer texto/link; a normalização para slug vem abaixo.
  slug: z.string().trim().min(1, 'Informe o identificador ou cole um link').max(300, 'Link muito longo'),
})

export type CreateWorkspaceState = { error: string | null }

export async function createWorkspace(prev: CreateWorkspaceState, formData: FormData): Promise<CreateWorkspaceState> {
  const parsed = schema.safeParse({ name: formData.get('name'), slug: formData.get('slug') })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Dados inválidos' }
  }

  const slug = toWorkspaceSlug(parsed.data.slug)
  if (!isValidWorkspaceSlug(slug)) {
    return { error: 'Não foi possível gerar um endereço com esse link. Use letras/números ou cole outra URL.' }
  }

  const supabase = createServerClient()
  const { data: userData } = await supabase.auth.getUser()
  const user = userData.user
  if (!user) return { error: 'Sessão expirada. Faça login novamente.' }

  // Bootstrap do primeiro workspace: usa service role (o RLS impede o membro inicial de entrar como dono por RLS comum)
  const admin = createAdminClient()

  const { data: ws, error: wsError } = await admin
    .from('workspaces')
    .insert({ name: parsed.data.name, slug, plan: 'free' })
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
