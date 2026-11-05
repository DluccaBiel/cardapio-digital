import { MOCK_WORKSPACE } from '../../../lib/mock'
import { PlaceholderScreen } from '../../../components/hub/PlaceholderScreen'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Orvia — Demonstração · Agenda' }

export default function DemoAgendaPage() {
  return (
    <PlaceholderScreen
      title="Agenda"
      badge="Em breve"
      description="Compromissos, entregas e follow-ups da assessoria em um só calendário"
      icon="calendar"
      workspaceName={MOCK_WORKSPACE.name}
      bullets={['Calendário semanal por cliente', 'Lembretes de entrega de criativo', 'Follow-up de Pix e renovação']}
    />
  )
}
