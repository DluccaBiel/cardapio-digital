import { MOCK_WORKSPACE } from '../../../lib/mock'
import { PlaceholderScreen } from '../../../components/hub/PlaceholderScreen'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Undercut — Demonstração · Extensões' }

export default function DemoExtensoesPage() {
  return (
    <PlaceholderScreen
      title="Extensões"
      badge="Em construção nesta fase"
      description="Chaves de API, escopos e instalações das extensões Chrome do Undercut"
      icon="puzzle"
      workspaceName={MOCK_WORKSPACE.name}
      bullets={['Chaves com escopos mínimos', 'Instalações e auditoria', 'Rotação e revogação de chaves']}
    />
  )
}
