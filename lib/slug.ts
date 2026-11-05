/**
 * Identificador de workspace (slug).
 *
 * O banco exige `^[a-z0-9][a-z0-9-]{1,62}$` (ver 0001_init.sql) e a rota é
 * `/a/{slug}/...`. Para aceitar qualquer link/texto digitado no onboarding,
 * normalizamos a entrada em vez de rejeitá-la.
 *
 * Exemplos:
 *   "https://www.alpha.com.br/gestao" -> "alpha-com-br-gestao"
 *   "Instagram: @alpha"               -> "instagram-alpha"
 *   "  ALPHA  "                       -> "alpha"
 */
export const WORKSPACE_SLUG_MAX = 63

export function toWorkspaceSlug(input: string): string {
  if (!input) return ''

  let value = input.trim().toLowerCase()

  // "ação" -> "acao"
  value = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')

  // Links completos: remove protocolo, www, query string e hash.
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
  value = value.replace(/^www\./, '')
  value = value.replace(/[?#].*$/, '')

  // Qualquer sequência fora de [a-z0-9] vira hífen (host, caminho, @, etc.).
  value = value.replace(/[^a-z0-9]+/g, '-')
  value = value.replace(/^-+|-+$/g, '')

  // Limita ao tamanho aceito pela coluna e não termina em hífen.
  value = value.slice(0, WORKSPACE_SLUG_MAX).replace(/-+$/g, '')

  return value
}

export function isValidWorkspaceSlug(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,62}$/.test(value)
}
