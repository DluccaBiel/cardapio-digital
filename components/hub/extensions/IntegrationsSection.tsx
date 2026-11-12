'use client'

import { useState } from 'react'
import { Check, Copy, ExternalLink, KeyRound, Loader2, Network, Plus, ShieldCheck } from 'lucide-react'
import { brand } from '@undercut/brand'
import { saveExtensionAction, pairExtensionAction } from '@/app/a/[ws]/extensoes/actions'
import { PARTNERS, UNDERCUT_PARTNER, partnerOf, type PartnerBrand } from '@/lib/extensions/partners'

type IntegrationStatus = { slug: string; id: string; connected: boolean }

type Tab = { slug: string; label: string }

/**
 * Seção "Integrações": visualização das conexões entre sistemas de gestão parceiros
 * e as extensões do Undercut — nesse caso, o FlyTo, com a paleta própria da marca.
 *
 * Renderiza as marcas como abas no mesmo menu (Undercut vermelho ⇄ parceiro verde),
 * onde é possível gerar chave de conexão e adicionar extensões do parceiro.
 */
export function IntegrationsSection({
  ws,
  partners,
  integrations,
  canManage,
  onToast,
}: {
  ws: string
  partners: PartnerBrand[]
  integrations: IntegrationStatus[]
  canManage: boolean
  onToast: (message: string) => void
}) {
  const [tab, setTab] = useState<string>(UNDERCUT_PARTNER.slug)
  const [adding, setAdding] = useState(false)
  const [pairing, setPairing] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const tabs: Tab[] = [
    { slug: UNDERCUT_PARTNER.slug, label: UNDERCUT_PARTNER.name },
    ...partners.map((p) => ({ slug: p.slug, label: p.short })),
  ]
  const active = tabs.find((t) => t.slug === tab) ?? tabs[0]!
  const partner: PartnerBrand = tab === UNDERCUT_PARTNER.slug ? UNDERCUT_PARTNER : (partners.find((p) => p.slug === tab) ?? partners[0]!)
  const accent = partner
  const isPartner = partner.slug !== UNDERCUT_PARTNER.slug

  const status = integrations.filter((i) => partnerOf(i.slug)?.slug === partner.slug).map((i) => ({ ...i, connected: i.connected }))
  const connectedCount = status.filter((i) => i.connected).length
  const total = status.length
  const link = partner.integrationUrl ?? (isPartner ? null : brand.baseUrl)
  const partnerSlugFor = (extSlug: string) => partnerOf(extSlug)?.slug ?? UNDERCUT_PARTNER.slug
  const flytoLogo = '/logos/flyto.png'

  const copy = async (value: string) => {
    setBusy('copy')
    try {
      await navigator.clipboard.writeText(value)
      setCopied('copy')
      onToast('Link de integração copiado.')
      setTimeout(() => setCopied((c) => (c === 'copy' ? null : c)), 2000)
    } catch {
      onToast('Área de transferência bloqueada — copie manualmente.')
    }
    setBusy(null)
  }

  const addPartnerExtension = async () => {
    setAdding(true)
    const res = await saveExtensionAction(ws, {
      id: null,
      slug: `orvia-${partner.slug}`,
      name: `${partner.name} · Extensão`,
      description: `Integração do sistema ${partner.name} com o Undercut: leitura, análise e aplicação de decisões aprovadas.`,
      homepage_url: '',
    })
    setAdding(false)
    if (res.ok) onToast(`${partner.name} adicionada ao catálogo de extensões.`)
    else onToast(res.error)
  }

  const generateConnectionKey = async () => {
    setPairing(true)
    const res = await pairExtensionAction(ws, `orvia-${partner.slug}`)
    setPairing(false)
    if (res.ok) onToast(`Código de conexão ${partner.name} gerado — veja em Chaves de API.`)
    else onToast(res.error)
  }

  return (
    <section id="sec-integracoes" aria-labelledby="ext-int-title" className="mt-6 scroll-mt-24 overflow-hidden rounded-3xl border border-white/[0.08] bg-[#0C0C0E] p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="ext-int-title" className="flex items-center gap-2 text-[16px] font-bold text-[#F7F5F1]">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-[#8E8A86]">
              <Network size={16} />
            </span>
            Integrações
          </h2>
          <p className="mt-1 text-[12px] text-[#85817C]">Conexão entre sistemas de gestão parceiros e as extensões do Undercut — cada marca com a identidade da própria.</p>
        </div>
        <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.14em] text-[#8E8A86]">{tabs.length} abas</span>
      </div>

      <div role="tablist" aria-label="Integrações" className="mt-4 flex flex-wrap gap-1.5">
        {tabs.map((t) => {
          const activeTab = t.slug === tab
          const tAccent = t.slug === UNDERCUT_PARTNER.slug ? { primary: '#D7141F', primaryLight: '#F0333D', deep: '#7A0E13', ink: '#0B0B0C', name: UNDERCUT_PARTNER.name } : partnerOf(t.slug) ?? partner
          return (
            <button
              key={t.slug}
              type="button"
              role="tab"
              id={`ext-int-tab-${t.slug}`}
              aria-selected={activeTab}
              aria-controls="ext-int-panel"
              onClick={() => setTab(t.slug)}
              className="inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-[12px] font-semibold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D7141F]"
              style={activeTab ? { borderColor: `${tAccent.primary}60`, backgroundColor: `${tAccent.primary}18`, color: '#F7F5F1' } : { borderColor: 'rgba(255,255,255,0.08)', backgroundColor: 'rgba(255,255,255,0.02)', color: '#9F9A94' }}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: tAccent.primary, boxShadow: `0 0 8px ${tAccent.primary}` }} />
              {t.label}
            </button>
          )
        })}
      </div>

      <div role="tabpanel" id="ext-int-panel" aria-labelledby={`ext-int-tab-${tab}`} className="uc-fade-up mt-4">
        <div
          className="relative overflow-hidden rounded-2xl border bg-gradient-to-b from-white/[0.045] to-white/[0.01] p-4"
          style={{ borderColor: `${accent.primary}33`, backgroundImage: `linear-gradient(180deg, ${accent.primary}0d, rgba(255,255,255,0.012))` }}
        >
          <div className="pointer-events-none absolute -right-12 -top-12 h-28 w-28 rounded-full blur-2xl" style={{ backgroundColor: `${accent.primary}1a` }} aria-hidden="true" />
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              {isPartner ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={flytoLogo} alt={`Logo ${accent.name}`} width={44} height={44} className="h-11 w-11 rounded-2xl object-contain" />
              ) : (
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl font-mono text-[13px] font-bold" style={{ backgroundColor: `${accent.primary}14`, border: `1px solid ${accent.primary}44`, color: accent.primaryLight }}>
                  {accent.monogram}
                </span>
              )}
              <div>
                <h3 className="flex items-center gap-2 text-[14px] font-bold text-[#F7F5F1]">
                  {accent.name}
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.14em]"
                    style={{ borderColor: `${accent.primary}55`, backgroundColor: `${accent.primary}12`, color: accent.primaryLight }}
                  >
                    <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: accent.primary, boxShadow: `0 0 8px ${accent.primary}` }} />
                    {isPartner ? 'parceiro' : 'hub'}
                  </span>
                </h3>
                <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.16em]" style={{ color: accent.primaryLight }}>
                  {accent.tagline}
                </p>
                <p className="mt-2 max-w-xl text-[12px] leading-relaxed text-[#9F9A94]">{isPartner ? `Integração do sistema ${accent.name} com o Undercut: leitura, análise e aplicação de combos aprovados.` : 'Hub de extensões Undercut com as extensões cadastradas no workspace.'}</p>
              </div>
            </div>
            <span
              className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.12em]"
              style={{ borderColor: `${accent.primary}55`, backgroundColor: `${accent.primary}10`, color: accent.primaryLight }}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: connectedCount === total && total > 0 ? accent.primary : 'rgba(255,255,255,0.2)' }} />
              {connectedCount === total && total > 0 ? 'integrado' : 'offline'}
            </span>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {[
              { c: accent.primary, l: accent.primaryLight },
              { c: accent.primaryLight, l: accent.primaryLight },
              { c: accent.deep, l: '#B8B3AC' },
              { c: accent.ink, l: '#8E8A86' },
            ].map((chip, idx) => (
              <span key={idx} className="rounded-full px-2 py-0.5 font-mono text-[10px]" style={{ backgroundColor: `${chip.c}14`, color: chip.l, border: `1px solid ${chip.c}33` }}>
                {chip.c}
              </span>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/[0.07] bg-black/25 px-3 py-2.5">
            <div className="min-w-0">
              <p className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-[#85817C]">{isPartner ? 'Extensões do parceiro' : 'Extensões Undercut'}</p>
              <p className="mt-0.5 text-[12px] font-semibold text-[#ECE9E3]">
                {connectedCount}/{total} conectadas
              </p>
            </div>
            <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-[#55555C]">chave: {partner.integrationUrl ? 'ativa' : 'pendente'}</span>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {link ? (
              <>
                <a
                  href={link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-8 items-center gap-1.5 rounded-xl px-3 text-[12px] font-semibold text-white transition-opacity hover:opacity-90"
                  style={{ backgroundColor: accent.primary }}
                >
                  <ExternalLink size={14} /> Abrir link de integração
                </a>
                <button
                  type="button"
                  onClick={() => void copy(link)}
                  disabled={busy === 'copy'}
                  className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] px-3 text-[12px] font-semibold text-[#DAD6CF] transition-colors hover:border-white/20 hover:text-white disabled:opacity-60"
                >
                  {busy === 'copy' ? <Loader2 size={14} className="animate-spin" /> : copied === 'copy' ? <Check size={14} /> : <Copy size={14} />}
                  {copied === 'copy' ? 'Copiado' : 'Copiar link'}
                </button>
              </>
            ) : (
              <span className="inline-flex h-8 items-center rounded-xl border border-white/10 bg-white/[0.02] px-3 text-[12px] font-semibold text-[#55555C]">link de integração em breve</span>
            )}
          </div>

          {canManage && (
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/[0.07] pt-3">
              <button
                type="button"
                onClick={() => void addPartnerExtension()}
                disabled={adding}
                className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] px-3 text-[12px] font-semibold text-[#DAD6CF] transition-colors hover:border-white/20 hover:text-white disabled:opacity-60"
              >
                {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Adicionar extensão do parceiro
              </button>
              <button
                type="button"
                onClick={() => void generateConnectionKey()}
                disabled={pairing}
                className="inline-flex h-8 items-center gap-1.5 rounded-xl px-3 text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                style={{ backgroundColor: accent.primary }}
              >
                {pairing ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />} Gerar chave de conexão
              </button>
              <span className="inline-flex items-center gap-1.5 text-[11px] text-[#85817C]">
                <ShieldCheck size={12} /> Só dono/suporte (ADM) gerem chaves e cadastram extensões.
              </span>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
