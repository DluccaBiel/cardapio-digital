import { authenticate, isResponse } from '@/lib/api/auth'
import { err, ok, preflight, readJson } from '@/lib/api/http'
import { z } from 'zod'
import { GOALS } from '@/lib/ai/goals'
import { researchFree } from '@/lib/ai/free-research'
import { freeSuggest, type FreeItem } from '@/lib/ai/free-core'
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
  /** número da rodada (v1, v2…): faz as ideias mudarem a cada rodada */
  variant: z.number().int().min(1).max(50).default(1),
})

/**
 * Análise do cardápio feita pelo próprio sistema (regras + concorrentes públicos da região), SEM IA.
 * NÃO grava nada: devolve sugestões no formato que a extensão converte em "o que será feito".
 * Falha da pesquisa de concorrentes nunca derruba a resposta — vem com competitors_status.
 * `ai_status` continua no contrato por compatibilidade e é sempre 'regras'.
 */
export async function POST(req: Request) {
  const auth = await authenticate(req, 'catalogo:ler')
  if (isResponse(auth)) return auth
  const parsed = bodySchema.safeParse(await readJson(req))
  if (!parsed.success) return err(req, 'validation_failed', `Pedido inválido: ${parsed.error.issues[0]?.path.join('.')} ${parsed.error.issues[0]?.message}`)
  const b = parsed.data

  const catalog = await loadCatalog(auth.ctx.db, auth.workspaceId, b.client_id)
  if (!catalog) return err(req, 'not_found', 'Cliente não encontrado.')
  if (catalog.items.length === 0) return err(req, 'validation_failed', 'O cliente ainda não tem produtos no Undercut. Sincronize o cardápio primeiro.')

  const notices: string[] = []
  let competitorsStatus: 'ok' | 'indisponivel' | 'desligado' = 'desligado'
  let research = null as Awaited<ReturnType<typeof researchFree>>
  if (b.competitors && b.city.trim()) {
    // Pesquisa pública feita pelo sistema (sem IA)
    research = await researchFree({ niche: b.niche, city: b.city })
    competitorsStatus = research ? 'ok' : 'indisponivel'
    if (!research) notices.push('Não consegui pesquisar concorrentes agora; a análise usou só o seu cardápio.')
  }

  const freeItems: FreeItem[] = (catalog.items as any[]).map((i) => ({ id: String(i.id), ifood_id: i.ifood_id ?? null, name: String(i.name), price: Number(i.price ?? i.base_price ?? 0) || null, description: i.description ?? null, kind: i.kind, status: i.status }))
  // Ideias por regras + concorrentes públicos, sempre pelo próprio sistema.
  const aiStatus = 'regras' as const
  const freeData = freeSuggest(freeItems, research, { maxPct: b.max_price_change_pct, variant: b.variant, notes: b.notes, strategy: b.strategy })
  const understood: string[] = freeData.understood
  const result = { ok: true as const, data: freeData }
  notices.unshift(...understood)

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
