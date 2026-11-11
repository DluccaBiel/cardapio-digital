import { authenticate, isResponse } from '@/lib/api/auth'
import { err, ok, preflight, readJson } from '@/lib/api/http'
import { z } from 'zod'
import { GOALS, suggestOptimizations } from '@/lib/ai/optimize'
import { researchCompetitors } from '@/lib/ai/competitors'
import { researchFree } from '@/lib/ai/free-research'
import { freeSuggest, requestNotices, requiredComboIdeas, type FreeItem } from '@/lib/ai/free-core'
import { parseRequest } from '@/lib/ai/request'
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
  /** número da rodada (v1, v2…): faz as ideias do modo gratuito mudarem a cada rodada */
  variant: z.number().int().min(1).max(50).default(1),
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
    // 1º a pesquisa com IA (se houver chave); sem chave ou se falhar → pesquisa pública gratuita (sem token)
    research = (await researchCompetitors({ niche: b.niche, city: b.city, restaurant: catalog.client.name, strategy: b.strategy, strategyBrief: b.strategy_brief })) ?? (await researchFree({ niche: b.niche, city: b.city }))
    competitorsStatus = research ? 'ok' : 'indisponivel'
    if (!research) notices.push('Não consegui pesquisar concorrentes agora; a análise usou só o seu cardápio.')
  }

  const notes = [b.strategy_brief ? `Estratégia escolhida pelo gestor: ${b.strategy_brief}` : null, b.notes, research ? `Referências públicas de concorrentes da região (use como contexto, não copie):\n${research.notes}` : null].filter(Boolean).join('\n\n')
  const freeItems: FreeItem[] = (catalog.items as any[]).map((i) => ({ id: String(i.id), ifood_id: i.ifood_id ?? null, name: String(i.name), price: Number(i.price ?? i.base_price ?? 0) || null, description: i.description ?? null, kind: i.kind, status: i.status }))
  // Pedido do gestor ao "refazer" (ex.: "novos combos com coca cola 2l") → itens obrigatórios + ideias reprovadas
  const request = parseRequest(b.notes, freeItems.filter((i) => (i.kind ?? 'item') === 'item' && (i.status ?? 'active') === 'active'), b.strategy)
  // Sem chave da Anthropic: modo gratuito (regras + concorrentes públicos). Com chave: IA como antes (e, se a IA falhar, cai no gratuito).
  const freeMode = !process.env.ANTHROPIC_API_KEY
  let result: Awaited<ReturnType<typeof suggestOptimizations>>
  let aiStatus: 'ok' | 'regras' = 'ok'
  let understood: string[] = []
  const freeResult = () => {
    const data = freeSuggest(freeItems, research, { maxPct: b.max_price_change_pct, variant: b.variant, notes: b.notes, strategy: b.strategy })
    understood = data.understood
    return { ok: true as const, data: data as any } as Awaited<ReturnType<typeof suggestOptimizations>>
  }
  if (freeMode) {
    result = freeResult()
    aiStatus = 'regras'
    notices.push('Modo gratuito: ideias por regras e pesquisa pública, sem IA. Para ideias mais criativas, configure ANTHROPIC_API_KEY.')
  } else {
    result = await suggestOptimizations(catalog, {
      goal: b.goal,
      notes: notes || undefined,
      maxPriceChangePct: b.max_price_change_pct,
      requiredItemIds: request.required.map((r) => r.id),
      rejected: request.rejected || undefined,
    })
    if (!result.ok) {
      result = freeResult()
      aiStatus = 'regras'
      notices.push('A IA não respondeu agora; usei o modo gratuito (regras + pesquisa pública).')
    } else if (request.required.length) {
      // A IA tem de respeitar o pedido: se nenhum combo trouxe o item pedido, completa com combos calculados por regra
      const req = new Set(request.required.map((r) => r.id))
      const hits = result.data.combos.filter((c) => c.components.some((k) => req.has(k.component_id))).length
      if (!hits) {
        const extra = requiredComboIdeas(freeItems, request.required, b.variant, request.rejected)
        result.data.combos = [...extra, ...result.data.combos].slice(0, 5)
      }
      understood = requestNotices(request, hits || result.data.combos.filter((c) => c.components.some((k) => req.has(k.component_id))).length)
    } else understood = requestNotices(request, 0)
  }
  notices.unshift(...understood)
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
    ai_status: aiStatus,
    notices,
  }
  await audit({
    workspaceId: auth.workspaceId,
    actorType: 'api_key',
    actorId: auth.keyId,
    action: 'analysis.created',
    entityType: 'client',
    entityId: b.client_id,
    metadata: { goal: b.goal, mode: aiStatus, updates: data.updates.length, combos: data.combos.length, competitors: competitorsStatus },
  })
  return ok(req, data)
}
