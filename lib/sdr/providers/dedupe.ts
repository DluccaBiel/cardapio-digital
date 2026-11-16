/**
 * Dedup (remoção de duplicatas) de leads.
 * Critérios: CNPJ, place_id, telefone normalizado (só dígitos) e domínio do site.
 *
 * Trigger (futuro): impede cadência de enfileirar contato suprimido (suppression_list).
 */

import { limparCnpj } from './receita';

// ============================================================
// TIPOS
// ============================================================

/** Dados de contato usados na comparação. */
export type LeadContato = {
  cnpj: string | null;
  placeId: string | null;
  telefone: string | null;
  site: string | null;
};

export type LeadKey = {
  cnpj: string | null; // CNPJ limpo (14 dígitos) ou null
  placeId: string | null; // Google Place ID
  telefoneE164: string | null; // telefone só com dígitos
  dominioSite: string | null; // domínio do site, lowercase, sem www.
};

export type DedupResult = {
  isDuplicate: boolean;
  motivo: string;
  chaveExistente: LeadKey | null; // a chave que já existe
  novoLead: boolean; // true se não é duplicata (pode ser cadastrado)
};

// ============================================================
// NORMALIZAÇÃO
// ============================================================

function soDigitos(valor: string | null | undefined): string {
  return (valor ?? '').replace(/[^0-9]/g, '');
}

/** Domínio normalizado: sem protocolo, sem www., sem caminho. */
export function normalizarDominio(site: string | null | undefined): string {
  if (!site) return '';
  return site
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split(/[/?#]/)[0];
}

const VAZIO: LeadKey = { cnpj: null, placeId: null, telefoneE164: null, dominioSite: null };

// ============================================================
// HASH DE CHAVE (para indexação rápida)
// ============================================================

/**
 * Hash não-criptográfico (djb2) dos campos normalizados — só para indexação
 * rápida em memória. Para persistência use sha256 no banco.
 */
export function gerarHashChave(lead: LeadContato): string {
  const concat = [
    limparCnpj(lead.cnpj ?? ''),
    (lead.placeId ?? '').toUpperCase(),
    soDigitos(lead.telefone),
    normalizarDominio(lead.site),
  ].join('|');

  let hash = 0;
  for (let i = 0; i < concat.length; i++) {
    hash = ((hash << 5) - hash + concat.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

// ============================================================
// VALIDAÇÃO DE CHAVES INDIVIDUAIS (campo vazio nunca é duplicata)
// ============================================================

export function isCnpjDuplicado(cnpj: string, existentes: Array<Pick<LeadContato, 'cnpj'>>): boolean {
  const alvo = limparCnpj(cnpj);
  if (alvo.length !== 14) return false;
  return existentes.some((l) => limparCnpj(l.cnpj ?? '') === alvo);
}

export function isPlaceIdDuplicado(placeId: string, existentes: Array<Pick<LeadContato, 'placeId'>>): boolean {
  if (!placeId) return false;
  const alvo = placeId.toUpperCase();
  return existentes.some((l) => !!l.placeId && l.placeId.toUpperCase() === alvo);
}

export function isTelefoneDuplicado(telefone: string, existentes: Array<Pick<LeadContato, 'telefone'>>): boolean {
  const alvo = soDigitos(telefone);
  if (alvo.length < 8) return false;
  return existentes.some((l) => soDigitos(l.telefone) === alvo);
}

export function isDominioDuplicado(dominio: string, existentes: Array<Pick<LeadContato, 'site'>>): boolean {
  const alvo = normalizarDominio(dominio);
  if (!alvo) return false;
  return existentes.some((l) => normalizarDominio(l.site) === alvo);
}

// ============================================================
// MATCH DE CHAVES (dedup abrangente)
// ============================================================

/**
 * Verifica se um lead é duplicado por CNPJ → Place ID → telefone → domínio.
 * Campos vazios do novo lead são ignorados (não geram falso positivo).
 */
export function verificarDedup(novoLead: LeadContato, leadsExistentes: LeadContato[]): DedupResult {
  if (novoLead.cnpj && isCnpjDuplicado(novoLead.cnpj, leadsExistentes)) {
    return {
      isDuplicate: true,
      motivo: 'CNPJ já cadastrado na base',
      chaveExistente: { ...VAZIO, cnpj: limparCnpj(novoLead.cnpj) },
      novoLead: false,
    };
  }

  if (novoLead.placeId && isPlaceIdDuplicado(novoLead.placeId, leadsExistentes)) {
    return {
      isDuplicate: true,
      motivo: 'Lead já cadastrado com mesmo Place ID',
      chaveExistente: { ...VAZIO, placeId: novoLead.placeId },
      novoLead: false,
    };
  }

  if (novoLead.telefone && isTelefoneDuplicado(novoLead.telefone, leadsExistentes)) {
    return {
      isDuplicate: true,
      motivo: 'Telefone já cadastrado na base',
      chaveExistente: { ...VAZIO, telefoneE164: soDigitos(novoLead.telefone) },
      novoLead: false,
    };
  }

  if (novoLead.site && isDominioDuplicado(novoLead.site, leadsExistentes)) {
    return {
      isDuplicate: true,
      motivo: 'Domínio do site já cadastrado',
      chaveExistente: { ...VAZIO, dominioSite: normalizarDominio(novoLead.site) },
      novoLead: false,
    };
  }

  // Match fuzzy de nome + município fica no provider match.ts (Jaccard ≥ 0.8).
  return {
    isDuplicate: false,
    motivo: 'Lead único - pode ser cadastrado',
    chaveExistente: null,
    novoLead: true,
  };
}
