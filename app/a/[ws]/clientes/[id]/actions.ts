'use server'

import { z } from 'zod'
import { getWorkspaceBySlug } from '../../../../../lib/db/workspaces'
import { spDate } from '../../../../../lib/meta/api'
import { MetaError, metaConfig } from '../../../../../lib/meta/graph'
import { addBase, fetchAccountSeries, fetchStatuses, fetchStructure, finalize, ZERO, type DayPoint, type Metrics, type StructNode } from '../../../../../lib/meta/insights'
import { workspaceTokens } from '../../../../../lib/meta/sync'
import { createServerClient } from '../../../../../lib/supabaseServer'

/**
 * Apresentação do cliente: dados REAIS da Meta, lidos na hora com o token da conexão
 * do portfólio da conta (ou o token legado). Leitura das contas com a sessão (RLS).
 */

const ISO = /^\d{4}-\d{2}-\d{2}$/
const rangeSchema = z
  .object({ preset: z.enum(['7d', '14d', '30d', 'custom']), since: z.string().regex(ISO).optional(), until: z.string().regex(ISO).optional() })
  .strict()
type RangeInput = z.infer<typeof rangeSchema>
export type Range = { since: string; until: string }

function shift(day: string, days: number) {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
const diff = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000)

/** Período pedido (fuso de SP, até ontem) e o anterior de mesmo tamanho. */
function resolveRange(input: RangeInput): { cur: Range; prev: Range } | null {
  const yesterday = spDate(-1)
  const today = spDate(0)
  let cur: Range
  if (input.preset === 'custom') {
    if (!input.since || !input.until || input.since > input.until || input.until > today) return null
    if (diff(input.since, input.until) > 366) return null
    cur = { since: input.since, until: input.until }
  } else {
    const n = input.preset === '7d' ? 7 : input.preset === '14d' ? 14 : 30
    cur = { since: shift(yesterday, -(n - 1)), until: yesterday }
  }
  const len = diff(cur.since, cur.until) + 1
  return { cur, prev: { since: shift(cur.since, -len), until: shift(cur.since, -1) } }
}

type Account = { id: string; external_account_id: string; name: string; meta_business_id: string | null; is_watched: boolean }
type Ctx = { accounts: Account[]; tokenFor: (a: Account) => string | null; clientName: string }

async function clientCtx(ws: string, clientId: string): Promise<Ctx | { error: string }> {
  if (!z.string().uuid().safeParse(clientId).success) return { error: 'Cliente inválido.' }
  const workspace = await getWorkspaceBySlug(ws)
  if (!workspace) return { error: 'Workspace não encontrado.' }
  const db = createServerClient()
  const { data: u } = await db.auth.getUser()
  if (!u.user) return { error: 'Sessão expirada. Entre de novo.' }

  const [{ data: client }, { data: rows }] = await Promise.all([
    db.from('clients').select('id, name').eq('workspace_id', workspace.id).eq('id', clientId).maybeSingle(),
    db.from('ad_accounts').select('id, external_account_id, name, meta_business_id, is_watched').eq('workspace_id', workspace.id).eq('client_id', clientId).eq('platform', 'meta'),
  ])
  if (!client) return { error: 'Cliente não encontrado.' }
  let accounts = (rows ?? []) as Account[]
  if (accounts.some((a) => a.is_watched)) accounts = accounts.filter((a) => a.is_watched)
  if (accounts.length === 0) return { error: 'Este cliente ainda não tem conta de anúncio vinculada. Vincule em Contas de anúncio.' }

  const tokens = await workspaceTokens(workspace.id)
  const { data: biz } = await db.from('meta_businesses').select('id, connection_id').eq('workspace_id', workspace.id)
  const connByBiz = new Map((biz ?? []).map((b) => [b.id as string, b.connection_id as string]))
  const legacy = metaConfig()?.token ?? null
  const any = tokens.values().next().value ?? legacy
  const tokenFor = (a: Account) => (a.meta_business_id ? tokens.get(connByBiz.get(a.meta_business_id) ?? '') ?? any ?? null : legacy ?? any ?? null)
  return { accounts, tokenFor, clientName: client.name }
}

const errText = (e: unknown) => (e instanceof MetaError ? e.message : 'Falha ao consultar a Meta.')

export type MetricsResult =
  | { ok: true; range: Range; prev: Range; current: Metrics; previous: Metrics; days: DayPoint[]; accounts: number; warnings: string[] }
  | { ok: false; error: string }

