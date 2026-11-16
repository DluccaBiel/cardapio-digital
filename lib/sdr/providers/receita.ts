/**
 * Pesquisa de dados abertos da Receita Federal por CNAE + UF + município.
 * Fonte: dados públicos de estabelecimentos/empresas/Simples (download mensal).
 * Este módulo NÃO faz requisição HTTP em tempo real ( seria bloqueado/limitado).
 * Ele apenas define a estrutura e o tipo de dado que será importado via job `import-cnpj-open-data.ts`.
 * O dado carregado já fica disponível em tabela `cnpj_cache` de leitura somente (sem RLS de workspace).
 */

// CNAEs por nicho (para filtro na importação)
// Food: 5611-2/01 (restaurantes), 5611-2/03 (lanchonetes), 5611-2/04/05 (bares)
// 5620-1/04 (alimentos preparados p/ consumo domiciliar - delivery/marmitaria)
// 1091-1/02 e 4721-1/02 (padarias/confeitarias)
// Estética: 9602-5/02 (estética e cuidados com a beleza)
// 9602-5/01 (cabeleireiros/manicure)
export const NICHE_CNAES: Record<string, string[]> = {
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
export const UFS_VALIDAS: Set<string> = new Set([
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'ES', 'GO', 'MA', 'MT',
  'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
]);

/**
 * Tipos para o dado importado da Receita Federal
 */
export type CnpjCacheRow = {
  cnpj_base: string;
  cnpj_ordem: string;
  cnpj_digito: string;
  cnpj: string;
  razao_social: string;
  nome_fantasia: string;
  situacao_cadastral: string;
  data_situacao_cadastral: string;
  cod_tipo_logradouro: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cep: string;
  uf: string;
  municipio: string;
  cod_municipio: string;
  ddd1: string;
  ddd2: string;
  telefone1: string;
  telefone2: string;
  fax: string;
  codigo_endereco: string;
  situacao_especial: string;
  data_situacao_especial: string;
  cnae_fiscal_principal: string;
  cnaes_secundarios: string[];
  abertura: string;
  nome_simplificado: string;
  situacao_especial_natureza: string;
};

/**
 * Filtra linhas do CSV/JSON da Receita para o nicho desejado
 * @param rows Dados cruos da Receita
 * @param niche Nicho ('food' | 'estetica')
 * @param ufs UFs opcionais para filtrar
 */
export function filtraPorNiche(
  rows: CnpjCacheRow[],
  niche: 'food' | 'estetica',
  ufs?: string[]
): CnpjCacheRow[] {
  const cnaesNiche = NICHE_CNAES[niche];
  if (!cnaesNiche) return [];

  return rows.filter((row) => {
    // Filtro por situação cadastral ativa
    if (row.situacao_cadastral !== 'ATIVA') return false;

    // Filtro por CNAE principal
    const cnaePrincipal = row.cnae_fiscal_principal;
    if (cnaesNiche.includes(cnaePrincipal)) return true;

    // Filtro por CNAEs secundários
    const hasSecondaryCnae = row.cnaes_secundarios?.some((cnae) => cnaesNiche.includes(cnae));
    if (hasSecondaryCnae) return true;

    return false;
  })
}

/**
 * Filtra por UFs específicas
 * @param rows Dados já filtrados por nicho
 * @param ufs Siglas das UFs (ex.: ['SP', 'RJ'])
 */
export function filtraPorUfs(rows: CnpjCacheRow[], ufs: string[]): CnpjCacheRow[] {
  if (!ufs || ufs.length === 0) return rows;
  const ufsUpper = ufs.map((u) => u.toUpperCase());
  return rows.filter((row) => ufsUpper.includes(row.uf));
}

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
* Valida se o CNPJ é estruturalmente válido (dígitos verificadores)
* @param cnpj CNPJ limpo (14 dígitos)
 */
export function validarCnpj(cnpj: string): boolean {
  if (cnpj.length !== 14) return false;

  // Extrair dígitos verificadores
  const digitoVerificador1 = parseInt(cnpj.substring(12, 13));
  const digitoVerificador2 = parseInt(cnpj.substring(13, 14));

  // Primeiro dígito verificador
  let soma = 0;
  const pesos1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  for (let i = 0; i < 12; i++) {
    soma += parseInt(cnpj.charAt(i)) * pesos1[i];
  }
  let resultado = soma % 11;
  let digito1 = resultado < 2 ? 0 : 11 - resultado;
  if (digito1 !== digitoVerificador1) return false;

  // Segundo dígito verificador
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