import { notFound } from 'next/navigation'
import { z } from 'zod'
import { getWorkspaceBySlug } from '../../../../../lib/db/workspaces'
import { createServerClient } from '../../../../../lib/supabaseServer'
import { ClientScreen, type ClientHeader } from '../../../../../components/hub/client/ClientScreen'

export const dynamic = 'force-dynamic'
export const maxDuration = 120
export const metadata = { title: 'Undercut — Cliente' }

const n = (v: unknown) => Number(v ?? 0) || 0

/** Apresentação do cliente: métricas, campanhas (gerenciador) e criativos — dados reais da Meta. */
export default async function ClientPage({ params, searchParams }: { params: { ws: string; id: string }; searchParams: { tab?: string } }) {
  if (!z.string().uuid().safeParse(params.id).success) notFound()
  const workspace = await getWorkspaceBySlug(params.ws)
  if (!workspace) notFound()
  const db = createServerClient()

  const [{ data: client }, { data: rows }] = await Promise.all([
    db.from('clients').select('id, name, status').eq('workspace_id', workspace.id).eq('id', params.id).is('archived_at', null).maybeSingle(),
    db
      .from('ad_accounts')
      .select('external_account_id, name, status, account_type, balance, spend_month, spend_7d, revenue_month, ends_at, runs_continuously, last_change_at, last_synced_at, is_watched')
      .eq('workspace_id', workspace.id)
      .eq('client_id', params.id)
      .eq('platform', 'meta'),
  ])
  if (!client) notFound()

  const all = (rows ?? []) as any[]
  const watched = all.filter((a) => a.is_watched)
  const accounts = watched.length ? watched : all
  const balance = accounts.reduce((t, a) => t + n(a.balance), 0)
  const prepaid = accounts.filter((a) => a.account_type === 'prepaid').reduce((t, a) => t + Math.max(0, n(a.balance)), 0)
  const daily = accounts.reduce((t, a) => t + n(a.spend_7d), 0) / 7
  const ends = accounts.map((a) => a.ends_at).filter(Boolean).sort()
  const changes = accounts.map((a) => a.last_change_at ?? a.last_synced_at).filter(Boolean).sort()
  const synced = accounts.map((a) => a.last_synced_at).filter(Boolean).sort()
  const spendMonth = accounts.reduce((t, a) => t + n(a.spend_month), 0)
  const revenueMonth = accounts.reduce((t, a) => t + n(a.revenue_month), 0)

  const header: ClientHeader = {
    id: client.id,
    name: client.name,
    status: client.status,
    accounts: accounts.map((a) => ({ id: a.external_account_id, name: a.name, status: a.status })),
    balance: accounts.length ? balance : null,
    daysLeft: balance < 0 ? -1 : prepaid > 0 && daily > 0 ? prepaid / daily : null,
    endsAt: ends.length ? ends[ends.length - 1] : null,
    runsContinuously: accounts.some((a) => a.runs_continuously),
    lastChange: changes.length ? changes[changes.length - 1] : null,
    lastSynced: synced.length ? synced[synced.length - 1] : null,
    spendMonth,
    roasMonth: spendMonth > 0 ? Math.round((revenueMonth / spendMonth) * 100) / 100 : null,
  }

  return (
    <ClientScreen
      ws={params.ws}
      header={header}
      canSync={['owner', 'coordenador'].includes(workspace.role)}
      initialTab={searchParams.tab === 'campanhas' || searchParams.tab === 'criativos' ? searchParams.tab : 'metricas'}
    />
  )
}
