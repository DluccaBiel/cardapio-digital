import { notFound } from 'next/navigation'
import { getWorkspaceBySlug } from '../../../../lib/db/workspaces'
import { loadClientIndex } from '../../../../lib/db/overview'
import { createServerClient } from '../../../../lib/supabaseServer'
import type { MockReportDraft } from '../../../../lib/mock'
import { ReportsScreen } from '../../../../components/hub/reports/ReportsScreen'

export const dynamic = 'force-dynamic'
export const maxDuration = 120
export const metadata = { title: 'Undercut — Relatórios' }

/** Relatórios com valores reais da Meta (consultados na hora, por cliente e período). */
export default async function RelatoriosPage({ params }: { params: { ws: string } }) {
  const workspace = await getWorkspaceBySlug(params.ws)
  if (!workspace) notFound()

  const clients = await loadClientIndex(createServerClient(), workspace.id)
  const first = clients.find((c) => c.situation === 'ativo') ?? clients[0]

  if (!first) {
    return (
      <div className="mx-auto w-full max-w-[1200px] px-4 pb-10 pt-5 sm:px-6 md:px-[30px] md:pt-[26px]">
        <h1 className="uc-title text-[32px] text-[#F7F5F1] md:text-[40px]">Gerador de Relatórios</h1>
        <p className="mt-3 text-[13px] text-[#8E8A86]">Cadastre um cliente e vincule uma conta de anúncio (Contas de anúncio) para gerar relatórios.</p>
      </div>
    )
  }

  const empty: MockReportDraft = {
    clientId: first.id,
    clientName: first.name,
    clientSituation: first.situation,
    periodLabel: '—',
    previousPeriodLabel: '—',
    compare: true,
    blocks: { general: true, byObjective: false, topCreatives: true, balance: true },
    metrics: {
      investment: 0, investmentDelta: 0, reach: 0, reachDelta: 0, purchases: 0, purchasesDelta: 0,
      costPerPurchase: 0, costPerPurchaseDelta: 0, revenue: 0, roas: 0, impressions: 0, clicks: 0,
      ctr: 0, cpm: 0, frequency: 0, balance: 0, balanceDays: 0,
    },
    creatives: [],
    whatsappText: '',
  }

  return <ReportsScreen ws={workspace.slug} initialDraft={empty} clients={clients} workspaceName={workspace.name} />
}
