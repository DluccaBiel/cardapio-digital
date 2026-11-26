import { notFound, redirect } from 'next/navigation'
import { getWorkspaceBySlug } from '../../../../lib/db/workspaces'
import { createServerClient } from '../../../../lib/supabaseServer'
import { createAdminClient } from '../../../../lib/supabaseAdmin'
import { shortUrlFor } from '../../../../lib/shortlink'
import { SettingsScreen, type SettingsClient, type SettingsInvite, type SettingsMember } from '../../../../components/hub/settings/SettingsScreen'
import { inviteState } from '../../../../lib/invites'
import { metaAppConfig } from '../../../../lib/meta/api'
import { tokenCryptoReady } from '../../../../lib/meta/crypto'

export const dynamic = 'force-dynamic'
export const maxDuration = 300
export const metadata = { title: 'Undercut — Configurações' }

/**
 * ADM do workspace (owner/suporte=coordenador).
 *
 * Aqui vive a visão de gestão: quais clientes existem, quais extensões estão
 * conectadas, quem tem acesso e o checklist de segurança. O e-mail dos membros
 * vem do Supabase Auth (service role) — nunca do navegador — e é mascarado
 * quando o papel não permite administrar a equipe.
 */
export default async function ConfiguracoesPage({ params, searchParams }: { params: { ws: string }; searchParams: { tab?: string; meta?: string } }) {
  const workspace = await getWorkspaceBySlug(params.ws)
  if (!workspace) notFound()

  const isOwner = workspace.role === 'owner'
  const isSupport = workspace.role === 'coordenador'
  if (!isOwner && !isSupport) redirect(`/a/${params.ws}/extensoes`)

  const db = createServerClient()
  const clientColumns = 'id, name, status, email, monthly_fee, created_at, ifood_merchant_id, cardapioweb_store_id, anotaai_store_id'
  const [{ data: memberRows }, clientResult, { data: extensions }, { data: installs }, { data: keys }] = await Promise.all([
    db.from('members').select('id, user_id, role, created_at').eq('workspace_id', workspace.id).order('created_at'),
    db
      .from('clients')
      .select(clientColumns)
      .eq('workspace_id', workspace.id)
      .is('archived_at', null)
      .order('name'),
    db.from('extensions').select('id, slug, name, description, homepage_url').order('name'),
    db.from('extension_installs').select('extension_id, version, status, last_seen_at, api_keys ( revoked_at, expires_at )').eq('workspace_id', workspace.id),
    db.from('api_keys').select('id, revoked_at, expires_at').eq('workspace_id', workspace.id),
  ])

  // Banco sem 0006/0008 (colunas de canal): cai para as colunas básicas.
  let clients = clientResult.data
  if (clientResult.error) {
    const fallback = await db
      .from('clients')
      .select('id, name, status, email, monthly_fee, created_at')
      .eq('workspace_id', workspace.id)
      .is('archived_at', null)
      .order('name')
    clients = fallback.data as typeof clients
  }

  // E-mails da equipe: só o owner precisa do detalhe; o suporte vê os papéis.
  const emails = new Map<string, string | null>()
  const lastSignIn = new Map<string, string | null>()
  if (isOwner) {
    try {
      const admin = createAdminClient()
      const { data: listed } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
      for (const user of listed?.users ?? []) {
        emails.set(user.id, user.email ?? null)
        lastSignIn.set(user.id, user.last_sign_in_at ?? null)
      }
    } catch {
      // Sem service role configurado a tela continua (mostra o id curto).
    }
  }

  const members: SettingsMember[] = (memberRows ?? []).map((m) => ({
    id: m.id,
    user_id: m.user_id,
    role: m.role,
    created_at: m.created_at,
    email: emails.get(m.user_id) ?? null,
    last_sign_in_at: lastSignIn.get(m.user_id) ?? null,
  }))

  // Links de acesso do colaborador (só o owner vê; o valor do link nunca é guardado, só o hash).
  let invites: SettingsInvite[] = []
  if (isOwner) {
    const { data: inviteRows } = await db
      .from('member_invites')
      .select('id, label, created_at, expires_at, used_at, revoked_at, used_by')
      .eq('workspace_id', workspace.id)
      .order('created_at', { ascending: false })
      .limit(30)
    invites = (inviteRows ?? []).map((i) => ({
      id: i.id,
      label: i.label ?? '',
      created_at: i.created_at,
      expires_at: i.expires_at,
      state: inviteState(i),
      used_email: i.used_by ? (emails.get(i.used_by) ?? null) : null,
    }))
  }

  const now = Date.now()
  const activeKeys = (keys ?? []).filter(
    (k) => !k.revoked_at && !(k.expires_at && new Date(k.expires_at).getTime() < now),
  ).length

  // Integrações (Meta): conexões sem token + portfólios. Sem a migration, a aba avisa.
  const [connResult, { data: businessRows }] = await Promise.all([
    db.from('meta_connections').select('id, fb_user_name, status, token_expires_at, scopes, created_at').eq('workspace_id', workspace.id).order('created_at'),
    db
      .from('meta_businesses')
      .select('id, connection_id, business_id, name, enabled, last_synced_at, accounts_count, sync_error')
      .eq('workspace_id', workspace.id)
      .order('name'),
  ])

  return (
    <SettingsScreen
      initialTab={typeof searchParams.tab === 'string' ? searchParams.tab : undefined}
      integrations={{
        appConfigured: metaAppConfig() !== null && tokenCryptoReady(),
        schemaReady: !connResult.error,
        connections: (connResult.data ?? []) as never,
        businesses: (businessRows ?? []) as never,
        status: typeof searchParams.meta === 'string' ? searchParams.meta.slice(0, 40) : null,
      }}
      ws={workspace.slug}
      workspaceName={workspace.name}
      workspaceSlug={workspace.slug}
      plan={workspace.plan}
      role={workspace.role}
      canManage={isOwner || isSupport}
      shortUrl={shortUrlFor(workspace.slug)}
      members={members}
      invites={invites}
      clients={(clients ?? []) as SettingsClient[]}
      extensions={((extensions ?? []) as { id: string; slug: string; name: string; description: string | null; homepage_url: string | null }[]).map((e) => ({
        id: e.id,
        slug: e.slug,
        name: e.name,
        description: e.description,
        homepage_url: e.homepage_url,
      }))}
      installs={(installs ?? []) as never}
      activeKeys={activeKeys}
    />
  )
}
