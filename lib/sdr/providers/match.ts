// Provider de match e dedup (nome-CNPJ fuzzy).
// Usa similitude de Jaccard para comparacao.

// ============================================================
// CONFIGURACOES DE SIMILITUDE
// ============================================================

export const SIMILARITY_THRESHOLD = 0.8;

// ============================================================
// TOKENIZACAO E NORMALIZACAO
// ============================================================

/**
 * Normaliza um nome removendo acentos, especiais e minusculo
 * @param nome Nome a ser normalizado
 */
function tokens(texto: string): Set<string> {
  if (!texto) return new Set();
  // Remove acentos e caracteres especiais
  const semAcentos = texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim();

  // Divide em tokens (palavras)
  return new Set(semAcentos.split(/\s+/));
}

/**
 * Normaliza o nome da empresa para comparacao
 * @param nome Nome a ser normalizado
 */
function normalizeName(nome: string): string {
  if (!nome) return '';
  return nome
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim();
}

// ============================================================
// MATCH NOME-CNPJ FUZZY
// ============================================================

/**
 * Match nome-CNPJ fuzzy usando similitude de Jaccard.
 * Retorna true se a similitude acima do threshold.
 *
 * @param nome Nome da empresa
 * @param cnpj CNPJ da empresa
 * @param dadosReceita Dados da base da Receita (objeto com cnpj, razao_social)
 */
export function matchNomeCNPJ(nome: string, cnpj: string, dadosReceita: any): { match: boolean; similaridade: number; cnpj_encontrado: string | null } {
  if (!nome || !cnpj || !dadosReceita) {
    return { match: false, similaridade: 0, cnpj_encontrado: null };
  }

  const cnpjLimpo = dadosReceita.cnpj ? dadosReceita.cnpj.replace(/[^0-9]/g, '') : '';
  const nomeNormalizado = normalizeName(nome);
  const razaoSocialNormalizada = normalizeName(dadosReceita.razao_social || '');

  // Calcula similitude baseada em tokens do nome
  const tokensNome = tokens(nomeNormalizado);
  const tokensRazao = tokens(razaoSocialNormalizada);

  // Jaccard: |A ∩ B| / |A ∪ B|
  const listaNome = Array.from(tokensNome).filter(Boolean);
  const listaRazao = Array.from(tokensRazao).filter(Boolean);
  const intersecao = listaNome.filter((t) => tokensRazao.has(t)).length;
  const uniao = new Set<string>(listaNome.concat(listaRazao)).size;

  const similaridade = uniao > 0 ? intersecao / uniao : 0;

  const match = similaridade >= SIMILARITY_THRESHOLD;

  return {
    match,
    similaridade: Number(similaridade.toFixed(4)),
    cnpj_encontrado: match ? cnpjLimpo : null,
  };
}

// ============================================================
// VERIFICACAO DE NICHE POR CNAE
// ============================================================

/**
 * Verifica se um CNAE pertence ao nicho food ou estetica
 * @param cnae CNAE para verificar
 */
function verificaNichePorCNAE(cnae: string): 'food' | 'estetica' | null {
  const cnaesFood = ['5611-2/01', '5611-2/03', '5611-2/04', '5611-2/05', '5620-1/04', '1091-1/02', '4721-1/02'];
  const cnaesEstetica = ['9602-5/02', '9602-5/01'];

  if (cnaesFood.includes(cnae)) return 'food';
  if (cnaesEstetica.includes(cnae)) return 'estetica';
  return null;
}

// ============================================================
// EXPORTS
// ============================================================

export type MatchResult = {
  match: boolean;
  similaridade: number;
  cnpj_encontrado: string | null;
};

export type Niche = 'food' | 'estetica';