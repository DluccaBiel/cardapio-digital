import { EmptyModule } from '../_components/EmptyModule'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Orvia — Visão geral' }

export default function Page() {
  return (
    <EmptyModule
      title="Visão geral"
      description="Situação dos clientes, KPIs e rotina da semana."
      badge="Marco 2"
    />
  )
}
