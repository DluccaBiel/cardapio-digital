// Provider de calculo de ICP (Ideal Customer Profile) score 0-100.
// Versao simplificada - calculo deterministico baseado em regras de negocio.

// ============================================================
// PESOS DAS DIMENSIONES ICP
// ============================================================

export const ICP_PESOS_PADRAO = {
  nicho: 25,
  faixa: 20,
  canalDigital: 15,
  sinalDor: 20,
  telefone: 10,
  localizacao: 10,
};

// ============================================================
// SIMILITUDE DE JACCARD
// ============================================================

export const SIMILARITY_THRESHOLD = 0.8;

/**
 * Calcula o ICP Score baseado em 6 dimensoes (0-100).
 * Versao simplificada - uso deterministico baseado em regras.
 *
 * @param dados Dados da empresa para calculo
 * @returns Score ICP (0-100), banda e evidencias
 */
export function calcularIcpScore(dados: {
  niche: 'food' | 'estetica' | null;
  cnae?: string;
  faturamento_mensal?: number;
  porte?: 'MEI' | 'ME' | 'EPP' | 'acima_4_8m';
  hasSite?: boolean;
  hasInstagram?: boolean;
  googleReviews?: number;
  municipio?: string;
  /** Sinal de dor observado (ex.: avaliações citando demora, agenda vazia). */
  sinalDor?: boolean;
}): { score: number; band: string; evidencias: string[] } {
  let score = 0;
  const evidencias: string[] = [];

  // Dimensao 1: Nicho (25 pontos maximo)
  if (dados.niche === 'food' || dados.niche === 'estetica') {
    score += ICP_PESOS_PADRAO.nicho;
    evidencias.push(`Nicho ${dados.niche} identificado`);
  } else {
    evidencias.push('Nicho nao identificado ou incompatível');
  }

  // Dimensao 2: CNAE (parte da faixa de 20 pontos)
  if (dados.cnae) {
    const cnaesFood = ['5611-2/01', '5611-2/03', '5611-2/04', '5611-2/05', '5620-1/04', '1091-1/02', '4721-1/02'];
    const cnaesEstetica = ['9602-5/02', '9602-5/01'];
    if (dados.niche === 'food' && cnaesFood.includes(dados.cnae)) {
      score += ICP_PESOS_PADRAO.faixa / 2; // metade da faixa por CNAE
      evidencias.push('CNAE compatível com food');
    }
    if (dados.niche === 'estetica' && cnaesEstetica.includes(dados.cnae)) {
      score += ICP_PESOS_PADRAO.faixa / 2;
      evidencias.push('CNAE compatível com estetica');
    }
  }

  // Dimensao 3: Faturamento (20 pontos maximo)
  if (dados.faturamento_mensal !== undefined && dados.faturamento_mensal !== null) {
    const faturamento = dados.faturamento_mensal;
    if (faturamento >= 4800000) {
      score += ICP_PESOS_PADRAO.faixa;
      evidencias.push('Faturamento acima de R$ 4,8M/ mês');
    } else if (faturamento >= 360000) {
      score += ICP_PESOS_PADRAO.faixa * 0.7;
      evidencias.push('Faturamento entre R$ 360k e R$ 4,8M/ mês');
    } else if (faturamento >= 81000) {
      score += ICP_PESOS_PADRAO.faixa * 0.4;
      evidencias.push('Faturamento entre R$ 81k e R$ 360k/ mês');
    } else if (faturamento > 0) {
      score += ICP_PESOS_PADRAO.faixa * 0.2;
      evidencias.push('Faturamento baixo (ME/MEI)');
    } else {
      evidencias.push('Sem informacao de faturamento');
    }
  }

  // Dimensao 4: Canal Digital (15 pontos maximo)
  // (máx. 15: site vale o peso cheio; só Instagram vale metade)
  if (dados.hasSite) {
    score += ICP_PESOS_PADRAO.canalDigital;
    evidencias.push('Empresa tem website');
  } else if (dados.hasInstagram) {
    score += ICP_PESOS_PADRAO.canalDigital * 0.5;
  }
  if (dados.hasInstagram) evidencias.push('Empresa tem Instagram');

  // Dimensao 5: Sinal de dor (20 pontos maximo)
  if (dados.sinalDor) {
    score += ICP_PESOS_PADRAO.sinalDor;
    evidencias.push('Sinal de dor identificado');
  }

  // Dimensao 6: Localizacao (10 pontos maximo)
  if (dados.municipio) {
    score += ICP_PESOS_PADRAO.localizacao;
    evidencias.push('Localizacao identificada: ' + dados.municipio);
  }

  // Cap at 100
  score = Math.min(score, 100);

  const qualificado = score >= 60;
  const band = qualificado ? 'Qualificado (>= 60)' : 'Não qualificado (< 60)';

  return { score, band, evidencias };
}

/**
 * Verifica o niche por CNAE
 * @param cnae CNAE da empresa
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

export type IcpResult = {
  score: number;
  band: string;
  evidencias: string[];
};

export type IcpPesos = typeof ICP_PESOS_PADRAO;