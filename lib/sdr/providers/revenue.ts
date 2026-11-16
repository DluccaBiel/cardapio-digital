/**
 * Estimativa de faixa de faturamento estimada para leads de PMEs.
 * Regras determinísticas, explicáveis, SEM IA inventando números.
 * 
 * Ajustes por sinais: nº de filiais, capital social, google_reviews_count,
 * presença em iFood/agenda online, anos de operação.
 * 
 * **NUNCA** afirmar faturamento real. A UI deve sempre escrever
 * "Faixa estimada" com as fontes dos sinais utilizados.
 */

// ============================================================
// CLASSIFICAÇÕES DE FATURAMENTO (por porte)
// ============================================================

export type RevenueBand =
  | 'ate_81k'
  | '81k_360k'
  | '360k_1m'
  | '1m_4_8m'
  | 'acima_4_8m';

export type RevenueConfidence = 'baixa' | 'media' | 'alta';

// ============================================================
// DADOS DE BASE: Portes e Faturamento Médio do Brasil (2023/2024)
// Fonte: SBS - Serviço Brasileiro de Estatística, Empreendedorismo
// ============================================================

const PORTES_E_FAIXAS = {
  MEI: {
    limite: 81_000,
    descricao: 'Microempreendedor Individual',
    nomePorte: 'MEI',
    descricaoPorte: 'Empresa de pequeno porte enquadrada no SIMPLES Nacional como MEI',
  },
  ME: {
    limiteInferior: 81_000,
    limiteSuperior: 360_000,
    descricao: 'Microempresa',
    nomePorte: 'ME',
    descricaoPorte: 'Empresa enquadrada como ME, faturamento bruto anual',
  },
  EPP: {
    // EPP (Empresa de Pequeno Porte): receita bruta anual acima de R$ 360 mil
    // e até R$ 4,8 milhões (Lei Complementar 123/2006, Art. 3º, II)
    limiteInferior: 360_000,
    limiteSuperior: 4_800_000,
    descricao: 'Empresa de Pequeno Porte (EPP)',
    nomePorte: 'EPP',
    descricaoPorte: 'Receita bruta anual entre R$ 360 mil e R$ 4,8 milhões',
  },
  'ACIMA_DE_1_MILHAO': {
    limiteSuperior: null,
    descricao: 'Fora do Simples (acima de R$ 4,8 milhões)',
    nomePorte: 'Grande',
    descricaoPorte: 'Receita bruta anual acima de R$ 4,8 milhões',
  },
} as const;

// ============================================================
// FUNÇÕES DE ESTIMATIVA
// ============================================================

/**
 * Determina a faixa de faturamento estimada com base no porte e sinais.
 * 
 * @param porte Porte da empresa (MEI, ME, EPP, ou null)
 * @param sinais Objeto com sinais observados (opcional)
 * @returns Objeto com faixa, confiança e sinais usados
 */
