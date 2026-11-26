/** Funções puras de papel (sem next/headers): seguras para componentes de cliente. */

/** Papel que só enxerga o menu Extensões (convidado por link). */
export const COLLABORATOR_ROLE = 'colaborador'

/** Primeira tela de cada papel: o colaborador cai direto em Extensões. */
export function homePath(w: { slug: string; role: string }): string {
  return `/a/${w.slug}/${w.role === COLLABORATOR_ROLE ? 'extensoes' : 'visao-geral'}`
}
