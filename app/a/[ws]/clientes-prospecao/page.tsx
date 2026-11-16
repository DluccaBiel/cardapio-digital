import { notFound } from 'next/navigation'
import { getWorkspaceBySlug } from '../../../../lib/db/workspaces'
import { listProspectClients } from '../../../../lib/db/prospects'
import { ProspectScreen } from '../../../../components/hub/prospect/ProspectScreen'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Undercut — Prospecção' }

export default async function ProspeccaoPage({ params }: { params: { ws: string } }) {
  const workspace = await getWorkspaceBySlug(params.ws)
  if (!workspace) notFound()

  const { clients, missingColumns } = await listProspectClients(workspace.id)
  return <ProspectScreen ws={workspace.slug} clients={clients} missingColumns={missingColumns} />
}
