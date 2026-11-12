/**
 * Parceiros do Hub de extensões (sistemas de gestão parceiros com extensão Undercut).
 *
 * Cada parceiro tem identidade própria: cor primária/secondary, deep (borda/accento
 * escuro) e ink (fundo). As extensões do parceiro usam a paleta dele — nunca a vermelha
 * da Undercut — e são renderizadas em bloco separado do hub principal.
 */

export type PartnerAccent = { primary: string; primaryLight: string; deep: string; ink: string }

export type PartnerBrand = PartnerAccent & {
  slug: string
  name: string
  short: string
  monogram: string
  /** Cor primária (ex.: verde FlyTo). */
  primary: string
  /** Cor clara/accento (ex.: #83C365). */
  primaryLight: string
  /** Cor profunda usada em bordas/glows escuros. */
  deep: string
  /** Cor de fundo escura da paleta. */
  ink: string
  tagline: string
  /** URL pública de integração do sistema do parceiro (onde a chave/SDK se entrega). */
  integrationUrl?: string | null
}

export const PARTNERS: PartnerBrand[] = [
  {
    slug: 'flyto',
    name: 'FlyTo',
    short: 'FlyTo',
    monogram: 'FL',
    primary: '#5FA759',
    primaryLight: '#83C365',
    deep: '#286444',
    ink: '#121229',
    tagline: 'Sistema de gestão de restaurantes · integração com o Undercut',
    integrationUrl: process.env.NEXT_PUBLIC_FLYTO_URL ?? null,
  },
]

export const UNDERCUT_PARTNER_SLUG = 'undercut'

const UNDERCUT_PARTNER: PartnerBrand = {
  slug: UNDERCUT_PARTNER_SLUG,
  name: 'Undercut',
  short: 'Undercut',
  monogram: 'UC',
  primary: '#D7141F',
  primaryLight: '#F0333D',
  deep: '#7A0E13',
  ink: '#0B0B0C',
  tagline: 'Hub de otimização de cardápio',
}

export function partnerOf(slug?: string | null): PartnerBrand {
  const key = slug ?? UNDERCUT_PARTNER_SLUG
  const found = key === UNDERCUT_PARTNER_SLUG ? UNDERCUT_PARTNER : PARTNERS.find((p) => p.slug === key) ?? null
  return found ?? UNDERCUT_PARTNER
}
