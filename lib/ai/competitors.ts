/**
 * Formato da pesquisa de concorrentes da região (somente fontes públicas, com link).
 * A pesquisa em si é feita pelo próprio sistema em `free-research.ts` — sem IA.
 */
export type CompetitorResearch = {
  notes: string
  competitors: { name: string; url: string | null; highlights: string[]; examples: { name: string; price: number | null }[] }[]
  insights: string[]
  sources: { title: string; url: string }[]
}
