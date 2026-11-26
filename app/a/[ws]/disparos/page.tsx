import { notFound } from 'next/navigation'
import { getWorkspaceBySlug } from '../../../../lib/db/workspaces'
import { loadDisparos } from '../../../../lib/db/disparos'
import { DisparosScreen } from '../../../../components/hub/prospect/DisparosScreen'

export const dynamic = 'force-dynamic'
export const maxDuration = 30 // dá tempo de ligar o robô remoto ao iniciar o disparo
export const metadata = { title: 'Undercut — Disparos' }

export default async function DisparosPage({ params }: { params: { ws: string } }) {
  const workspace = await getWorkspaceBySlug(params.ws)
  if (!workspace) notFound()

  const data = await loadDisparos(workspace.id)
  return (
    <DisparosScreen
      ws={workspace.slug}
      canManage={['owner', 'coordenador'].includes(workspace.role)}
      ready={data.ready}
      initialSession={data.session}
      leads={data.leads}
      campaigns={data.campaigns}
    />
  )
}
