import { describe, expect, it } from 'vitest'
import { buildResearch, comboIdeas, extractMenuLines, freeSuggest, parseSearchResults, priceIdeas, similarity, toNinety, usableHit } from '../lib/ai/free-core'
import { isPublicUrl } from '../lib/ai/free-research'

const DDG = `<div class="result"><h2 class="result__title"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.pizzariaexemplo.com.br%2Fcardapio&amp;rut=abc">Pizzaria Exemplo - Cardápio &amp; Delivery</a></h2>
<a class="result__snippet" href="x">Peça pizzas <b>grandes</b> com entrega rápida na Asa Norte.</a></div>
<div class="result"><a class="result__a" href="https://www.instagram.com/foo">Insta</a><a class="result__snippet" href="x">insta</a></div>
<div class="result"><a class="result__a" href="https://pizzas2.com.br/menu">Pizzas 2</a><a class="result__snippet" href="x">outra</a></div>`

const PAGE = `<html><body><h1>Cardápio</h1>
<div><h3>Pizza Calabresa Grande</h3><p>molho, calabresa e cebola</p><span>R$ 49,90</span></div>
<div><h3>Pizza Mussarela Grande</h3><span>R$ 44,90</span></div>
<div>Pizza Portuguesa Grande - R$ 54,90</div>
<div><h3>Refrigerante Lata</h3><span>R$ 6,00</span></div>
<div><h3>Combo Família + Refri 2L</h3><span>R$ 89,90</span></div></body></html>`

const LD = `<script type="application/ld+json">{"@type":"Restaurant","hasMenu":{"@type":"Menu","hasMenuSection":[{"@type":"MenuSection","hasMenuItem":[{"@type":"MenuItem","name":"Esfiha de carne","offers":{"@type":"Offer","price":"4.50"}},{"@type":"MenuItem","name":"Esfiha de queijo","offers":{"price":4.9}},{"@type":"MenuItem","name":"Kibe","offers":{"price":"7,50"}}]}]}}</script>`

describe('pesquisa gratuita — parsers', () => {
  it('lê resultados do DuckDuckGo, decodifica a URL real e o snippet', () => {
    const r = parseSearchResults(DDG)
    expect(r).toHaveLength(3)
    expect(r[0]).toMatchObject({ url: 'https://www.pizzariaexemplo.com.br/cardapio', title: 'Pizzaria Exemplo - Cardápio & Delivery' })
    expect(r[0]!.snippet).toContain('pizzas grandes')
    expect(r.filter(usableHit).map((h) => h.url)).toEqual(['https://www.pizzariaexemplo.com.br/cardapio', 'https://pizzas2.com.br/menu'])
  })
  it('extrai itens e preços de HTML simples (nome acima, nome na mesma linha)', () => {
    const l = extractMenuLines(PAGE)
    const by = Object.fromEntries(l.map((x) => [x.name, x.price]))
    expect(by['Pizza Calabresa Grande']).toBe(49.9)
    expect(by['Pizza Mussarela Grande']).toBe(44.9)
    expect(by['Pizza Portuguesa Grande']).toBe(54.9)
    expect(by['Refrigerante Lata']).toBe(6)
  })
  it('extrai de JSON-LD (Menu/MenuItem)', () => {
    const l = extractMenuLines(LD)
    expect(l.map((x) => x.name)).toEqual(['Esfiha de carne', 'Esfiha de queijo', 'Kibe'])
    expect(l.map((x) => x.price)).toEqual([4.5, 4.9, 7.5])
  })
  it('bloqueia URLs não públicas (SSRF)', () => {
    for (const u of ['http://localhost:3000', 'http://127.0.0.1/x', 'http://10.0.0.5', 'https://servico.internal/a', 'file:///etc/passwd', 'http://[::1]/']) expect(isPublicUrl(u)).toBe(false)
    expect(isPublicUrl('https://www.pizzariaexemplo.com.br/cardapio')).toBe(true)
  })
  it('utilidades', () => {
    expect(toNinety(10)).toBeCloseTo(9.9)
    expect(toNinety(10.6)).toBeCloseTo(10.9)
    expect(similarity('Pizza Calabresa G', 'Pizza Calabresa Grande')).toBeGreaterThanOrEqual(0.6)
    expect(similarity('Pizza Calabresa', 'Esfiha de queijo')).toBe(0)
  })
})

describe('modo gratuito — ideias', () => {
  const research = buildResearch([{ hit: { title: 'Pizzaria Exemplo - Cardápio', url: 'https://www.pizzariaexemplo.com.br/cardapio', snippet: 'Pizzas grandes' }, lines: extractMenuLines(PAGE) }], { niche: 'pizzaria', city: 'Brasília' })!
  const items = [
    { id: 'a', ifood_id: '1', name: 'Pizza Calabresa G', price: 40, description: null },
    { id: 'b', ifood_id: '2', name: 'Pizza Mussarela G', price: 44.9, description: null },
    { id: 'c', ifood_id: '3', name: 'Coca-Cola Lata', price: 6, description: null },
    { id: 'd', ifood_id: '4', name: 'Esfiha de Carne', price: 5, description: null },
    { id: 'e', ifood_id: '5', name: 'Suco 500ml', price: 9, description: null },
  ]
  it('pesquisa vira concorrentes com exemplos, fontes e aviso de que é sem IA', () => {
    expect(research.competitors[0]!.name).toBe('Pizzaria Exemplo')
    expect(research.competitors[0]!.highlights.some((h) => /Combo/.test(h))).toBe(true)
    expect(research.sources[0]!.url).toContain('pizzariaexemplo')
    expect(research.insights.join(' ')).toMatch(/sem IA/)
  })
  it('preço: só mexe onde há referência equivalente, dentro do limite e terminado em ,90', () => {
    const u = priceIdeas(items, research, 10)
    expect(u.map((x) => x.item_name)).toEqual(['Pizza Calabresa G']) // mussarela já está no preço; bebida/esfiha sem referência
    expect(u[0]!.after.price).toBeCloseTo(43.9, 1)
    expect(u[0]!.after.price).toBeLessThanOrEqual(40 * 1.1 + 0.01)
    expect(u[0]!.reason).toMatch(/Concorrentes da região/)
    expect(priceIdeas(items, research, 0)).toEqual([])
    expect(priceIdeas(items, null, 10)).toEqual([])
  })
  it('combos: prato + bebida com economia e rodada diferente a cada versão', () => {
    const v1 = comboIdeas(items, research, 1)
    const v2 = comboIdeas(items, research, 2)
    expect(v1.length).toBeGreaterThan(0)
    for (const c of v1) { expect(c.price).toBeLessThan(c.full_price); expect(c.components).toHaveLength(2) }
    expect(v1.map((c) => c.name).join()).not.toBe(v2.map((c) => c.name).join())
  })
  it('freeSuggest funciona sem pesquisa (só combos)', () => {
    const r = freeSuggest(items, null, { maxPct: 10, variant: 1 })
    expect(r.updates).toEqual([])
    expect(r.combos.length).toBeGreaterThan(0)
    expect(r.summary).toMatch(/Modo gratuito/)
  })
})
