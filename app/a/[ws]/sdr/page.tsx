import { notFound } from 'next/navigation'
import { getWorkspaceBySlug } from '../../../../lib/db/workspaces'
import { listProspectClients } from '../../../../lib/db/prospects'
import { icpFromClient, icpFromLead } from '../../../../lib/sdr/score'
import { SdrScreen } from '../../../../components/hub/prospect/SdrScreen'
import { createServerClient } from '../../../../lib/supabaseServer'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Undercut — SDR' }

export default async function SdrPage({ params }: { params: { ws: string } }) {
  const workspace = await getWorkspaceBySlug(params.ws)
  if (!workspace) notFound()

  const db = createServerClient()
  const [{ clients, missingColumns }, { data: rawProspects }] = await Promise.all([
    listProspectClients(workspace.id),
    db
      .from('prospect_leads')
      .select('id, name, phone, category, city, uf, address, website, status, found_at')
      .eq('workspace_id', workspace.id)
      .order('found_at', { ascending: false })
      .limit(300),
  ])

  const clientLeads = clients.map((c) => {
    const icp = icpFromClient(c)
    return { ...c, icpScore: icp.score, icpEvidencias: icp.evidencias }
  })

  const prospectLeads = (rawProspects ?? []).map((l: any) => {
    const icp = icpFromLead(l)
    return {
      ...l,
      icpScore: icp.score,
      icpBand: icp.band,
      icpEvidencias: icp.evidencias,
    }
  })

  return (
    <SdrScreen
      ws={workspace.slug}
      basePath={`/a/${workspace.slug}`}
      leads={clientLeads}
      initialProspectLeads={prospectLeads}
      canManage={['owner', 'coordenador'].includes(workspace.role)}
      missingColumns={missingColumns}
    />
  )
}
