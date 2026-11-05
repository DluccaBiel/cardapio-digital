import { notFound, redirect } from 'next/navigation'
import { getUserWorkspaces, getWorkspaceBySlug } from '../../../lib/db/workspaces'
import { createServerClient } from '../../../lib/supabaseServer'
import { Shell } from './_components/Shell'

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: { ws: string }
}) {
  const { ws } = params

  const supabase = createServerClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) redirect('/login')

  const current = await getWorkspaceBySlug(ws)
  if (!current) notFound()

  const workspaces = await getUserWorkspaces()

  const initial = (userData.user.email ?? '?').charAt(0).toUpperCase()

  return (
    <Shell
      ws={{ name: current.name, slug: current.slug }}
      role={current.role}
      workspaces={workspaces.map((w) => ({ name: w.name, slug: w.slug, role: w.role }))}
      userInitial={initial}
    >
      {children}
    </Shell>
  )
}