export async function clientMetricsAction(ws: string, clientId: string, input: unknown): Promise<MetricsResult> {
  const parsed = rangeSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Período inválido.' }
  const r = resolveRange(parsed.data)
  if (!r) return { ok: false, error: 'Período personalizado inválido (início ≤ fim, até hoje, máx. 1 ano).' }
  const ctx = await clientCtx(ws, clientId)
  if ('error' in ctx) return { ok: false, error: ctx.error }

  const warnings: string[] = []
  let cur = { ...ZERO }
  let prev = { ...ZERO }
  const byDay = new Map<string, DayPoint>()
  let okCount = 0
  await Promise.all(
    ctx.accounts.map(async (a) => {
      const token = ctx.tokenFor(a)
      if (!token) return void warnings.push(`${a.name}: sem conexão ativa com o Facebook.`)
      try {
        const [c, p] = await Promise.all([fetchAccountSeries(token, a.external_account_id, r.cur.since, r.cur.until), fetchAccountSeries(token, a.external_account_id, r.prev.since, r.prev.until)])
        cur = addBase(cur, c.totals)
        prev = addBase(prev, p.totals)
        for (const d of c.days) {
          const { date, ...base } = d
          byDay.set(date, { date, ...addBase(byDay.get(date) ?? ZERO, base) })
        }
        okCount += 1
      } catch (e) {
        warnings.push(`${a.name}: ${errText(e)}`)
      }
    }),
  )
  if (okCount === 0) return { ok: false, error: warnings[0] ?? 'Não consegui consultar a Meta.' }

  // Série completa (dias sem gasto entram com zero).
  const days: DayPoint[] = []
  for (let d = r.cur.since; d <= r.cur.until; d = shift(d, 1)) days.push(byDay.get(d) ?? { date: d, ...ZERO })
  if (ctx.accounts.length > 1) warnings.push('Alcance somado entre contas (pessoas podem se repetir).')
  return { ok: true, range: r.cur, prev: r.prev, current: finalize(cur), previous: finalize(prev), days, accounts: okCount, warnings }
}

export type StructureResult = { ok: true; range: Range; campaigns: StructNode[]; warnings: string[] } | { ok: false; error: string }

export async function clientStructureAction(ws: string, clientId: string, input: unknown): Promise<StructureResult> {
  const parsed = rangeSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Período inválido.' }
  const r = resolveRange(parsed.data)
  if (!r) return { ok: false, error: 'Período personalizado inválido.' }
  const ctx = await clientCtx(ws, clientId)
  if ('error' in ctx) return { ok: false, error: ctx.error }

  const warnings: string[] = []
  const campaigns: StructNode[] = []
  let okCount = 0
  await Promise.all(
    ctx.accounts.map(async (a) => {
      const token = ctx.tokenFor(a)
      if (!token) return void warnings.push(`${a.name}: sem conexão ativa com o Facebook.`)
      try {
        campaigns.push(...(await fetchStructure(token, a.external_account_id, r.cur.since, r.cur.until)))
        okCount += 1
      } catch (e) {
        warnings.push(`${a.name}: ${errText(e)}`)
      }
    }),
  )
  if (okCount === 0) return { ok: false, error: warnings[0] ?? 'Não consegui consultar a Meta.' }
  campaigns.sort((a, b) => Number(b.status === 'ACTIVE') - Number(a.status === 'ACTIVE') || b.metrics.spend - a.metrics.spend)
  return { ok: true, range: r.cur, campaigns, warnings }
}

export type StatusResult = { ok: true; statuses: Record<string, string>; at: string } | { ok: false; error: string }

/** Status atual de campanhas/conjuntos/anúncios (polling "ao vivo"). */
export async function clientStatusAction(ws: string, clientId: string): Promise<StatusResult> {
  const ctx = await clientCtx(ws, clientId)
  if ('error' in ctx) return { ok: false, error: ctx.error }
  const statuses: Record<string, string> = {}
  let okCount = 0
  let lastError = ''
  await Promise.all(
    ctx.accounts.map(async (a) => {
      const token = ctx.tokenFor(a)
      if (!token) return
      try {
        Object.assign(statuses, await fetchStatuses(token, a.external_account_id))
        okCount += 1
      } catch (e) {
        lastError = errText(e)
      }
    }),
  )
  if (okCount === 0) return { ok: false, error: lastError || 'Sem conexão ativa com o Facebook.' }
  return { ok: true, statuses, at: new Date().toISOString() }
}
