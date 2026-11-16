import { notFound } from 'next/navigation'
import { getWorkspaceBySlug } from '../../../../lib/db/workspaces'
import { listProspectClients } from '../../../../lib/db/prospects'
import { DisparosScreen } from '../../../../components/hub/prospect/DisparosScreen'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Undercut — Disparos' }

export default async function DisparosPage({ params }: { params: { ws: string } }) {
  const workspace = await getWorkspaceBySlug(params.ws)
  if (!workspace) notFound()

  const { clients, missingColumns } = await listProspectClients(workspace.id)
  return <DisparosScreen clients={clients} missingColumns={missingColumns} />
}
