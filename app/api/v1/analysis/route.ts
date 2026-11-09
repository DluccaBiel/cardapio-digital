import { authenticate, isResponse } from '@/lib/api/auth'
import { err, ok, preflight, readJson } from '@/lib/api/http'
import { z } from 'zod'
import { GOALS, suggestOptimizations } from '@/lib/ai/optimize'
import { researchCompetitors } from '@/lib/ai/competitors'
import { loadCatalog } from '@/lib/menu/load'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'
export const maxDuration = 120
export const OPTIONS = preflight

const bodySchema = z.object({
  client_id: z.string().uuid(),
  goal: z.enum(Object.keys(GOALS) as [keyof typeof GOALS, ...(keyof typeof GOALS)[]]),
  niche: z.string().max(80).default(''),
  city: z.string().max(80).default(''),
  notes: z.string().max(1200).optional(),
  strategy: z.enum(['mercado', 'competitivo', 'premium', 'combos']).default('mercado'),
  strategy_brief: z.string().max(600).optional(),
  competitors: z.boolean().default(false),
  max_price_change_pct: z.number().min(0).max(30).default(10),
})

/**
 * Análise do cardápio (IA + concorrentes públicos da região). NÃO grava nada:
 * devolve sugestões no formato que a extensão converte em "o que será feito".
 * Falha da IA/concorrentes nunca derruba a resposta — vem com ai_status/competitors_status.
 */
export async function POST(req: Request) {
  const auth = await authenticate(req, 'catalogo:ler')
  if (isResponse(auth)) return auth
  const parsed = bodySchema.safeParse(await readJson(req))
  if (!parsed.success) return err(req, 'validation_failed', `Pedido inválido: ${parsed.error.issues[0]?.path.join('.')} ${parsed.error.issues[0]?.message}`)
  const b = parsed.data

  const catalog = await loadCatalog(auth.ctx.db, auth.workspaceId, b.client_id)
  if (!catalog) return err(req, 'not_found', 'Cliente não encontrado.')
  if (catalog.items.length === 0) return err(req, 'validation_failed', 'O cliente ainda não tem produtos no Orvia. Sincronize o cardápio primeiro.')

  const notices: string[] = []
  let competitorsStatus: 'ok' | 'indisponivel' | 'desligado' = 'desligado'
  let research = null as Awaited<ReturnType<typeof researchCompetitors>>
  if (b.competitors && b.city.trim()) {
    research = await researchCompetitors({ niche: b.niche, city: b.city, restaurant: catalog.client.name, strategy: b.strategy, strategyBrief: b.strategy_brief })
    competitorsStatus = research ? 'ok' : 'indisponivel'
    if (!research) notices.push('Não consegui pesquisar concorrentes agora; a análise usou só o seu cardápio.')
  }

  const notes = [b.strategy_brief ? `Estratégia escolhida pelo gestor: ${b.strategy_brief}` : null, b.notes, research ? `Referências públicas de concorrentes da região (use como contexto, não copie):\n${research.notes}` : null].filter(Boolean).join('\n\n')
  const result = await suggestOptimizations(catalog, { goal: b.goal, notes: notes || undefined, maxPriceChangePct: b.max_price_change_pct })
  if (!result.ok) {
    await audit({ workspaceId: auth.workspaceId, actorType: 'api_key', actorId: auth.keyId, action: 'analysis.failed', entityType: 'client', entityId: b.client_id })
    return err(req, 'internal', result.error)
  }

  const byId = new Map(catalog.items.map((i) => [i.id, i]))
  const fromComp = (r: string) => Boolean(research) && /concorrent|regi[aã]o/i.test(r)
  const data = {
    summary: result.data.summary,
    updates: result.data.updates.map((u) => ({
      ifood_id: byId.get(u.item_id)?.ifood_id ?? null,
      item_name: u.item_name,
      before: u.before,
      after: u.after,
      reason: u.reason,
      from_competitors: fromComp(u.reason),
    })),
    combos: result.data.combos.map((c) => ({
      name: c.name,
      description: c.description,
      components: c.components.map((k) => ({ ifood_id: byId.get(k.component_id)?.ifood_id ?? null, name: k.name, quantity: k.quantity })),
      price: c.price,
      full_price: c.full_price,
      reason: c.reason,
      from_competitors: fromComp(c.reason),
    })),
    competitors: research?.competitors ?? [],
    insights: research?.insights ?? [],
    sources: research?.sources ?? [],
    competitors_status: competitorsStatus,
    ai_status: 'ok' as const,
    notices,
  }
  await audit({
    workspaceId: auth.workspaceId,
    actorType: 'api_key',
    actorId: auth.keyId,
    action: 'analysis.created',
    entityType: 'client',
    entityId: b.client_id,
    metadata: { goal: b.goal, updates: data.updates.length, combos: data.combos.length, competitors: competitorsStatus },
  })
  return ok(req, data)
}
