import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, AtSign, Globe, Mail, MessageCircle } from 'lucide-react'
import { getWorkspaceBySlug } from '../../../../../../lib/db/workspaces'
import { listProspectClients } from '../../../../../../lib/db/prospects'
import { icpFromClient } from '../../../../../../lib/sdr/score'
import { formatBRL, instagramUrl, NICHE_LABEL, STATUS_LABEL, waNumber, websiteUrl } from '../../../../../../components/hub/prospect/format'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Undercut — Lead' }

const BANT = [
  { key: 'Need', text: '3 = dor clara e específica, com impacto · 0 = "está tudo ótimo"' },
  { key: 'Authority', text: '3 = dono/sócio decisor · 0 = funcionário sem influência' },
  { key: 'Timing', text: '3 = em até 30 dias · 0 = sem previsão / mais de 6 meses' },
  { key: 'Budget', text: '3 = já investe e aceita investir · 0 = zero e sem intenção' },
]

export default async function LeadPage({ params }: { params: { ws: string; id: string } }) {
  const workspace = await getWorkspaceBySlug(params.ws)
  if (!workspace) notFound()

  const { clients } = await listProspectClients(workspace.id)
  const lead = clients.find((c) => c.id === params.id)
  if (!lead) notFound()

  const icp = icpFromClient(lead)
  const wa = waNumber(lead.whatsapp || lead.phone)
  const site = lead.website ? websiteUrl(lead.website) : null
  const base = `/a/${workspace.slug}`

  const card = 'rounded-[6px] border border-[#222225] bg-[#111113] p-5'
  const label = 'font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-[#8E8A86]'

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 pb-10 pt-5 sm:px-6 md:px-[30px] md:pt-[26px]">
      <Link href={`${base}/sdr`} className="inline-flex items-center gap-1 text-[12px] text-[#8E8A86] hover:text-white">
        <ArrowLeft size={13} /> Voltar para SDR
      </Link>
      <h1 className="uc-title mt-2 text-[32px] text-[#F7F5F1] md:text-[40px]">{lead.name}</h1>
      <p className="mt-1 text-[13px] text-[#8E8A86]">
        {lead.niche ? NICHE_LABEL[lead.niche] : 'Nicho não definido'} · {STATUS_LABEL[lead.status]} · honorário {formatBRL(lead.monthly_fee)}
      </p>

      <div className="mt-6 grid gap-4 md:grid-cols-[1fr_1fr]">
        <section className={card}>
          <p className={label}>ICP score</p>
          <p className="uc-title mt-1 text-[44px] text-[#F7F5F1]">
            {Math.round(icp.score)}
            <span className="ml-1 text-[18px] text-[#85817C]">/100</span>
          </p>
          <p className={icp.score >= 60 ? 'text-[12px] font-semibold text-[#4ADE80]' : 'text-[12px] font-semibold text-[#F0333D]'}>{icp.band}</p>
          <ul className="mt-3 space-y-1 text-[12px] text-[#CFCBC4]">
            {icp.evidencias.map((e) => (
              <li key={e}>· {e}</li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] text-[#85817C]">Faturamento, CNAE e sinais de dor entram no score quando o enriquecimento (Receita/Places) estiver ligado.</p>
        </section>

        <section className={card}>
          <p className={label}>Contato</p>
          <div className="mt-3 flex flex-col gap-2 text-[13px]">
            {wa ? (
              <a href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-[#4ADE80] hover:text-white">
                <MessageCircle size={14} /> {lead.whatsapp || lead.phone}
              </a>
            ) : (
              <span className="text-[#85817C]">Sem telefone válido</span>
            )}
            {lead.email && (
              <a href={`mailto:${lead.email}`} className="inline-flex items-center gap-2 text-[#CFCBC4] hover:text-white">
                <Mail size={14} /> {lead.email}
              </a>
            )}
            {lead.instagram && (
              <a href={instagramUrl(lead.instagram)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-[#CFCBC4] hover:text-white">
                <AtSign size={14} /> {lead.instagram.replace(/^@/, '')}
              </a>
            )}
            {site && (
              <a href={site} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-[#CFCBC4] hover:text-white">
                <Globe size={14} /> {lead.website}
              </a>
            )}
          </div>
          <Link href={`${base}/clientes-prospecao`} className="mt-4 inline-block text-[12px] text-[#F0333D] hover:underline">
            Pesquisar com IA na Prospecção →
          </Link>
        </section>

        <section className={`${card} md:col-span-2`}>
          <p className={label}>Qualificação BANT (rubrica)</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {BANT.map((b) => (
              <div key={b.key} className="rounded-[5px] border border-[#1C1C1F] bg-[#0E0E10] p-3">
                <p className="text-[13px] font-semibold text-[#ECE9E3]">{b.key}</p>
                <p className="mt-0.5 text-[11px] text-[#8E8A86]">{b.text}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-[#85817C]">Critério: BANT ≥ 7/12 com Authority ≥ 2 → oferecer 2 horários e agendar.</p>
        </section>
      </div>
    </div>
  )
}
