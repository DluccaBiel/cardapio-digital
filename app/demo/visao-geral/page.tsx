import { getClients, MOCK_TAGS_LIST, MOCK_WORKSPACE } from '../../../lib/mock'
import { OverviewScreen } from '../../../components/hub/overview/OverviewScreen'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Orvia — Demonstração · Visão geral' }

export default function DemoOverviewPage({ searchParams }: { searchParams: { q?: string } }) {
  return (
    <OverviewScreen
      initialClients={getClients()}
      initialTags={MOCK_TAGS_LIST}
      initialQuery={typeof searchParams.q === 'string' ? searchParams.q : ''}
      workspaceName={MOCK_WORKSPACE.name}
    />
  )
}
