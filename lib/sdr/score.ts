import type { ProspectClient } from '../db/prospects'
import type { ProspectLead } from '../db/disparos'
import { calcularIcpScore } from './providers/icp'

/**
 * ICP de um cliente cadastrado, só com o que existe no banco (nicho, site,
 * Instagram). O nicho `health` do banco usa a régua de `estetica` do SDR.
 */
export function icpFromClient(c: ProspectClient): { score: number; band: string; evidencias: string[] } {
  return calcularIcpScore({
    niche: c.niche === 'food' ? 'food' : c.niche === 'health' ? 'estetica' : null,
    hasSite: !!c.website,
    hasInstagram: !!c.instagram,
  })
}

/**
 * ICP de uma empresa prospectada pelo agente, calculado com base em dados de mapas e web.
 */
export function icpFromLead(l: Partial<ProspectLead>): { score: number; band: string; evidencias: string[] } {
  const isIg = Boolean(l.website && /instagram\.com/i.test(l.website))
  return calcularIcpScore({
    niche: 'food',
    hasSite: Boolean(l.website && !isIg),
    hasInstagram: isIg,
    municipio: l.city ?? undefined,
  })
}
