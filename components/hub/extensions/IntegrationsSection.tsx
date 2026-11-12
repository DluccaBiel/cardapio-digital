'use client'

import { useState } from 'react'
import { Check, Copy, ExternalLink, Loader2, Network, ShieldCheck } from 'lucide-react'
import { PARTNERS, type PartnerBrand } from '@/lib/extensions/partners'

type IntegrationStatus = { slug: string; id: string; connected: boolean }

/**
 * Seção "Integrações": visualização das conexões entre sistemas de gestão parceiros
 * e as extensões Undercut — nesse caso, o FlyTo, com a paleta própria da marca.
 *
 * Cada parceiro ganha bloco próprio (identidade visual dele), separado das extensões
 * Undercut (vermelho), e um link de integração para o sistema parceiro compartilhar o
 * hub/SDK com a operação.
 */
export function IntegrationsSection({
  partners,
  integrations,
  canManage,
  onToast,
}: {
  partners: PartnerBrand[]
  integrations: IntegrationStatus[]
  canManage: boolean
  onToast: (message: string) => void
}) {
  const [copied, setCopied] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const copy = async (slug: string, value: string) => {
    setBusy(slug)
    try {
      await navigator.clipboard.writeText(value)
      setCopied(slug)
      onToast('Link de integração copiado.')
      setTimeout(() => setCopied((c) => (c === slug ? null : c)), 2000)
    } catch {
      onToast('Área de transferência bloqueada — copie manualmente.')
    }
    setBusy(null)
  }

  const integrationLink = (slug: string) => partners.find((p) => p.slug === slug)?.integrationUrl ?? null

  const open = (slug: string) => {
    const url = integrationLink(slug)
    if (url) window.open(url, '_blank', 'noopener,noreferrer')
  }

  return (
    <section id="sec-integracoes" aria-labelledby="ext-int-title" className="mt-6 scroll-mt-24 overflow-hidden rounded-3xl border border-white/[0.08] bg-[#0C0C0E] p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="ext-int-title" className="flex items-center gap-2 text-[16px] font-bold text-[#F7F5F1]">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-[#5FA759]/30 bg-[#5FA759]/10 text-[#83C365]">
              <Network size={16} />
            </span>
            Integrações
          </h2>
          <p className="mt-1 text-[12px] text-[#85817C]">Conexão entre sistemas de gestão parceiros e as extensões do Undercut — cada parceiro com a identidade da própria marca.</p>
        </div>
        <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.14em] text-[#8E8A86]">{partners.length} parceiro{partners.length === 1 ? '' : 's'}</span>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {partners.map((partner) => {
          const status = integrations.filter((i) => i.slug === partner.slug)
          const connectedCount = status.filter((i) => i.connected).length
          const total = status.length
          const primary = partner.primary
          const primaryLight = partner.primaryLight
          const deep = partner.deep
          const ink = partner.ink
          const link = integrationLink(partner.slug)
          const copiedThis = copied === partner.slug
          return (
            <article
              key={partner.slug}
              className="relative overflow-hidden rounded-2xl border bg-gradient-to-b from-white/[0.045] to-white/[0.01] p-4 transition-colors hover:border-white/20"
              style={{ borderColor: `${primary}33`, backgroundImage: `linear-gradient(180deg, ${primary}0d, rgba(255,255,255,0.012))` }}
            >
              <div className="pointer-events-none absolute -right-12 -top-12 h-28 w-28 rounded-full blur-2xl" style={{ backgroundColor: `${primary}1a` }} aria-hidden="true" />
              <div className="flex items-start justify-between gap-2">
                <span
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl font-mono text-[13px] font-bold"
                  style={{ backgroundColor: `${primary}14`, border: `1px solid ${primary}44`, color: primaryLight }}
                >
                  {partner.monogram}
                </span>
                <span
                  className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.14em]"
                  style={{ borderColor: `${primary}55`, backgroundColor: `${primary}12`, color: primaryLight }}
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: primary, boxShadow: `0 0 8px ${primary}` }} />
                  parceiro
                </span>
              </div>

              <h3 className="mt-3 text-[14px] font-bold text-[#F7F5F1]">{partner.name}</h3>
              <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.16em]" style={{ color: primaryLight }}>
                {partner.tagline}
              </p>
              <p className="mt-2 min-h-[48px] text-[12px] leading-relaxed text-[#9F9A94]">{partnerIntegrationBlurb(partner.slug)}</p>

              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <span className="rounded-full px-2 py-0.5 font-mono text-[10px]" style={{ backgroundColor: `${primary}14`, color: primaryLight, border: `1px solid ${primary}33` }}>
                  {primary}
                </span>
                <span className="rounded-full px-2 py-0.5 font-mono text-[10px]" style={{ backgroundColor: `${primaryLight}14`, color: primaryLight, border: `1px solid ${primaryLight}33` }}>
                  {primaryLight}
                </span>
                <span className="rounded-full px-2 py-0.5 font-mono text-[10px] text-[#B8B3AC]" style={{ backgroundColor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }}>
                  {deep}
                </span>
                <span className="rounded-full px-2 py-0.5 font-mono text-[10px] text-[#8E8A86]" style={{ backgroundColor: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)' }}>
                  {ink}
                </span>
              </div>

              <div className="mt-3 flex items-center justify-between gap-2 rounded-xl border border-white/[0.07] bg-black/25 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-[#85817C]">Extensões do parceiro</p>
                  <p className="mt-0.5 text-[12px] font-semibold text-[#ECE9E3]">
                    {connectedCount}/{total} conectadas
                  </p>
                </div>
                <span
                  className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.12em]"
                  style={{ borderColor: `${primary}55`, backgroundColor: `${primary}10`, color: primaryLight }}
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: connectedCount === total && total > 0 ? primary : 'rgba(255,255,255,0.2)' }} />
                  {connectedCount === total && total > 0 ? 'integrado' : 'offline'}
                </span>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {link ? (
                  <>
                    <a
                      href={link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-8 items-center gap-1.5 rounded-xl px-3 text-[12px] font-semibold text-white transition-opacity hover:opacity-90"
                      style={{ backgroundColor: primary }}
                    >
                      <ExternalLink size={14} /> Abrir link de integração
                    </a>
                    <button
                      type="button"
                      onClick={() => void copy(partner.slug, link)}
                      disabled={busy === partner.slug}
                      className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] px-3 text-[12px] font-semibold text-[#DAD6CF] transition-colors hover:border-white/20 hover:text-white disabled:opacity-60"
                    >
                      {busy === partner.slug ? <Loader2 size={14} className="animate-spin" /> : copiedThis ? <Check size={14} /> : <Copy size={14} />}
                      {copiedThis ? 'Copiado' : 'Copiar link'}
                    </button>
                  </>
                ) : (
                  <span className="inline-flex h-8 items-center rounded-xl border border-white/10 bg-white/[0.02] px-3 text-[12px] font-semibold text-[#55555C]">link de integração em breve</span>
                )}
              </div>
            </article>
          )
        })}
      </div>

      {canManage && (
        <p className="mt-3 flex items-center gap-1.5 text-[11px] text-[#85817C]">
          <ShieldCheck size={12} /> Só quem gerencia o workspace cria ou revoga as chaves usadas por estas integrações.
        </p>
      )}
    </section>
  )
}

function partnerIntegrationBlurb(slug: string): string {
  switch (slug) {
    case 'flyto':
      return 'O sistema FlyTo compartilha o cardápio e as telas de decisão com o Undercut para leitura, análise e aplicação de combos aprovados.'
    default:
      return 'Integração do parceiro com o hub de extensões e a API do Undercut.'
  }
}
