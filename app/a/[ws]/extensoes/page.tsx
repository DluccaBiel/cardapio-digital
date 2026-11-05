import { notFound } from 'next/navigation'
import { getWorkspaceBySlug } from '../../../../lib/db/workspaces'
import { PlaceholderScreen } from '../../../../components/hub/PlaceholderScreen'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Orvia — Extensões' }

export default async function ExtensoesPage({ params }: { params: { ws: string } }) {
  const workspace = await getWorkspaceBySlug(params.ws)
  if (!workspace) notFound()

  return (
    <PlaceholderScreen
      title="Extensões"
      badge="Em construção nesta fase"
      description="Chaves de API, escopos e instalações das extensões Chrome da Orvia"
      icon="puzzle"
      workspaceName={workspace.name}
      bullets={['Chaves com escopos mínimos', 'Instalações e auditoria', 'Rotação e revogação de chaves']}
    />
  )
}
