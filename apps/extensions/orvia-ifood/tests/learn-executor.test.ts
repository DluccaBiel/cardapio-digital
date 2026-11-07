import { describe, expect, it } from 'vitest'
import { applyPending, applyRaw, desiredFromPending } from '../src/lib/executor'
import { learnFromWrite, type Observed } from '../src/lib/learn'
import type { HubPendingItem } from '../src/lib/hub'
import type { MenuItem } from '../src/core/schema'

/** Portal FICTÍCIO em memória: detalhe em centavos, escrita PUT do objeto inteiro. */
function fakePortal() {
  const db: Record<string, any> = {
    'IF-1': { id: 'IF-1', name: 'X-Burger', description: 'Carne 150g', price: { value: 3290 }, status: 'AVAILABLE', extras: ['a'] },
    'IF-2': { id: 'IF-2', name: 'Astro Bacon', description: 'Duplo', price: { value: 4150 }, status: 'AVAILABLE', extras: ['b'] },
  }
  const calls: { method: string; url: string; body?: unknown }[] = []
  const request = async (method: string, url: string, body?: unknown) => {
    calls.push({ method, url, body })
    const id = url.split('/').pop()!
    if (method === 'GET') return db[id] ? { status: 200, json: { data: structuredClone(db[id]) } } : { status: 404, json: null }
    if (method === 'PUT') {
      db[id] = structuredClone(body)
      return { status: 200, json: { ok: true } }
    }
    return { status: 405, json: null }
  }
  return { db, calls, request }
}

const items = new Map([
  ['IF-1', { price: 32.9, status: 'active' }],
  ['IF-2', { price: 41.5, status: 'active' }],
])

function observedEdit(change: (o: any) => void): { write: Observed; reads: Observed[] } {
  const before = { id: 'IF-1', name: 'X-Burger', description: 'Carne 150g', price: { value: 3290 }, status: 'AVAILABLE', extras: ['a'] }
  const after = structuredClone(before)
  change(after)
  return {
    reads: [{ method: 'GET', url: 'https://merchant-api.ifood.com.br/catalog/items/IF-1', json: { data: before }, at: 1 }],
    write: { method: 'PUT', url: 'https://merchant-api.ifood.com.br/catalog/items/IF-1', body: after, status: 200, at: 2 },
  }
}

const pending = (over: Partial<HubPendingItem>): HubPendingItem => ({
  id: 'orvia-2', etag: '"e"', kind: 'item', action: 'update', ifood_id: 'IF-2', name: 'Astro Bacon', description: 'Duplo',
  price: 41.5, status: 'active', category: null, addon_groups: [], components: [], combo_full_price: null, updated_at: '', ...over,
})
const snapItem = (over: Partial<MenuItem>): MenuItem => ({
  id: 'IF-2', name: 'Astro Bacon', description: 'Duplo', price: 41.5, originalPrice: null, status: 'active', hasImage: false,
  imageUrl: null, categoryId: null, categoryName: null, complements: [], available: true, ...over,
})

describe('learnFromWrite', () => {
  it('aprende preço em modo rmw (centavos, dentro de data)', () => {
    const { write, reads } = observedEdit((o) => (o.price.value = 3490))
    const r = learnFromWrite(write, reads, items)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.itemId).toBe('IF-1')
    expect(r.templates).toHaveLength(1)
    expect(r.templates[0]).toMatchObject({
      field: 'price', mode: 'rmw', method: 'PUT', unit: 'centavos', path: ['price', 'value'],
      urlTemplate: 'https://merchant-api.ifood.com.br/catalog/items/{id}', unwrap: ['data'],
    })
  })
  it('aprende status e os dois valores (ativo/pausado)', () => {
    const { write, reads } = observedEdit((o) => (o.status = 'UNAVAILABLE'))
    const r = learnFromWrite(write, reads, items)
    expect(r.ok && r.templates[0]).toMatchObject({ field: 'status', statusValues: { paused: 'UNAVAILABLE', active: 'AVAILABLE' } })
  })
  it('aprende nome e descrição juntos', () => {
    const { write, reads } = observedEdit((o) => { o.name = 'X-Burger Top'; o.description = 'Nova' })
    const r = learnFromWrite(write, reads, items)
    expect(r.ok && r.templates.map((t) => t.field).sort()).toEqual(['description', 'name'])
  })
  it('patch só quando o corpo não carrega outros dados do item', () => {
    const ok = learnFromWrite({ method: 'PATCH', url: 'https://x.ifood.com.br/items/IF-1/price', body: { price: 34.9 }, status: 200, at: 1 }, [], items)
    expect(ok.ok && ok.templates[0]).toMatchObject({ mode: 'patch', unit: 'reais', path: ['price'] })
    const unsafe = learnFromWrite({ method: 'PUT', url: 'https://x.ifood.com.br/items/IF-1', body: { price: 34.9, name: 'X', extra: 1 }, status: 200, at: 1 }, [], items)
    expect(unsafe.ok).toBe(false)
  })
  it('recusa quando não reconhece o item ou o portal recusou', () => {
    expect(learnFromWrite({ method: 'PUT', url: 'https://x/items/OUTRO', body: { price: 1 }, status: 200, at: 1 }, [], items).ok).toBe(false)
    expect(learnFromWrite({ method: 'PUT', url: 'https://x/items/IF-1', body: { price: 1 }, status: 400, at: 1 }, [], items).ok).toBe(false)
  })
})

