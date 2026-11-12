/**
 * Catálogo estático do Hub de extensões do Undercut.
 *
 * O banco (`public.extensions`) é a fonte de verdade do que está registrado,
 * mas metadados de distribuição (versão, pacote .zip para "Carregar sem
 * compactação", cor de destaque) vivem aqui — assim o hub funciona mesmo antes
 * de uma migration nova ser aplicada em produção.
 *
 * Para publicar uma extensão nova: gere o .zip em `public/extensoes/` e
 * acrescente uma entrada aqui (o registro no banco pode ser feito pelo painel
 * em Configurações → Extensões, sem deploy).
 */
export type ExtensionCatalogEntry = {
  slug: string
  /** Nome curto exibido nos cartões e abas. */
  short: string
  /** Nome completo (marca Undercut). */
  name: string
  description: string
  version: string | null
  /** Caminho público do pacote (.zip) que pode ser carregado em chrome://extensions. */
  downloadUrl: string | null
  homepageUrl: string | null
  /** Extensão ainda em desenvolvimento (sem pacote público). */
  upcoming?: boolean
  /** Monograma usado quando não há logo. */
  monogram: string
}

export const EXTENSION_CATALOG: ExtensionCatalogEntry[] = [
  {
    slug: 'orvia-ifood',
    short: 'iFood',
    name: 'Undercut · Otimizador iFood',
    description: 'Lê o cardápio no Portal do Parceiro, envia ao Undercut e guia a aplicação dos combos e edições aprovadas.',
    version: '0.3.0',
    downloadUrl: '/extensoes/undercut-ifood.zip',
    homepageUrl: null,
    monogram: 'iF',
  },
  {
    slug: 'orvia-cardapioweb',
    short: 'Cardápio Web',
    name: 'Undercut · Cardápio Web',
    description: 'Sincroniza o cardápio do Cardápio Web, confere as pendências e aplica o plano aprovado com prints de cada etapa.',
    version: null,
    downloadUrl: null,
    homepageUrl: null,
    upcoming: true,
    monogram: 'CW',
  },
  {
    slug: 'orvia-anotaai',
    short: 'Anota AI',
    name: 'Undercut · Anota AI',
    description: 'Sincroniza o cardápio do painel do Anota AI, analisa com o Undercut, aplica o que você aprovar e envia o relatório com prints.',
    version: null,
    downloadUrl: null,
    homepageUrl: null,
    upcoming: true,
    monogram: 'AI',
  },
]

export function catalogOf(slug: string): ExtensionCatalogEntry | null {
  return EXTENSION_CATALOG.find((e) => e.slug === slug) ?? null
}
