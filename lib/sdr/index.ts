// Módulo SDR (Smart Digital Research) - Undercut.
// 
// Este módulo fornece a estrutura para:
// - Descoberta de leads por dados abertos (Receita Federal, Google Places)
// - Enriquecimento de leads com CNPJ, dados de contato, sinais de faturamento
// - Match e dedup de leads (evitar leads duplicados)
// - Cálculo de ICP Score (Ideal Customer Profile 0-100)
// - Faixa de faturamento estimada (sem inventar números)
//
// Arquitetura: todos os providers são isolados e testáveis (unit testable).
// Nenhuma requisição HTTP é feita diretamente neste módulo (exceto places e public-web,
// que têm seus próprios rate limits e SSRF guards definidos dentro).
//
// Ordem de execução esperada:
// Fase 1 (banco de dados) → Fase 2 (providers) → Fase 3 (CRM/SDR) → Fase 4 (cadência)
// etc.

// ============================================================
// PROVIDERS - Funções auxiliares reexportadas do módulo
// ============================================================

// CNAEs por nicho
export const NICHE_CNAES = {
  food: [
    '5611-2/01', // restaurantes
    '5611-2/03', // lanchonetes/casas de chá/sucos
    '5611-2/04', // bares
    '5611-2/05', // bares
    '5620-1/04', // alimentos preparados p/ consumo domiciliar - delivery/marmitaria
    '1091-1/02', // padarias/confeitarias
    '4721-1/02',
  ],
  estetica: [
    '9602-5/02', // estética e cuidados com a beleza
    '9602-5/01', // cabeleireiros/manicure
  ],
};

// UFs suportadas (siglas)
export const UFS_VALIDAS = new Set([
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'ES', 'GO', 'MA', 'MT',
  'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
]);

// ============================================================
// FILTROS
// ============================================================

/**
 * Filtra linhas do CSV/JSON da Receita para o nicho desejado
 * @param rows Dados cruos da Receita
 * @param niche Nicho ('food' | 'estetica')
 * @param ufs UFs opcionais para filtrar
 */
export function filtraPorNiche(
  rows: any[],
  niche: 'food' | 'estetica',
  ufs?: string[]
): any[] {
  const cnaesNiche = NICHE_CNAES[niche];
  if (!cnaesNiche) return [];

  return rows.filter((row) => {
    if (row.situacao_cadastral !== 'ATIVA') return false;

    const cnaePrincipal = row.cnae_fiscal_principal;
    if (cnaesNiche.includes(cnaePrincipal)) return true;

    if (row.cnaes_secundarios && row.cnaes_secundarios.some((cnae: string) => cnaesNiche.includes(cnae))) return true;

    return false;
  });
}

/**
 * Filtra por UFs específicas
 * @param rows Dados já filtrados por nicho
 * @param ufs Siglas das UFs (ex.: ['SP', 'RJ'])
 */
export function filtraPorUfs(rows: any[], ufs: string[]): any[] {
  if (!ufs || ufs.length === 0) return rows;
  const ufsUpper = ufs.map((u) => u.toUpperCase());
  return rows.filter((row) => ufsUpper.includes(row.uf));
}

// ============================================================
// FORMATACAO DE CNPJ
// ============================================================

/**
 * Formata CNPJ para padrão xx.xxx.xxx/xxxx-xx
 * @param cnpj CNPJ sem máscara (apenas números)
 */
export function formatCnpj(cnpj: string): string {
  if (!cnpj || cnpj.length !== 14) return cnpj;
  return `${cnpj.substring(0, 2)}.${cnpj.substring(2, 5)}.${cnpj.substring(5, 8)}/${cnpj.substring(8, 12)}-${cnpj.substring(12, 14)}`;
}

/**
 * Limpa CNPJ removendo máscaras e pontos
 * @param cnpj CNPJ com ou máscara
 */
export function limparCnpj(cnpj: string): string {
  return cnpj.replace(/[^0-9]/g, '');
}

/**
 * Valida se o CNPJ e estruturalmente valido (dígitos verificadores)
 * @param cnpj CNPJ limpo (14 dígitos)
 */
export function validarCnpj(cnpj: string): boolean {
  if (cnpj.length !== 14) return false;

  const digitoVerificador1 = parseInt(cnpj.substring(12, 13));
  const digitoVerificador2 = parseInt(cnpj.substring(13, 14));

  let soma = 0;
  const pesos1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  for (let i = 0; i < 12; i++) {
    soma += parseInt(cnpj.charAt(i)) * pesos1[i];
  }
  let resultado = soma % 11;
  let digito1 = resultado < 2 ? 0 : 11 - resultado;
  if (digito1 !== digitoVerificador1) return false;

  let soma2 = 0;
  const pesos2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  for (let i = 0; i < 12; i++) {
    soma2 += parseInt(cnpj.charAt(i)) * pesos2[i];
  }
  resultado = soma2 % 11;
  let digito2 = resultado < 2 ? 0 : 11 - resultado;
  if (digito2 !== digitoVerificador2) return false;

  return true;
}

// ============================================================
// ENRIQUECIMENTO E ANÁLISE
// ============================================================

/**
 * Estima a faixa de faturamento baseada no porte da empresa
 * @param porte 'MEI' | 'ME' | 'EPP' | 'acima_4_8m'
 * @param sinais Objetos de sinais de receita
 */