describe('executor', () => {
  const learned = () => {
    const a = learnFromWrite(observedEdit((o) => (o.price.value = 3490)).write, observedEdit(() => {}).reads, items)
    const b = learnFromWrite(observedEdit((o) => (o.status = 'UNAVAILABLE')).write, observedEdit(() => {}).reads, items)
    if (!a.ok || !b.ok) throw new Error('learn falhou')
    return [...a.templates, ...b.templates]
  }

  it('aplica preço + status em outro item, só nos campos certos, e verifica', async () => {
    const portal = fakePortal()
    const p = pending({ price: 44.9, status: 'inactive' })
    const res = await applyPending(p, snapItem({}), learned(), portal.request)
    expect(res.ok).toBe(true)
    expect(portal.db['IF-2']).toEqual({ id: 'IF-2', name: 'Astro Bacon', description: 'Duplo', price: { value: 4490 }, status: 'UNAVAILABLE', extras: ['b'] })
    expect(res.rawBefore).toEqual({ price: 4150, status: 'AVAILABLE' })
    // 1 GET + 1 PUT + 1 GET de verificação (campos agrupados no mesmo endpoint)
    expect(portal.calls.map((c) => c.method)).toEqual(['GET', 'PUT', 'GET'])
  })

  it('simulação não envia nada', async () => {
    const portal = fakePortal()
    const res = await applyPending(pending({ price: 44.9 }), snapItem({}), learned(), portal.request, { dryRun: true })
    expect(res.ok).toBe(true)
    expect(res.dryRun?.[0]?.changes).toEqual([{ field: 'price', before: 4150, after: 4490 }])
    expect(portal.calls.every((c) => c.method === 'GET')).toBe(true)
    expect(portal.db['IF-2'].price.value).toBe(4150)
  })

  it('desfazer volta o valor bruto anterior', async () => {
    const portal = fakePortal()
    const templates = learned()
    const res = await applyPending(pending({ price: 44.9 }), snapItem({}), templates, portal.request)
    await applyRaw('IF-2', res.rawBefore, templates, portal.request)
    expect(portal.db['IF-2'].price.value).toBe(4150)
  })

  it('informa campos sem molde e itens novos', async () => {
    const portal = fakePortal()
    const missing = await applyPending(pending({ name: 'Novo nome' }), snapItem({}), learned(), portal.request)
    expect(missing).toMatchObject({ ok: false, missing: ['name'] })
    const novo = await applyPending(pending({ ifood_id: null, action: 'create' }), null, learned(), portal.request)
    expect(novo.ok).toBe(false)
    expect(portal.calls).toHaveLength(0)
  })

  it('para se o iFood recusar e não marca como aplicado', async () => {
    const portal = fakePortal()
    const failing = async (m: string, u: string, b?: unknown) => (m === 'PUT' ? { status: 500, json: null } : portal.request(m, u, b))
    const res = await applyPending(pending({ price: 44.9 }), snapItem({}), learned(), failing)
    expect(res.ok).toBe(false)
    expect(res.applied).toEqual([])
  })

  it('desiredFromPending só inclui o que difere', () => {
    expect(desiredFromPending(pending({ price: 44.9 }), snapItem({}))).toEqual({ price: 44.9 })
  })
})
