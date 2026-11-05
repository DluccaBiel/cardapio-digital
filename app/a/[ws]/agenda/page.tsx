import { EmptyModule } from '../_components/EmptyModule'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Orvia — Agenda' }

export default function Page() {
  return (
    <EmptyModule
      title="Agenda"
      description="Entregas e rotina da semana da assessoria."
      badge="Em breve"
    />
  )
}
