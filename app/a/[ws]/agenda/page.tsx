import { notFound } from 'next/navigation'
import { getWorkspaceBySlug } from '../../../../lib/db/workspaces'
import { PlaceholderScreen } from '../../../../components/hub/PlaceholderScreen'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Orvia — Agenda' }

export default async function AgendaPage({ params }: { params: { ws: string } }) {
  const workspace = await getWorkspaceBySlug(params.ws)
  if (!workspace) notFound()

  return (
    <PlaceholderScreen
      title="Agenda"
      badge="Em breve"
      description="Compromissos, entregas e follow-ups da assessoria em um só calendário"
      icon="calendar"
      workspaceName={workspace.name}
      bullets={['Calendário semanal por cliente', 'Lembretes de entrega de criativo', 'Follow-up de Pix e renovação']}
    />
  )
}
