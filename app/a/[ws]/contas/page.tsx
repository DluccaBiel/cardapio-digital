import { notFound } from 'next/navigation'
import { getWorkspaceBySlug } from '../../../../lib/db/workspaces'
import { getAdAccounts } from '../../../../lib/mock'
import { AccountsScreen } from '../../../../components/hub/accounts/AccountsScreen'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Orvia — Contas de anúncio' }

export default async function ContasPage({ params }: { params: { ws: string } }) {
  const workspace = await getWorkspaceBySlug(params.ws)
  if (!workspace) notFound()

  return <AccountsScreen initialAccounts={getAdAccounts()} workspaceName={workspace.name} />
}
