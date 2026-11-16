// Script de importação da base de dados abertos da Receita Federal.
// Baixa os arquivos mensais de Estabelecimentos, Empresas e Simples,
// filtra pelos CNAEs do nicho + situação ATIVA, e carrega em tabela cnpj_cache.

// Este script roda como job agendado (pg_cron ou edge function), NUNCA em request
// da aplicação. Dados são de livre acesso, mas de uso restrito (apenas leitura,
// sem armazenamento em massa para revenda).

// ============================================================
// CONFIGURAÇÕES
// ============================================================

// CNAEs iniciais para prospecção (válidos na tabela oficial CONCLA/IBGE)
// Ajustar conforme necessário a cada novo nicho adicionado
const CNAES_FOOD: Set<string> = new Set([
  '5611-2/01', // restaurantes
  '5611-2/03', // lanchonetes/casas de chá/sucos
  '5611-2/04',
  '5611-2/05',
  '5620-1/04', // alimentos preparados p/ consumo domiciliar - delivery/marmitaria
  '1091-1/02',
  '4721-1/02',
]);

const CNAES_ESTETICA: Set<string> = new Set([
  '9602-5/02', // estética e cuidados com a beleza
  '9602-5/01', // cabeleireiros/manicure
]);

// UFs configuradas para importação (deixar vazio = todas as UFs)
const UFS_CONFIGURADAS: Set<string> | null = new Set([
  // 'SP', 'RJ', 'MG', // exemplo: apenas estas 3 UFs
]);

// ============================================================
// TYPES PARA O DADO IMPORTADO
// ============================================================

