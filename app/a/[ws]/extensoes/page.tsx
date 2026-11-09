import { notFound } from 'next/navigation'
import { getWorkspaceBySlug } from '../../../../lib/db/workspaces'
import { createServerClient } from '../../../../lib/supabaseServer'
import { createAdminClient } from '../../../../lib/supabaseAdmin'
import { ExtensionsScreen, type OptimizationReport } from '../../../../components/hub/extensions/ExtensionsScreen'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Orvia — Extensões' }

const EVIDENCE_BUCKET = 'optimization-evidence'
const SIGNED_URL_TTL = 600 // 10 min — a tela renova ao Sincronizar/recarregar

/**
 * Relatório da extensão: últimas otimizações enviadas (plano aprovado + status por
 * alteração) e os prints. Leitura com a sessão do usuário (RLS: membro do workspace);
 * o bucket é privado e sem policy, então as URLs assinadas são geradas aqui no
 * servidor — e só para caminhos do PRÓPRIO workspace.
 * Se a migration 0005 ainda não foi aplicada, devolve `unavailable` (a tela avisa).
 */
async function loadReports(db: ReturnType<typeof createServerClient>, workspaceId: string): Promise<{ reports: OptimizationReport[]; unavailable: boolean }> {
  const { data, error } = await db
    .from('menu_optimizations')
    .select('id, client_id, plan_hash, version, summary, aborted, approved, results, ok_count, error_count, created_at, clients ( name ), menu_optimization_evidence ( id, name, storage_path, bytes )')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(20)
  if (error) return { reports: [], unavailable: true }

  const rows = (data ?? []) as any[]
  const paths = rows.flatMap((r) => (r.menu_optimization_evidence ?? []).map((e: any) => e.storage_path as string)).filter((p) => p.startsWith(`${workspaceId}/`))
  const urls = new Map<string, string>()
  if (paths.length) {
    const { data: signed } = await createAdminClient().storage.from(EVIDENCE_BUCKET).createSignedUrls(paths, SIGNED_URL_TTL)
    for (const s of signed ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl)
  }

  const reports = rows.map((r): OptimizationReport => {
    const client = Array.isArray(r.clients) ? r.clients[0] : r.clients
    return {
      id: r.id,
      client_id: r.client_id,
      client_name: client?.name ?? 'Cliente removido',
      version: r.version,
      summary: r.summary ?? '',
      aborted: Boolean(r.aborted),
      ok_count: r.ok_count ?? 0,
      error_count: r.error_count ?? 0,
      created_at: r.created_at,
      approved: Array.isArray(r.approved) ? r.approved : [],
      results: Array.isArray(r.results) ? r.results : [],
      evidence: (r.menu_optimization_evidence ?? [])
        .map((e: any) => {
          const url = urls.get(e.storage_path) ?? null
          // `download=<nome>` na URL assinada faz o Storage responder com Content-Disposition: attachment
          const name = String(e.name)
          return { id: e.id as string, name, url, download_url: url ? `${url}${url.includes('?') ? '&' : '?'}download=${encodeURIComponent(name)}` : null }
        })
        .sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true })),
    }
  })
  return { reports, unavailable: false }
}

export default async function ExtensoesPage({ params, searchParams }: { params: { ws: string }; searchParams: { conectar?: string } }) {
  const workspace = await getWorkspaceBySlug(params.ws)
  if (!workspace) notFound()

  const canManage = ['owner', 'coordenador'].includes(workspace.role)
  const db = createServerClient()

  const { data: extensions } = await db.from('extensions').select('id, slug, name, description').order('name')
  // RLS: api_keys/extension_installs só aparecem para owner/coordenador
  const [{ data: keys }, { data: installs }, report] = await Promise.all([
    canManage
      ? db
          .from('api_keys')
          .select('id, name, key_prefix, scopes, extension_id, last_used_at, expires_at, revoked_at, created_at')
          .eq('workspace_id', workspace.id)
          .order('created_at', { ascending: false })
      : Promise.resolve({ data: [] }),
    canManage
      ? db.from('extension_installs').select('extension_id, version, status, last_seen_at, api_keys ( name, revoked_at, expires_at )').eq('workspace_id', workspace.id)
      : Promise.resolve({ data: [] }),
    loadReports(db, workspace.id),
  ])

  return (
    <ExtensionsScreen
      ws={workspace.slug}
      workspaceName={workspace.name}
      canManage={canManage}
      canDelete={workspace.role === 'owner'}
      hubUrl={process.env.NEXT_PUBLIC_APP_URL ?? ''}
      extensions={extensions ?? []}
      keys={(keys ?? []) as any}
      installs={(installs ?? []) as any}
      reports={report.reports}
      reportsUnavailable={report.unavailable}
      highlightPair={searchParams.conectar === '1'}
    />
  )
}
