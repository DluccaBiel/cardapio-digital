import { MOCK_WORKSPACE } from '../../../lib/mock'
import { PlaceholderScreen } from '../../../components/hub/PlaceholderScreen'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Orvia — Demonstração · Cardápio' }

export default function DemoCardapioPage() {
  return (
    <PlaceholderScreen
      title="Cardápio"
      badge="Em construção nesta fase"
      description="Catálogo de categorias, produtos e complementos, com gestão de fotos e histórico"
      icon="utensils"
      workspaceName={MOCK_WORKSPACE.name}
      bullets={['Categorias e produtos por cliente', 'Upload de fotos em massa', 'Histórico e restauração de imagens']}
    />
  )
}
