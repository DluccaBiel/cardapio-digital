import type { ProspectClient } from '../db/prospects'
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
