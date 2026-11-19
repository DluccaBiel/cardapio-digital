import { notFound } from 'next/navigation'
import { getWorkspaceBySlug } from '../../../../lib/db/workspaces'
import { loadOverview } from '../../../../lib/db/overview'
import { createServerClient } from '../../../../lib/supabaseServer'
import { OverviewScreen } from '../../../../components/hub/overview/OverviewScreen'

export const dynamic = 'force-dynamic'
export const maxDuration = 300
export const metadata = { title: 'Undercut — Visão geral' }

/** Visão geral com dados reais: clientes + contas de anúncio sincronizadas da Meta (RLS). */
export default async function VisaoGeralPage({
  params,
  searchParams,
}: {
  params: { ws: string }
  searchParams: { q?: string }
}) {
  const workspace = await getWorkspaceBySlug(params.ws)
  if (!workspace) notFound()

  const { clients, tags, lastSyncedAt } = await loadOverview(createServerClient(), workspace.id)

  return (
    <OverviewScreen
      ws={params.ws}
      canSync={['owner', 'coordenador'].includes(workspace.role)}
      lastSyncedAt={lastSyncedAt}
      initialClients={clients}
      initialTags={tags}
      initialQuery={typeof searchParams.q === 'string' ? searchParams.q : ''}
      workspaceName={workspace.name}
    />
  )
}
