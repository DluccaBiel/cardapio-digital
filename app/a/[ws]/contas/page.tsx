import { EmptyModule } from '../_components/EmptyModule'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Orvia — Contas de Anúncio' }

export default function Page() {
  return (
    <EmptyModule
      title="Contas de Anúncio"
      description="Mapeie contas da Business Manager da Meta e controle o acompanhamento da assessoria."
      badge="Marco 3"
    />
  )
}
