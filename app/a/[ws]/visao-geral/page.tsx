import { notFound } from 'next/navigation'
import { getWorkspaceBySlug } from '../../../../lib/db/workspaces'
import { getClients, MOCK_TAGS_LIST } from '../../../../lib/mock'
import { OverviewScreen } from '../../../../components/hub/overview/OverviewScreen'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Orvia — Visão geral' }

export default async function VisaoGeralPage({
  params,
  searchParams,
}: {
  params: { ws: string }
  searchParams: { q?: string }
}) {
  const workspace = await getWorkspaceBySlug(params.ws)
  if (!workspace) notFound()

  return (
    <OverviewScreen
      initialClients={getClients()}
      initialTags={MOCK_TAGS_LIST}
      initialQuery={typeof searchParams.q === 'string' ? searchParams.q : ''}
      workspaceName={workspace.name}
    />
  )
}
