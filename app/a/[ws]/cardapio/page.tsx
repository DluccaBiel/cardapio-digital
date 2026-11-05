import { notFound } from 'next/navigation'
import { getWorkspaceBySlug } from '../../../../lib/db/workspaces'
import { PlaceholderScreen } from '../../../../components/hub/PlaceholderScreen'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Orvia — Cardápio' }

export default async function CardapioPage({ params }: { params: { ws: string } }) {
  const workspace = await getWorkspaceBySlug(params.ws)
  if (!workspace) notFound()

  return (
    <PlaceholderScreen
      title="Cardápio"
      badge="Em construção nesta fase"
      description="Catálogo de categorias, produtos e complementos, com gestão de fotos e histórico"
      icon="utensils"
      workspaceName={workspace.name}
      bullets={['Categorias e produtos por cliente', 'Upload de fotos em massa', 'Histórico e restauração de imagens']}
    />
  )
}
