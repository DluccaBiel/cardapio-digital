import { notFound, redirect } from 'next/navigation'
import { getUserWorkspaces, getWorkspaceBySlug } from '../../../lib/db/workspaces'
import { createServerClient } from '../../../lib/supabaseServer'
import { appEnvLabel } from '../../../lib/demo'
import { getClients } from '../../../lib/mock'
import { HubShell } from '../../../components/hub/HubShell'

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
    <HubShell
      workspace={{ name: current.name, slug: current.slug }}
      role={current.role}
      workspaces={workspaces.map((workspace) => ({ name: workspace.name, slug: workspace.slug, role: workspace.role }))}
      userInitial={initial}
      basePath={`/a/${current.slug}`}
      envLabel={appEnvLabel()}
      clients={getClients()}
    >
      {children}
    </HubShell>
  )
}
