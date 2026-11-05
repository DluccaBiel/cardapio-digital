import { redirect } from 'next/navigation'
import { getUserWorkspaces } from '../lib/db/workspaces'
import { createServerClient } from '../lib/supabaseServer'

export default async function Home() {
  const supabase = createServerClient()
  const { data } = await supabase.auth.getUser()
  if (!data.user) redirect('/login')

  const workspaces = await getUserWorkspaces()
  if (workspaces.length === 0) redirect('/onboarding')
  redirect(`/a/${workspaces[0].slug}/visao-geral`)
}