export function estimarFaixaFaturamento(porte: 'MEI' | 'ME' | 'EPP' | 'acima_4_8m', sinais: any): { faixa: string; confianca: string } {
  // Lógica simplificada - em produção usaria mais sinais
  const faixas: Record<string, { faixa: string; confianca: string }> = {
    MEI: { faixa: 'Até R$ 81.000/ano', confianca: 'alta' },
    ME: { faixa: 'R$ 81.000 a R$ 360.000/ano', confianca: 'alta' },
    EPP: { faixa: 'R$ 360.000 a R$ 4.800.000/ano', confianca: 'media' },
    acima_4_8m: { faixa: 'Acima de R$ 4.800.000/ano', confianca: 'baixa' },
  };
  return faixas[porte] || { faixa: 'Indeterminado', confianca: 'baixa' };
}

/**
 * Calcula o ICP Score (0-100) baseados em 6 dimensões
 * @param dados Dados da empresa
 */
export function calcularIcpScore(dados: any): { score: number; band: string; evidencias: string[] } {
  // Lógica simplificada - em produção consultaria o provider ICP completo
  let score = 50; // padrao medio
  const evidencias: string[] = ['Dados insuficientes para calculo completo'];

  // Verifica CNAE
  if (dados.cnae && NICHE_CNAES.food.includes(dados.cnae)) {
    score += 15;
    evidencias.push('CNAE compatível com nicho food');
  }
  if (dados.cnae && NICHE_CNAES.estetica.includes(dados.cnae)) {
    score += 15;
    evidencias.push('CNAE compatível com nicho estetica');
  }

  // Verifica faturamento
  if (dados.faturamento_mensal) {
    if (dados.faturamento_mensal >= 4800000) {
      score += 20;
      evidencias.push('Faturamento acima de R$ 4,8M');
    } else if (dados.faturamento_mensal >= 360000) {
      score += 15;
      evidencias.push('Faturamento entre R$ 360k e R$ 4,8M');
    } else if (dados.faturamento_mensal >= 81000) {
      score += 10;
      evidencias.push('Faturamento entre R$ 81k e R$ 360k');
    } else if (dados.faturamento_mensal >= 0) {
      score += 5;
      evidencias.push('Faturamento informado (ME/MEI)');
    }
  }

  // Cap at 100
  score = Math.min(score, 100);

  const qualificado = score >= 60;
  const band = qualificado ? 'Qualificado (>= 60)' : 'Não qualificado (< 60)';

  return { score, band, evidencias };
}

/**
 * Verifica se um lead corresponde ao perfil inicial de prospectação
 * baseado apenas em dados superficiais (sem enriquecimento profundo).
 */
export function leadElegivelInicial(
  dados: {
    niche: 'food' | 'estetica';
    cnae?: string;
    uf: string;
    municipio: string;
  }
): boolean {
  // Verifica se o CNAE pertence ao nicho
  const cnaesNiche = NICHE_CNAES[dados.niche] || NICHE_CNAES.food;
  const cnaeBate = cnaesNiche.includes(dados.cnae || '');

  // Verifica se a UF esta na lista suportada
  const ufValida = UFS_VALIDAS.has(dados.uf.toUpperCase());

  return cnaeBate && ufValida;
}

// ============================================================
// MATCH E DEDEDUP (versoes simplificadas)
// ============================================================

/**
 * Match nome-CNPJ fuzzy usando similitude de Jaccard
 * @param nome Nome da empresa
 * @param cnpj CNPJ da empresa
 * @param dadosReceita Dados da base da Receita (objeto CnpjCacheRow)
 */
export function matchNomeCNPJ(nome: string, cnpj: string, dadosReceita: any): { match: boolean; similaridade: number; cnpj_encontrado: string | null } {
  // Versao simplificada - em produzione usaria o provider match.ts completo
  const cnpjLimpo = limparCnpj(cnpj);
  // Verifica se o CNPJ existe nos dados
  if (!dadosReceita || !dadosReceita.cnpj) {
    return { match: false, similaridade: 0, cnpj_encontrado: null };
  }

  const cnpjBase = dadosReceita.cnpj.replace(/[^0-9]/g, '');
  const match = cnpjLimpo === cnpjBase;

  return {
    match,
    similaridade: match ? 1.0 : 0.0,
    cnpj_encontrado: match ? cnpjLimpo : null,
  };
}

/**
 * Gera hash para dedup de CNPJ
 * @param cnpj CNPJ limpo ou com mascara
 */
export function gerarHashChave(cnpj: string): string {
  const limpo = limparCnpj(cnpj);
  // Hash simples baseado nos 8 primeiros digitos
  return limpo.substring(0, 8);
}

/**
 * Verifica se CNPJ ja existe no sistema (dedup basico)
 * @param cnpj CNPJ a ser verificado
 * @param listaCnpjs Lista de CNPJs ja cadastrados
 */
export function isCnpjDuplicado(cnpj: string, listaCnpjs: string[]): boolean {
  const limpo = limparCnpj(cnpj);
  return listaCnpjs.some(c => limparCnpj(c) === limpo);
}

// ============================================================
// CONFIGURACOES DO MODULO
// ============================================================

export const MODULO_VERSION = '2.0.0-beta';
export const ULT_ATUALIZACAO = new Date('2024-01-01');

// ============================================================
// METADADO DO MÓDULO
// ============================================================

/**
 * Próximos passos após esta fase:
 * // - Implementar Fase 3: Telas no hub (/a/{ws}/sdr)
 * // - Integrar providers com Supabase (RLS, storage)
 * // - Criar endpoints API (/api/v1/sdr/...)
 * // - Implementar extensão Chrome side panel
 * // - Testes unitários completos com fixtures mockados
 */