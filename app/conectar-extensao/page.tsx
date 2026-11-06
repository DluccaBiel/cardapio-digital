import { redirect } from 'next/navigation'
import { getUserWorkspaces } from '../../lib/db/workspaces'
import { createServerClient } from '../../lib/supabaseServer'

export const dynamic = 'force-dynamic'

/** Atalho aberto pela extensão ("Conectar automaticamente"): leva à tela de Extensões do 1º workspace. */
export default async function ConectarExtensao() {
  const supabase = createServerClient()
  const { data } = await supabase.auth.getUser()
  if (!data.user) redirect('/login')
  const workspaces = await getUserWorkspaces()
  if (workspaces.length === 0) redirect('/onboarding')
  redirect(`/a/${workspaces[0].slug}/extensoes?conectar=1`)
}
