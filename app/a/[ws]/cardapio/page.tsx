import { notFound } from 'next/navigation'
import { getWorkspaceBySlug } from '../../../../lib/db/workspaces'
import { createServerClient } from '../../../../lib/supabaseServer'
import { listMenuClients, loadCatalog } from '../../../../lib/menu/load'
import { MenuScreen, type ExtensionStatus } from '../../../../components/hub/menu/MenuScreen'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Orvia — Cardápio' }

export default async function CardapioPage({
  params,
  searchParams,
}: {
  params: { ws: string }
  searchParams: { cliente?: string }
}) {
  const workspace = await getWorkspaceBySlug(params.ws)
  if (!workspace) notFound()

  const db = createServerClient() as any
  const clients = await listMenuClients(db, workspace.id)
  const selected = clients.find((c) => c.id === searchParams.cliente) ?? clients[0] ?? null
  const catalog = selected ? await loadCatalog(db, workspace.id, selected.id) : null

  // Status da extensão iFood (RLS: só owner/coordenador enxergam instalações; demais veem null)
  let extension: ExtensionStatus = null
  const { data: install } = await db
    .from('extension_installs')
    .select('status, version, last_seen_at, extensions!inner ( slug )')
    .eq('workspace_id', workspace.id)
    .eq('extensions.slug', 'orvia-ifood')
    .maybeSingle()
  if (install) extension = { status: install.status, version: install.version, last_seen_at: install.last_seen_at }

  return (
    <MenuScreen
      ws={workspace.slug}
      workspaceName={workspace.name}
      canEdit={['owner', 'coordenador', 'editor'].includes(workspace.role)}
      canManageKeys={['owner', 'coordenador'].includes(workspace.role)}
      clients={clients}
      catalog={catalog}
      extension={extension}
    />
  )
}
