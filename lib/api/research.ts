/**
 * Pesquisa do Undercut (servidor) — SEM IA.
 *
 * As extensões (e o painel) pedem uma pesquisa pelo endpoint `POST /api/v1/research`
 * (escopo `pesquisa:ler`). O próprio sistema faz a busca em fontes públicas e devolve
 * os resultados direto para quem pediu (a extensão), com título, trecho e link.
 * Nada é inventado: só o que a busca pública encontrou. Falha de rede nunca derruba
 * a chamada: devolve status "indisponivel".
 */
import { isPublicUrl, searchWeb } from '../ai/free-research'

export type ResearchSource = { title: string; url: string }

export type ResearchAnswer = {
  /** Resposta em texto (markdown simples, sem HTML). */
  answer: string
  sources: ResearchSource[]
  /** Sempre 'sistema': busca feita pelo próprio Undercut, sem IA. */
  mode: 'sistema'
  status: 'ok' | 'indisponivel'
  notices: string[]
  /** ISO da resposta. */
  answered_at: string
}

function clamp(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}

/** Busca pública feita pelo sistema; monta a resposta com os trechos e links encontrados. */
async function systemAnswer(question: string, maxSources: number): Promise<ResearchAnswer> {
  const hits = (await searchWeb(question)).filter((h) => isPublicUrl(h.url))
  const seen = new Set<string>()
  const sources: ResearchSource[] = []
  for (const h of hits) {
    if (sources.length >= maxSources) break
    if (seen.has(h.url)) continue
    seen.add(h.url)
    sources.push({ title: clamp(h.title || h.url, 120), url: h.url })
  }
  if (!sources.length) {
    return {
      answer: 'Não encontrei fontes públicas suficientes para responder agora. Tente reformular a pergunta com cidade, segmento ou nome do produto.',
      sources: [],
      mode: 'sistema',
      status: 'indisponivel',
      notices: ['A busca pública não retornou resultados agora.'],
      answered_at: new Date().toISOString(),
    }
  }
  const lines = hits
    .slice(0, maxSources)
    .map((h, i) => `${i + 1}. ${h.title || h.url}\n   ${clamp(h.snippet || 'Sem resumo disponível.', 240)}\n   ${h.url}`)
  return {
    answer: `Encontrei ${sources.length} referência(s) pública(s) para “${clamp(question, 120)}”:\n\n${lines.join('\n\n')}\n\nResumo: as fontes acima foram coletadas da busca pública. Confirme preços e condições diretamente nos links antes de decidir.`,
    sources,
    mode: 'sistema',
    status: 'ok',
    notices: ['Busca feita pelo próprio Undercut em fontes públicas, sem IA.'],
    answered_at: new Date().toISOString(),
  }
}

export async function researchAnswer(input: { question: string; context?: string; max_sources?: number }): Promise<ResearchAnswer> {
  const question = input.question.trim()
  const maxSources = Math.min(Math.max(input.max_sources ?? 5, 1), 8)
  return systemAnswer(question, maxSources)
}
