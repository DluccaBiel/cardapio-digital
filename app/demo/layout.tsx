import { notFound } from 'next/navigation'
import { isDemoEnabled } from '../../lib/demo'
import { getClients, MOCK_WORKSPACE } from '../../lib/mock'
import { HubShell } from '../../components/hub/HubShell'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Undercut — Demonstração visual' }

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  if (!isDemoEnabled()) notFound()

  return (
    <HubShell
      workspace={MOCK_WORKSPACE}
      role="coordenador"
      workspaces={[{ ...MOCK_WORKSPACE, role: 'coordenador' }]}
      userInitial="D"
      basePath="/demo"
      envLabel="DEMO"
      demo
      clients={getClients()}
    >
      {children}
    </HubShell>
  )
}
