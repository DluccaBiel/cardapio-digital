/**
 * Conversões puras entre o snapshot do iFood (formato interno da extensão)
 * e os contratos da API do Orvia. Sem chrome.*, sem DOM — testável.
 */
import type { MenuItem, MenuSnapshot } from '../core/schema'
import type { HubCatalog, HubPendingItem } from './hub'

/** Corpo de POST /api/v1/menu/import. */
export function snapshotToImport(snapshot: MenuSnapshot, clientId: string) {
  return {
    client_id: clientId,
    merchant: { id: snapshot.merchant.id, name: snapshot.merchant.name },
    categories: snapshot.categories.map((c) => ({ id: c.id, name: c.name.slice(0, 120), position: c.position })),
    items: snapshot.items.map((i) => ({
      id: i.id,
      name: i.name.slice(0, 160),
      description: i.description ? i.description.slice(0, 2000) : null,
      price: i.price,
      status: i.status,
      categoryId: i.categoryId,
      complements: i.complements.map((g) => ({
        id: g.id,
        name: g.name.slice(0, 120),
        min: g.min !== null ? Math.max(0, Math.round(g.min)) : null,
        max: g.max !== null ? Math.max(0, Math.round(g.max)) : null,
        options: g.options.map((o) => ({ id: o.id, name: o.name.slice(0, 160), price: o.price })),
      })),
    })),
  }
}

/** Sugere o cliente do Orvia que corresponde à loja aberta no iFood. */
export function guessClient<T extends { id: string; name: string; ifood_merchant_id: string | null }>(
  clients: T[],
  snapshot: Pick<MenuSnapshot, 'merchant'> | null,
): T | null {
  if (!snapshot) return null
  const byId = snapshot.merchant.id ? clients.find((c) => c.ifood_merchant_id === snapshot.merchant.id) : undefined
  if (byId) return byId
  const name = snapshot.merchant.name?.trim().toLowerCase()
  if (!name) return null
  return clients.find((c) => c.name.trim().toLowerCase() === name) ?? clients.find((c) => c.name.toLowerCase().includes(name)) ?? null
}

const STATUS_PT: Record<string, string> = {
  active: 'Ativo',
  inactive: 'Pausado',
  out_of_stock: 'Em falta',
  paused: 'Pausado',
  unknown: '—',
}

export interface FieldChange {
  field: 'Nome' | 'Descrição' | 'Preço' | 'Status'
  before: string
  after: string
}

function brl(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return `R$ ${value.toFixed(2).replace('.', ',')}`
}

/**
 * O que precisa mudar no iFood para refletir o Orvia.
 * `current` é o item como está no iFood (snapshot); null = não existe lá.
 */
export function pendingChanges(pending: HubPendingItem, current: MenuItem | null): FieldChange[] {
  const target = {
    name: pending.name,
    description: pending.description ?? '',
    price: pending.price,
    status: pending.status === 'active' ? 'active' : 'paused',
  }
  if (!current) {
    return [
      { field: 'Nome', before: '—', after: target.name },
      { field: 'Descrição', before: '—', after: target.description || '—' },
      { field: 'Preço', before: '—', after: brl(target.price) },
      { field: 'Status', before: '—', after: STATUS_PT[pending.status] ?? pending.status },
    ]
  }
  const out: FieldChange[] = []
  if (current.name !== target.name) out.push({ field: 'Nome', before: current.name, after: target.name })
  if ((current.description ?? '') !== target.description) out.push({ field: 'Descrição', before: current.description || '—', after: target.description || '—' })
  if (current.price === null || Math.abs(current.price - target.price) >= 0.005) out.push({ field: 'Preço', before: brl(current.price), after: brl(target.price) })
  if (current.status !== target.status) out.push({ field: 'Status', before: STATUS_PT[current.status] ?? current.status, after: STATUS_PT[pending.status] ?? pending.status })
  return out
}

/** Encontra o item do snapshot correspondente ao pendente (pelo ID do iFood). */
export function findInSnapshot(snapshot: MenuSnapshot | null, pending: HubPendingItem): MenuItem | null {
  if (!snapshot || !pending.ifood_id) return null
  return snapshot.items.find((i) => i.id === pending.ifood_id) ?? null
}

/**
 * Converte a sugestão de combo (IDs do iFood) para componentes do Orvia.
 * Retorna null se algum item ainda não foi importado para o Orvia.
 */
export function comboComponentsFromIfood(
  ifoodIds: string[],
  quantities: number[],
  catalog: Pick<HubCatalog, 'items'>,
): { component_id: string; quantity: number }[] | null {
  const byIfood = new Map(catalog.items.filter((i) => i.kind === 'item' && i.ifood_id).map((i) => [i.ifood_id as string, i.id]))
  const out: { component_id: string; quantity: number }[] = []
  for (let index = 0; index < ifoodIds.length; index += 1) {
    const id = byIfood.get(ifoodIds[index]!)
    if (!id) return null
    out.push({ component_id: id, quantity: Math.max(1, Math.min(20, quantities[index] ?? 1)) })
  }
  return out
}
