import Link from 'next/link'
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
    <>
      <div className="mx-auto w-full max-w-[1400px] px-4 pt-5 sm:px-6 md:px-[30px]">
        <Link
          href={`/a/${workspace.slug}/sdr/whatsapp`}
          className="flex items-center justify-between gap-3 rounded-[6px] border border-[#D7141F]/45 bg-[#1F0D0F]/70 px-4 py-3 text-[13px] text-[#FFD9DB] hover:border-[#D7141F]"
        >
          <span>
            <b className="text-white">SDR WhatsApp</b> — funil, conversas com leads, IA respondendo 24h, cadências e Google Agenda
          </span>
          <span className="font-semibold text-[#F0333D]">Abrir →</span>
        </Link>
      </div>
      <SdrScreen
      ws={workspace.slug}
      basePath={`/a/${workspace.slug}`}
      leads={clientLeads}
      initialProspectLeads={prospectLeads}
      canManage={['owner', 'coordenador'].includes(workspace.role)}
      missingColumns={missingColumns}
    />
    </>
  )
}
