/**
 * Pesquisa de concorrentes da região (somente fontes públicas, com citação).
 * Usa a ferramenta de busca do Claude; se falhar, o chamador segue sem concorrentes.
 */
import Anthropic from '@anthropic-ai/sdk'
import { AI_MODEL } from './optimize'

export type CompetitorResearch = {
  notes: string
  competitors: { name: string; url: string | null; highlights: string[]; examples: { name: string; price: number | null }[] }[]
  insights: string[]
  sources: { title: string; url: string }[]
}

const SYSTEM = `Você pesquisa concorrentes de delivery para um restaurante no Brasil.
Use APENAS informações públicas encontradas na busca (cardápios públicos, sites, páginas de lojas). Não invente preços nem lojas.
Responda SOMENTE com JSON válido neste formato:
{"competitors":[{"name":"","url":null,"highlights":["..."],"examples":[{"name":"","price":0}]}],"insights":["..."]}
Máximo 5 concorrentes, 3 highlights cada, 4 exemplos cada. Preço em reais ou null se não encontrar. Português do Brasil.`

export async function researchCompetitors(opts: { niche: string; city: string; restaurant: string; strategy?: string; strategyBrief?: string; signal?: AbortSignal }): Promise<CompetitorResearch | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null
  try {
    const client = new Anthropic()
    const res = await client.messages.create(
      {
        model: AI_MODEL,
        max_tokens: 4000,
        system: SYSTEM,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
        messages: [
          {
            role: 'user',
            content: `Segmento: ${opts.niche}. Região: ${opts.city.slice(0, 80)}. Restaurante cliente: ${opts.restaurant.slice(0, 80)}.\nLevante SOMENTE concorrentes do mesmo nicho (${opts.niche.slice(0, 80)}) na região, no iFood/sites públicos: faixa de preço dos itens equivalentes, combos, descrições e destaques.${opts.strategyBrief ? `\nEstratégia do gestor (use para escolher o que observar): ${opts.strategyBrief.slice(0, 500)}` : ''}`,
          },
        ],
      },
      { signal: opts.signal },
    )
    let text = ''
    const sources = new Map<string, string>()
    for (const block of res.content) {
      if (block.type === 'text') {
        text += block.text
        for (const c of block.citations ?? []) {
          if (c.type === 'web_search_result_location' && c.url) sources.set(c.url, c.title ?? c.url)
        }
      }
    }
    const json = /\{[\s\S]*\}/.exec(text)?.[0]
    if (!json) return null
    const raw = JSON.parse(json) as { competitors?: any[]; insights?: unknown[] }
    const competitors = (raw.competitors ?? []).slice(0, 5).map((c) => ({
      name: String(c?.name ?? '').slice(0, 80),
      url: typeof c?.url === 'string' && /^https?:\/\//.test(c.url) ? c.url.slice(0, 300) : null,
      highlights: (Array.isArray(c?.highlights) ? c.highlights : []).slice(0, 3).map((h: unknown) => String(h).slice(0, 200)),
      examples: (Array.isArray(c?.examples) ? c.examples : []).slice(0, 4).map((e: any) => ({
        name: String(e?.name ?? '').slice(0, 80),
        price: typeof e?.price === 'number' && e.price > 0 && e.price < 10000 ? e.price : null,
      })),
    })).filter((c) => c.name)
    const insights = (raw.insights ?? []).slice(0, 6).map((i) => String(i).slice(0, 240))
    if (!competitors.length && !insights.length) return null
    const notes = [
      ...insights.map((i) => `- ${i}`),
      ...competitors.map((c) => `- ${c.name}: ${c.highlights.join('; ')}${c.examples.length ? ` (ex.: ${c.examples.map((e: { name: string; price: number | null }) => `${e.name}${e.price ? ` R$ ${e.price}` : ''}`).join(', ')})` : ''}`),
    ].join('\n')
    return { notes, competitors, insights, sources: Array.from(sources).slice(0, 10).map(([url, title]) => ({ title, url })) }
  } catch {
    return null
  }
}