export function estimarFaixaFaturamento(
  porte: 'MEI' | 'ME' | 'EPP' | null,
  sinais?: {
    /** Capital social em reais (se informado) */
    capitalSocial?: number;
    /** Número de filiais (própria ou unidade franqueada) */
    numeroFiliais?: number;
    /** Total de avaliações no Google */
    googleReviewsCount?: number;
    /** Presença em iFood (true/false) */
    temIFood: boolean;
    /** Presença em agenda online (true/false) */
    temAgendaOnline: boolean;
    /** Anos desde a data de abertura */
    anosOperacao?: number;
  }
): {
  faixa: RevenueBand;
  confianca: RevenueConfidence;
  sinaisUsados: string[];
  descricaoPorte: string;
} {
  // Inicializa sinais usados
  const sinaisUsados: string[] = [];

  // Caso porte seja nulo, tenta inferir a partir dos sinais
  if (!porte && sinais) {
    porte = inferirPortePorSinais(sinais);
  }

  // Caso ainda assim seja nulo, usa padrão 'ME'
  if (!porte) porte = 'ME';

  // --- LÓGICA POR PORTE ---

  // --- MEI ---
  if (porte === 'MEI') {
    sinaisUsados.push('porte_MEI');
    return {
      faixa: 'ate_81k',
      confianca: 'alta',
      sinaisUsados,
      descricaoPorte: PORTES_E_FAIXAS.MEI.descricaoPorte,
    };
  }

  // --- ME ---
  if (porte === 'ME') {
    // Lógica baseada em sinais para ajustar a confiança
    sinaisUsados.push('porte_ME');

    // Fatores que aumentam a confiança
    const fatoresAumentoConfianca: number[] = [];

    if (sinais?.capitalSocial !== undefined && sinais.capitalSocial > 0) {
      sinaisUsados.push('capitalSocial');
      fatoresAumentoConfianca.push(0.2);
    }

    if (sinais?.numeroFiliais && sinais.numeroFiliais > 1) {
      sinaisUsados.push('numeroFiliais');
      fatoresAumentoConfianca.push(0.1);
    }

    if (sinais?.temIFood) {
      sinaisUsados.push('temIFood');
      fatoresAumentoConfianca.push(0.1);
    }

    if (sinais?.temAgendaOnline) {
      sinaisUsados.push('temAgendaOnline');
      fatoresAumentoConfianca.push(0.1);
    }

    if (sinais?.googleReviewsCount && sinais.googleReviewsCount >= 10) {
      sinaisUsados.push('googleReviewsCount');
      fatoresAumentoConfianca.push(0.1);
    }

    // Soma dos fatores de confiança (máx. 0.5 adicional)
    const extraConfianca = fatoresAumentoConfianca.reduce((sum, f) => sum + f, 0);

    // Se tem sinais fortes, confiança é 'alta', se fracos, 'média'
    const temSinaisFortes = extraConfianca >= 0.3;

    return {
      faixa: '81k_360k',
      confianca: temSinaisFortes ? 'alta' : 'media',
      sinaisUsados,
      descricaoPorte: PORTES_E_FAIXAS.ME.descricaoPorte,
    };
  }

  // --- EPP ---
  if (porte === 'EPP') {
    sinaisUsados.push('porte_EPP');

    // Ajustes finos baseados em sinais
    const ajustes: number[] = [];

    if (sinais?.capitalSocial !== undefined && sinais.capitalSocial > 0) {
      ajustes.push(0.1);
      sinaisUsados.push('capitalSocial');
    }

    if (sinais?.numeroFiliais && sinais.numeroFiliais > 1) {
      ajustes.push(0.1);
      sinaisUsados.push('numeroFiliais');
    }

    if (sinais?.temIFood) {
      ajustes.push(0.1);
      sinaisUsados.push('temIFood');
    }

    if (sinais?.temAgendaOnline) {
      ajustes.push(0.1);
      sinaisUsados.push('temAgendaOnline');
    }

    if (sinais?.anosOperacao && sinais.anosOperacao >= 5) {
      ajustes.push(0.1);
      sinaisUsados.push('anosOperacao');
    }

    // EPP tende a ser 360k_1m ou 1m_4_8m: com 3+ sinais de porte, sobe para a faixa superior
    const faixa: RevenueBand = ajustes.length >= 3 ? '1m_4_8m' : '360k_1m';

    return {
      faixa,
      confianca: ajustes.length > 0 ? 'media' : 'baixa',
      sinaisUsados,
      descricaoPorte: PORTES_E_FAIXAS.EPP.descricaoPorte,
    };
  }

  // --- ACIMA DE 1 MILHÃO ---
  return {
    faixa: 'acima_4_8m',
    confianca: 'baixa',
    sinaisUsados: ['porte_grande'],
    descricaoPorte: PORTES_E_FAIXAS['ACIMA_DE_1_MILHAO'].descricaoPorte,
  };
}

/**
 * Função auxiliar: infere o porte a partir dos sinais quando não informado
 */
function inferirPortePorSinais(sinais: {
  capitalSocial?: number;
  numeroFiliais?: number;
  temIFood: boolean;
  temAgendaOnline: boolean;
  googleReviewsCount?: number;
  anosOperacao?: number;
}): 'MEI' | 'ME' | 'EPP' | null {
  // Regras simples de inferência

  // Se tem capital social baixo (até 50k) e sem filiais → MEI
  if (
    sinais.capitalSocial !== undefined &&
    sinais.capitalSocial <= 50_000 &&
    (!sinais.numeroFiliais || sinais.numeroFiliais <= 1)
  ) {
    return 'MEI';
  }

  // Se tem filiais, é no mínimo ME
  if (sinais.numeroFiliais && sinais.numeroFiliais >= 2) {
    return 'ME'; // no mínimo ME, pode ser EPP
  }

  // Se tem IFood ou agenda online, tende a ser ME ou EPP
  if (sinais.temIFood || sinais.temAgendaOnline) {
    // Se também tem capital social alto ou muitas filiais → EPP
    if (
      (sinais.capitalSocial !== undefined && sinais.capitalSocial > 100_000) ||
      (sinais.numeroFiliais && sinais.numeroFiliais >= 5)
    ) {
      return 'EPP';
    }
    return 'ME';
  }

  // Se tem muitos anos de operação e muitas avaliações → EPP ou acima
  if (sinais.anosOperacao && sinais.anosOperacao >= 10) {
    return 'EPP';
  }

  // Padrão: ME
  return 'ME';
}

export { PORTES_E_FAIXAS };