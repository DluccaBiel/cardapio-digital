import { getAdAccounts, MOCK_WORKSPACE } from '../../../lib/mock'
import { AccountsScreen } from '../../../components/hub/accounts/AccountsScreen'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Undercut — Demonstração · Contas' }

export default function DemoAccountsPage() {
  return <AccountsScreen initialAccounts={getAdAccounts()} workspaceName={MOCK_WORKSPACE.name} />
}
