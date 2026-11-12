import { notFound } from 'next/navigation'
import { getWorkspaceBySlug } from '../../../../lib/db/workspaces'
import { getClients, getReportDraft } from '../../../../lib/mock'
import { ReportsScreen } from '../../../../components/hub/reports/ReportsScreen'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Undercut — Relatórios' }

export default async function RelatoriosPage({ params }: { params: { ws: string } }) {
  const workspace = await getWorkspaceBySlug(params.ws)
  if (!workspace) notFound()

  return <ReportsScreen initialDraft={getReportDraft()} clients={getClients()} workspaceName={workspace.name} />
}
