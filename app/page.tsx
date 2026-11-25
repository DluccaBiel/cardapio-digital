import { redirect } from 'next/navigation'
import { getUserWorkspaces } from '../lib/db/workspaces'
import { homePath } from '../lib/workspace-role'
import { createServerClient } from '../lib/supabaseServer'

export default async function Home() {
  const supabase = createServerClient()
  const { data } = await supabase.auth.getUser()
  if (!data.user) redirect('/login')

  const workspaces = await getUserWorkspaces()
  if (workspaces.length === 0) redirect('/onboarding')
  redirect(homePath(workspaces[0]))
}
