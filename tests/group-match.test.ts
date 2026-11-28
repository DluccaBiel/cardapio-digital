import { describe, expect, it } from 'vitest'
import { matchGroups } from '../lib/reports/group-match'

describe('matchGroups', () => {
  const groups = [
    { jid: '1@g.us', name: 'Chamas Pizzas | Resultados' },
    { jid: '2@g.us', name: 'Marabôian - Alpha' },
    { jid: '3@g.us', name: 'Pizzaria Dantas' },
    { jid: '4@g.us', name: 'Família' },
  ]
  it('conecta por palavras do nome, ignorando acento e "CA"', () => {
    const r = matchGroups(
      [
        { id: 'a', name: 'Chamas Pizzas' },
        { id: 'b', name: 'Marabôian Pizzaria Delivery' },
        { id: 'c', name: 'Pizzaria Dantas' },
        { id: 'd', name: 'Cliente sem grupo' },
      ],
      groups,
    )
    expect(r.map((x) => [x.id, x.group.jid]).sort()).toEqual([
      ['a', '1@g.us'],
      ['c', '3@g.us'],
    ])
  })
})

import { rankGroups } from '../lib/reports/group-match'
describe('rankGroups', () => {
  it('ordena do mais parecido ao menos', () => {
    const r = rankGroups('Chamas Pizzas', [
      { jid: '1', name: 'Pizzas Brasil' },
      { jid: '2', name: 'Chamas Pizzas | Resultados' },
      { jid: '3', name: 'Família' },
    ])
    expect(r.map((x) => x.group.jid)).toEqual(['2', '1'])
  })
})
