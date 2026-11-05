import { EmptyModule } from '../_components/EmptyModule'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Orvia — Cardápio' }

export default function Page() {
  return (
    <EmptyModule
      title="Cardápio"
      description="Catálogo de categorias, produtos e complementos, com gestão de fotos e histórico."
      badge="Marco 4"
    />
  )
}
