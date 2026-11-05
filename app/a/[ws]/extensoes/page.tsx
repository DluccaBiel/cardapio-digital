import { EmptyModule } from '../_components/EmptyModule'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Orvia — Extensões' }

export default function Page() {
  return (
    <EmptyModule
      title="Extensões"
      description="Chaves de API com escopos para as extensões de navegador do Orvia."
      badge="Marco 5"
    />
  )
}
