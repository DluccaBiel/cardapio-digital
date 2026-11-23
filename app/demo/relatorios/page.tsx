import { getClients, getReportDraft, MOCK_WORKSPACE } from '../../../lib/mock'
import { ReportsDemoScreen } from '../../../components/hub/reports/ReportsDemoScreen'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Undercut — Demonstração · Relatórios' }

export default function DemoReportsPage() {
  return <ReportsDemoScreen initialDraft={getReportDraft()} clients={getClients()} workspaceName={MOCK_WORKSPACE.name} />
}
