import { notFound } from 'next/navigation'
import { getWhatsappSession } from '../../../../lib/db/disparos'
import { getWorkspaceBySlug } from '../../../../lib/db/workspaces'
import { loadReportsData } from '../../../../lib/reports/views'
import { createServerClient } from '../../../../lib/supabaseServer'
import { ReportsScreen } from '../../../../components/hub/reports/ReportsScreen'

export const dynamic = 'force-dynamic'
export const maxDuration = 120
export const metadata = { title: 'Undercut — Relatórios' }

/** Relatórios reais da Meta por objetivo, enviados nos grupos do WhatsApp de cada cliente. */
export default async function RelatoriosPage({ params }: { params: { ws: string } }) {
  const workspace = await getWorkspaceBySlug(params.ws)
  if (!workspace) notFound()
  const [data, session] = await Promise.all([loadReportsData(createServerClient(), workspace.id), getWhatsappSession(workspace.id)])
  return (
    <ReportsScreen
      ws={workspace.slug}
      workspaceName={workspace.name}
      canWrite={['owner', 'coordenador', 'editor'].includes(workspace.role)}
      canManageWhatsapp={['owner', 'coordenador'].includes(workspace.role)}
      initialSession={session}
      data={data}
    />
  )
}
