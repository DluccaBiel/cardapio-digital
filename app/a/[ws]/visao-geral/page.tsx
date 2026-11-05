import { getWorkspaceBySlug } from '../../../lib/db/workspaces'
import { listClientsWithMeta, listTags } from '../../../lib/db/clients'
import { ClientsView } from './ClientsView'
import { KpiCards } from './KpiCards'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Orvia — Visão geral' }

export default async function VisaoGeralPage({ params, searchParams }: { params: { ws: string }; searchParams: Record<string, string | string[] | undefined> }) {
  const ws = await getWorkspaceBySlug(params.ws)
  if (!ws) notFound()

  const [clients, tags] = await Promise.all([listClientsWithMeta(ws.id), listTags(ws.id)])

  const ativos = clients.filter((c) => c.situation === 'ativo').length
  const gastoMes = clients.flatMap((c) => c.ad_accounts).filter((a) => a.is_watched).reduce((s, a) => s + Number(a.spend_month), 0)

  const month = typeof searchParams.month === 'string' ? searchParams.month : new Date().toISOString().slice(0, 7) + '-01'

  return (
    <div className="mx-auto max-w-[1720px] px-4 py-5 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-[#E6ECFA]">Visão geral</h1>
          <p className="mt-0.5 text-xs text-[#8FA0C4]">Situação dos clientes de <span className="font-semibold text-[#E6ECFA]">{ws.name}</span>.</p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        <KpiCards variant="clientes" value={String(ativos)} sub={`${clients.length} no total cadastrado`} />
        <KpiCards variant="gasto" month={month} value={gastoMes} sub="Soma de contas monitoradas" />
      </div>

      <ClientsView clients={clients} tags={tags} wsId={ws.id} slug={ws.slug} month={month} />
    </div>
  )
}
