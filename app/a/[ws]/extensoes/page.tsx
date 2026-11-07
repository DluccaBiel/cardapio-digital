import { notFound } from 'next/navigation'
import { getWorkspaceBySlug } from '../../../../lib/db/workspaces'
import { createServerClient } from '../../../../lib/supabaseServer'
import { ExtensionsScreen } from '../../../../components/hub/extensions/ExtensionsScreen'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Orvia — Extensões' }

export default async function ExtensoesPage({ params, searchParams }: { params: { ws: string }; searchParams: { conectar?: string } }) {
  const workspace = await getWorkspaceBySlug(params.ws)
  if (!workspace) notFound()

  const canManage = ['owner', 'coordenador'].includes(workspace.role)
  const db = createServerClient()

  const { data: extensions } = await db.from('extensions').select('id, slug, name, description').order('name')
  // RLS: api_keys/extension_installs só aparecem para owner/coordenador
  const [{ data: keys }, { data: installs }] = canManage
    ? await Promise.all([
        db
          .from('api_keys')
          .select('id, name, key_prefix, scopes, extension_id, last_used_at, expires_at, revoked_at, created_at')
          .eq('workspace_id', workspace.id)
          .order('created_at', { ascending: false }),
        db.from('extension_installs').select('extension_id, version, status, last_seen_at, api_keys ( name )').eq('workspace_id', workspace.id),
      ])
    : [{ data: [] }, { data: [] }]

  return (
    <ExtensionsScreen
      ws={workspace.slug}
      workspaceName={workspace.name}
      canManage={canManage}
      hubUrl={process.env.NEXT_PUBLIC_APP_URL ?? ''}
      extensions={extensions ?? []}
      keys={(keys ?? []) as any}
      installs={(installs ?? []) as any}
      highlightPair={searchParams.conectar === '1'}
    />
  )
}
