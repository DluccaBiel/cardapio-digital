import { getClients, getReportDraft, MOCK_WORKSPACE } from '../../../lib/mock'
import { ReportsScreen } from '../../../components/hub/reports/ReportsScreen'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Undercut — Demonstração · Relatórios' }

export default function DemoReportsPage() {
  return <ReportsScreen initialDraft={getReportDraft()} clients={getClients()} workspaceName={MOCK_WORKSPACE.name} />
}