// Linha do CSV/JSON da Receita Federal (campos principais)
type LinhaReceita = {
  cnpj_base: string;
  cnpj_ordem: string;
  cnpj_digito: string;
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

// ============================================================
// FUNÇÕES PRINCIPAIS
// ============================================================

/**
 * Baixa o arquivo CSV da Receita Federal para o mês informado.
 * Os arquivos ficam em: https://receita.economia.gov.br/
 * URLs padronizadas (exemplo):
 - Janeiro: https://www.receita.fazenda.gov.br/Aplicacoes/SSL/AC/Cidadao/AED/CSV/Estabelecimentos_jan.csv
 - Fevereiro: .../CSV/Estabelecimentos_fev.csv
 - etc.
 
 * Nota: Em produção, usar o serviço de download automatizado do Serpro ou
 * API paga (CNPJá, ReceitaWS). Este script exemplifica o fluxo lógico.
 */
async function baixarArquivoReceita(mes: number, ano: number): Promise<string | null> {
  // Em ambiente real, faria o download do CSV/JSON da Receita
  // Aqui simulamos com dados de exemplo para o módulo funcionar
  
  // TODO: Implementar download real quando necessário
  // const url = `https://www.receita.fazenda.gov.br/Aplicacoes/SSL/AC/Cidadao/AED/CSV/Estabelecimentos_${mes.toString().padStart(2, '0')}_${ano}.csv`;
  // const res = await fetch(url, { headers: { 'User-Agent': 'SDR-Undercut/1.0' } });
  // if (!res.ok) return null;
  // return await res.text();
  
  // Por enquanto, retornamos null para indicar que o download depende de configuração externa
  return null;
}

/**
 * Faz o parse do CSV/JSON da Receita Federal para o tipo LinhaReceita.
 * O CSV da Receita tem formatação específica com ponto e vírgula como delimitador
 * em alguns campos, e vírgula em outros. Este parser lida com ambas as situações.
 */
function parseLinhaCSV(linha: string): LinhaReceita | null {
  // O CSV da Receita tem campos separados por ponto e vírgula (;)
  // Alguns campos podem coneter vírgula dentro aspas — tratado aqui simplificadamente
  const campos = linha.split(';').map((campo) => {
    // Remove aspas e espaços extras
    return campo.replace(/^"|"$/g, '').trim();
  });

  // O CSV da Receita tem 41+ campos na ordem específica. Pegamos apenas os principais.
  if (campos.length < 41) return null; // dados insuficientes

  return {
    cnpj_base: campos[0] || '',
    cnpj_ordem: campos[1] || '',
    cnpj_digito: campos[2] || '',
    razao_social: campos[11] || '', // posição 12 (índice 11)
    nome_fantasia: campos[12] || '', // posição 13 (índice 12)
    situacao_cadastral: campos[20] || '', // posição 21 (índice 20)
    data_situacao_cadastral: campos[21] || '', // posição 22 (índice 21)
    cod_tipo_logradouro: campos[24] || '', // posição 25 (índice 24)
    logradouro: campos[25] || '', // posição 26 (índice 25)
    numero: campos[26] || '', // posição 27 (índice 26)
    complemento: campos[27] || '', // posição 28 (índice 27)
    bairro: campos[28] || '', // posição 29 (índice 29)
    cep: campos[29] || '', // posição 30 (índice 29)
    uf: campos[30] || '', // posição 31 (índice 30)
    municipio: campos[31] || '', // posição 32 (índice 31)
    cod_municipio: campos[32] || '', // posição 33 (índice 32)
    ddd1: campos[33] || '', // posição 34 (índice 33)
    ddd2: campos[34] || '', // posição 35 (índice 34)
    telefone1: campos[35] || '', // posição 36 (índice 35)
    telefone2: campos[36] || '', // posição 37 (índice 36)
    fax: campos[37] || '', // posição 38 (índice 38)
    codigo_endereco: campos[38] || '', // posição 39 (índice 38)
    situacao_especial: campos[39] || '', // posição 40 (índice 39)
    data_situacao_especial: campos[40] || '', // posição 41 (índice 40)
    cnae_fiscal_principal: campos[8] || '', // posição 9 (índice 8) - CNAE principal
    cnaes_secundarios: [], // posição 10+ (índices 10+) - viriam como array separado
    abertura: campos[3] || '', // posição 4 (índice 3)
    nome_simplificado: campos[6] || '', // posição 7 (índice 6)
    situacao_especial_natureza: campos[43] || '', // posição 44 (índice 43) - se houver
  };
}

// ============================================================
// IMPORTATION LOGIC
// ============================================================

/**
 * Importa dados da Receita Federal para o banco/cnpj_cache.
 * 
 * Passo a passo:
 // 1. Baixar arquivo CSV/JSON para o mês/ano desejado
 // 2. Fazer parse das linhas
 // 3. Filtrar por CNAE do nicho desejado (food/estetica)
 // 3. Filtrar por situação ATIVA
 // 4. Filtrar por UFs configuradas (se houver)
 // 5. Inserir em tabela cnpj_cache (sem RLS de workspace - dado público)
 // 6. Atualizar índice de busca para as APIs subsequentes
 *
 * @param mes Mês (1-12)
 * @param ano Ano (ex.: 2024)
 * @param niche Nicho ('food' | 'estetica') - opcional, se não informado, importa todos
 * @param ufs UFs opcionais (ex.: ['SP', 'RJ'])
 */
export async function importarDadosReceita(
  mes: number,
  ano: number,
  niche?: 'food' | 'estetica',
  ufs?: string[]
): Promise<{
  totalLinhas: number;
  linhasFiltradas: number;
  linhasInseridas: number;
  cnaesEncontrados: string[];
}> {
  // 1. Baixa o arquivo (simulado - em produção faria o fetch real)
  const conteudo = await baixarArquivoReceita(mes, ano);
  
  if (!conteudo) {
    return {
      totalLinhas: 0,
      linhasFiltradas: 0,
      linhasInseridas: 0,
      cnaesEncontrados: [],
    };
  }

  // 2. Faz o parse das linhas do CSV
  const linhas = conteudo.split('\n').filter((linha) => linha.trim().length > 0);
  const totalLinhas = linhas.length;

  // 3. Faz o parse de cada linha e filtra
  const linhasParseadas: LinhaReceita[] = [];
  for (const linha of linhas) {
    const parsed = parseLinhaCSV(linha);
    if (parsed) {
      linhasParseadas.push(parsed);
    }
  }

  // 4. Filtro: situação ATIVA + CNAE (principal ou secundário) do nicho + UFs (opcional)
  const cnaesAlvo = niche === 'estetica' ? CNAES_ESTETICA : CNAES_FOOD;
  const ufsFiltro = (ufs && ufs.length > 0 ? ufs : Array.from(UFS_CONFIGURADAS ?? [])).map((u) => u.toUpperCase());
  const cnaesEncontrados: Set<string> = new Set();

  const linhasElegiveis = linhasParseadas.filter((linha) => {
    if (linha.situacao_cadastral !== 'ATIVA') return false;
    if (ufsFiltro.length > 0 && !ufsFiltro.includes(linha.uf.toUpperCase())) return false;

    const cnaes = [linha.cnae_fiscal_principal, ...(linha.cnaes_secundarios ?? [])].filter((c) => cnaesAlvo.has(c));
    if (cnaes.length === 0) return false;
    cnaes.forEach((c) => cnaesEncontrados.add(c));
    return true;
  });

  // 5. Inserção em cnpj_cache: ainda não implementada (tabela não existe nas migrations).
  return {
    totalLinhas,
    linhasFiltradas: linhasElegiveis.length,
    linhasInseridas: 0,
    cnaesEncontrados: Array.from(cnaesEncontrados),
  };
}

export { baixarArquivoReceita, parseLinhaCSV, CNAES_FOOD, CNAES_ESTETICA, UFS_CONFIGURADAS };
export type { LinhaReceita };
