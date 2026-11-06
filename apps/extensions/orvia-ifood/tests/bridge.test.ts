import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { finalizeSnapshot, normalizeMenuPayload } from '../src/core/normalize'
import type { MenuSnapshot } from '../src/core/schema'
import { comboComponentsFromIfood, findInSnapshot, guessClient, pendingChanges, snapshotToImport } from '../src/lib/bridge'
import type { HubPendingItem } from '../src/lib/hub'

const payload = JSON.parse(readFileSync(new URL('./fixtures/menu-payload.json', import.meta.url), 'utf8'))

function snapshot(): MenuSnapshot {
  const s = normalizeMenuPayload(payload, { origin: 'passive', requestPath: '/v1/menu', domUrl: 'https://portal.ifood.com.br/menu' })
  if (!s) throw new Error('normalização falhou')
  return finalizeSnapshot(s)
}

const pendingBase: HubPendingItem = {
  id: '00000000-0000-4000-8000-000000000001',
  etag: '"2026-11-06T12:00:00.123456+00:00"',
  kind: 'item',
  action: 'update',
  ifood_id: 'IF-ITEM-1',
  name: 'X-Burger Clássico (Demo)',
  description: 'Hambúrguer 150g, queijo e molho da casa',
  price: 34.9,
  status: 'active',
  category: 'Lanches',
  addon_groups: [],
  components: [],
  combo_full_price: null,
  updated_at: '2026-11-06T12:00:00.123456+00:00',
}

describe('normalização do payload (fixture fictícia)', () => {
  it('lê loja, categorias, produtos e complementos', () => {
    const s = snapshot()
    expect(s.merchant).toEqual({ id: 'MERCHANT-DEMO-1', name: 'Hamburgueria Astro (Demo)' })
    expect(s.categories.map((c) => c.name)).toEqual(['Lanches', 'Bebidas'])
    expect(s.items).toHaveLength(4)
    const burger = s.items.find((i) => i.id === 'IF-ITEM-1')!
    expect(burger.price).toBe(32.9)
    expect(burger.complements[0]?.options.map((o) => o.name)).toEqual(['Bacon extra', 'Queijo extra'])
    expect(s.id).toMatch(/^snap_/)
  })
})

describe('snapshotToImport', () => {
  it('gera o corpo da importação com IDs do iFood e sem campos extras', () => {
    const body = snapshotToImport(snapshot(), 'client-uuid')
    expect(body.client_id).toBe('client-uuid')
    expect(body.merchant.id).toBe('MERCHANT-DEMO-1')
    expect(body.categories[0]).toEqual({ id: 'IF-CAT-1', name: 'Lanches', position: 0 })
    const burger = body.items.find((i) => i.id === 'IF-ITEM-1')!
    expect(burger).toMatchObject({ name: 'X-Burger Clássico (Demo)', price: 32.9, categoryId: 'IF-CAT-1' })
    expect(burger.complements[0]).toMatchObject({ id: 'IF-G-1', min: 0, max: 3 })
    expect(Object.keys(burger).sort()).toEqual(['categoryId', 'complements', 'description', 'id', 'name', 'price', 'status'])
  })
})

describe('guessClient', () => {
  const clients = [
    { id: 'a', name: 'Pizzaria do Ze (Demo)', ifood_merchant_id: null },
    { id: 'b', name: 'Outro nome', ifood_merchant_id: 'MERCHANT-DEMO-1' },
    { id: 'c', name: 'Hamburgueria Astro (Demo)', ifood_merchant_id: null },
  ]
  it('prioriza o ID da loja vinculado', () => {
    expect(guessClient(clients, snapshot())?.id).toBe('b')
  })
  it('cai para o nome quando não há vínculo', () => {
    expect(guessClient(clients.filter((c) => c.id !== 'b'), snapshot())?.id).toBe('c')
  })
  it('null sem snapshot', () => {
    expect(guessClient(clients, null)).toBeNull()
  })
})

describe('pendingChanges', () => {
  it('mostra só o que mudou (preço)', () => {
    const s = snapshot()
    const changes = pendingChanges(pendingBase, findInSnapshot(s, pendingBase))
    expect(changes).toEqual([{ field: 'Preço', before: 'R$ 32,90', after: 'R$ 34,90' }])
  })
  it('pausado no Orvia vs ativo no iFood vira mudança de status', () => {
    const s = snapshot()
    const changes = pendingChanges({ ...pendingBase, price: 32.9, status: 'inactive' }, findInSnapshot(s, pendingBase))
    expect(changes).toEqual([{ field: 'Status', before: 'Ativo', after: 'Pausado' }])
  })
  it('item novo lista todos os campos', () => {
    const changes = pendingChanges({ ...pendingBase, action: 'create', ifood_id: null }, null)
    expect(changes.map((c) => c.field)).toEqual(['Nome', 'Descrição', 'Preço', 'Status'])
    expect(changes.every((c) => c.before === '—')).toBe(true)
  })
  it('iguais → nenhuma mudança', () => {
    const s = snapshot()
    expect(pendingChanges({ ...pendingBase, price: 32.9 }, findInSnapshot(s, pendingBase))).toEqual([])
  })
})

describe('comboComponentsFromIfood', () => {
  const catalog = {
    items: [
      { id: 'o1', kind: 'item' as const, ifood_id: 'IF-ITEM-1' },
      { id: 'o3', kind: 'item' as const, ifood_id: 'IF-ITEM-3' },
      { id: 'c1', kind: 'combo' as const, ifood_id: 'IF-COMBO' },
    ],
  } as any
  it('mapeia IDs do iFood para IDs do Orvia', () => {
    expect(comboComponentsFromIfood(['IF-ITEM-1', 'IF-ITEM-3'], [1, 2], catalog)).toEqual([
      { component_id: 'o1', quantity: 1 },
      { component_id: 'o3', quantity: 2 },
    ])
  })
  it('null se algum item não foi importado', () => {
    expect(comboComponentsFromIfood(['IF-ITEM-1', 'IF-ITEM-9'], [1, 1], catalog)).toBeNull()
  })
  it('não aceita combo como componente', () => {
    expect(comboComponentsFromIfood(['IF-COMBO', 'IF-ITEM-1'], [1, 1], catalog)).toBeNull()
  })
})
