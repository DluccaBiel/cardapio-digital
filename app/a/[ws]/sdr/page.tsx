import { notFound } from 'next/navigation'
import { getWorkspaceBySlug } from '../../../../lib/db/workspaces'
import { listProspectClients } from '../../../../lib/db/prospects'
import { icpFromClient } from '../../../../lib/sdr/score'
import { SdrScreen } from '../../../../components/hub/prospect/SdrScreen'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Undercut — SDR' }

export default async function SdrPage({ params }: { params: { ws: string } }) {
  const workspace = await getWorkspaceBySlug(params.ws)
  if (!workspace) notFound()

  const { clients, missingColumns } = await listProspectClients(workspace.id)
  const leads = clients.map((c) => {
    const icp = icpFromClient(c)
    return { ...c, icpScore: icp.score, icpEvidencias: icp.evidencias }
  })
  return <SdrScreen basePath={`/a/${workspace.slug}`} leads={leads} missingColumns={missingColumns} />
}
