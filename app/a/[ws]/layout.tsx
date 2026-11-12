import { notFound, redirect } from 'next/navigation'
import { getUserWorkspaces, getWorkspaceBySlug } from '../../../lib/db/workspaces'
import { createServerClient } from '../../../lib/supabaseServer'
import { appEnvLabel } from '../../../lib/demo'
import { getClients } from '../../../lib/mock'
import { HubShell } from '../../../components/hub/HubShell'

const ONLINE_MS = 10 * 60_000

/**
 * "Ao vivo" do header só aparece quando TODAS as extensões cadastradas estão
 * enviando contato agora (chave ativa + último contato < 10 min). A tela de
 * extensões recalcula ao vivo quando o usuário clica em "Sincronizar"; aqui o
 * estado é o da última carga do servidor.
 */
async function allExtensionsLive(workspaceId: string, role: string): Promise<boolean> {
  if (!['owner', 'coordenador'].includes(role)) return false
  const db = createServerClient()
  const [{ data: extensions }, { data: installs }] = await Promise.all([
    db.from('extensions').select('id'),
    db
      .from('extension_installs')
      .select('extension_id, last_seen_at, api_keys ( revoked_at, expires_at )')
      .eq('workspace_id', workspaceId),
  ])
  if (!extensions?.length || !installs?.length) return false
  const now = Date.now()
  const byExtension = new Map(installs.map((i) => [i.extension_id, i]))
  return extensions.every((ext) => {
    const install = byExtension.get(ext.id) as
      | { last_seen_at: string | null; api_keys?: { revoked_at: string | null; expires_at: string | null } | { revoked_at: string | null; expires_at: string | null }[] | null }
      | undefined
    if (!install?.last_seen_at) return false
    const key = Array.isArray(install.api_keys) ? install.api_keys[0] : install.api_keys
    if (!key || key.revoked_at) return false
    if (key.expires_at && new Date(key.expires_at).getTime() < now) return false
    return now - new Date(install.last_seen_at).getTime() < ONLINE_MS
  })
}

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: { ws: string }
}) {
  const { ws } = params

  const supabase = createServerClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) redirect('/login')

  const current = await getWorkspaceBySlug(ws)
  if (!current) notFound()

  const [workspaces, live] = await Promise.all([getUserWorkspaces(), allExtensionsLive(current.id, current.role)])
  const initial = (userData.user.email ?? '?').charAt(0).toUpperCase()

  return (
    <HubShell
      workspace={{ name: current.name, slug: current.slug }}
      role={current.role}
      workspaces={workspaces.map((workspace) => ({ name: workspace.name, slug: workspace.slug, role: workspace.role }))}
      userInitial={initial}
      basePath={`/a/${current.slug}`}
      envLabel={appEnvLabel()}
      live={live}
      clients={getClients()}
    >
      {children}
    </HubShell>
  )
}
