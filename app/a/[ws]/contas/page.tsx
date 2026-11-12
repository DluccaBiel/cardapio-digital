import { notFound } from 'next/navigation'
import { getWorkspaceBySlug } from '../../../../lib/db/workspaces'
import { createServerClient } from '../../../../lib/supabaseServer'
import { metaConfig } from '../../../../lib/meta/graph'
import type { MockAdAccount } from '../../../../lib/mock'
import { AccountsScreen } from '../../../../components/hub/accounts/AccountsScreen'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Undercut — Contas de anúncio' }

const STATUS: Record<string, MockAdAccount['status']> = { active: 'Ativa', disabled: 'Desativada', error: 'Pendente', unknown: 'Pendente' }

/** Contas reais (ad_accounts, sincronizadas da Meta). RLS: membros leem; owner/coordenador escrevem. */
export default async function ContasPage({ params }: { params: { ws: string } }) {
  const workspace = await getWorkspaceBySlug(params.ws)
  if (!workspace) notFound()

  const db = createServerClient()
  const [{ data, error }, { data: clients }] = await Promise.all([
    db
      .from('ad_accounts')
      .select('id, external_account_id, name, status, account_type, balance, spend_month, timezone, is_watched, client_id, owner_business_name, last_synced_at, created_at, clients ( name )')
      .eq('workspace_id', workspace.id)
      .eq('platform', 'meta')
      .order('name'),
    db.from('clients').select('id, name').eq('workspace_id', workspace.id).is('archived_at', null).order('name'),
  ])

  const accounts: MockAdAccount[] = ((data ?? []) as any[]).map((r) => {
    const client = Array.isArray(r.clients) ? r.clients[0] : r.clients
    return {
      id: r.id,
      externalId: r.external_account_id,
      name: r.name,
      status: STATUS[r.status] ?? 'Pendente',
      type: r.account_type === 'prepaid' ? 'Pré-paga' : 'Cartão',
      balance: Number(r.balance) || 0,
      spendTotal: Number(r.spend_month) || 0,
      lastSync: r.last_synced_at ?? r.created_at,
      watched: Boolean(r.is_watched),
      clientId: r.client_id,
      clientName: client?.name ?? null,
      timezone: r.timezone ?? '—',
      starred: false,
      ownerBusinessName: r.owner_business_name ?? null,
    }
  })

  return (
    <AccountsScreen
      initialAccounts={accounts}
      workspaceName={workspace.name}
      live={{
        ws: workspace.slug,
        canManage: ['owner', 'coordenador'].includes(workspace.role),
        configured: metaConfig() !== null,
        schemaReady: !error,
        clients: (clients ?? []) as { id: string; name: string }[],
      }}
    />
  )
}
