/**
 * Executor de alterações no iFood a partir dos moldes aprendidos (learn.ts).
 * Garantias:
 *  - rmw: lê o detalhe ATUAL do item, altera só os caminhos aprendidos, confere
 *    que nenhuma outra folha mudou, envia, e RELÊ para verificar.
 *  - patch: usa o corpo-modelo (que só tem id + campos) trocando id e valores.
 *  - devolve o valor "antes" (bruto) de cada campo → permite desfazer (rmw).
 * `request` é injetado (no navegador: fetch do próprio portal na aba aberta).
 */
import type { MenuItem } from '../core/schema'
import { pendingChanges } from './bridge'
import type { HubPendingItem } from './hub'
import { diffLeaves, getPath, pathKey, setPath, type Field, type Template } from './learn'

export type PortalRequest = (method: string, url: string, body?: unknown) => Promise<{ status: number; json: unknown }>

/** Valores desejados (semânticos): preço em reais, status 'active'|'paused'. */
export type Desired = Partial<{ price: number; status: 'active' | 'paused'; name: string; description: string }>

export interface ApplyResult {
  ok: boolean
  message: string
  applied: Field[]
  /** valores brutos anteriores (para desfazer) */
  rawBefore: Partial<Record<Field, unknown>>
  dryRun?: { method: string; url: string; changes: { field: Field; before: unknown; after: unknown }[] }[]
}

const FIELD_OF: Record<string, Field> = { Nome: 'name', 'Descrição': 'description', 'Preço': 'price', Status: 'status' }

/** O que precisa mudar no iFood para refletir a pendência (apenas campos diferentes). */
export function desiredFromPending(p: HubPendingItem, current: MenuItem | null): Desired {
  const out: Desired = {}
  for (const c of pendingChanges(p, current)) {
    const f = FIELD_OF[c.field]
    if (f === 'price') out.price = p.price
    if (f === 'status') out.status = p.status === 'active' ? 'active' : 'paused'
    if (f === 'name') out.name = p.name
    if (f === 'description') out.description = p.description ?? ''
  }
  return out
}

export function encode(t: Template, value: unknown): unknown {
  if (t.field === 'price') return t.unit === 'centavos' ? Math.round((value as number) * 100) : Math.round((value as number) * 100) / 100
  if (t.field === 'status') return value === 'active' ? t.statusValues?.active : t.statusValues?.paused
  return value
}

export function decodePrice(t: Template, raw: unknown): number | null {
  if (typeof raw !== 'number') return null
  return t.unit === 'centavos' ? raw / 100 : raw
}

/** Quais campos têm molde e quais faltam ensinar. */
export function coverage(desired: Desired, templates: Template[]): { missing: Field[]; usable: Template[] } {
  const missing: Field[] = []
  const usable: Template[] = []
  for (const field of Object.keys(desired) as Field[]) {
    const t = templates.find((x) => x.field === field)
    const value = (desired as any)[field]
    if (!t || encode(t, value) === undefined) missing.push(field)
    else usable.push(t)
  }
  return { missing, usable }
}

function groupKey(t: Template) {
  return t.mode === 'rmw' ? `rmw|${t.method}|${t.urlTemplate}|${t.detailUrlTemplate}|${pathKey(t.unwrap ?? [])}` : `patch|${t.field}`
}

const fill = (tpl: string, id: string) => tpl.split('{id}').join(id)
const ok2xx = (s: number) => s >= 200 && s < 300

/**
 * Aplica valores BRUTOS (já codificados) em um item. Agrupa campos que usam o
 * mesmo endpoint (1 leitura + 1 escrita por grupo).
 */
export async function applyRaw(
  ifoodId: string,
  rawByField: Partial<Record<Field, unknown>>,
  templates: Template[],
  request: PortalRequest,
  opts: { dryRun?: boolean } = {},
): Promise<ApplyResult> {
  const result: ApplyResult = { ok: true, message: '', applied: [], rawBefore: {}, dryRun: opts.dryRun ? [] : undefined }
  const chosen = (Object.keys(rawByField) as Field[]).map((f) => templates.find((t) => t.field === f)!).filter(Boolean)
  const groups = new Map<string, Template[]>()
  for (const t of chosen) groups.set(groupKey(t), [...(groups.get(groupKey(t)) ?? []), t])

  for (const group of groups.values()) {
    const t0 = group[0]!
    const url = fill(t0.urlTemplate, ifoodId)
    if (t0.mode === 'rmw') {
      const detailUrl = fill(t0.detailUrlTemplate!, ifoodId)
      const read = await request('GET', detailUrl)
      if (!ok2xx(read.status)) return { ...result, ok: false, message: `Leitura do item falhou (HTTP ${read.status}).` }
      const original = t0.unwrap?.length ? getPath(read.json, t0.unwrap) : read.json
      if (typeof original !== 'object' || original === null) return { ...result, ok: false, message: 'Formato do item mudou no portal — ensine de novo.' }
      const modified = structuredClone(original)
      const intended = new Set<string>()
      for (const t of group) {
        const before = getPath(original, t.path)
        if (before === undefined) return { ...result, ok: false, message: `Campo ${t.field} não encontrado no item — ensine de novo.` }
        result.rawBefore[t.field] = before
        setPath(modified, t.path, rawByField[t.field])
        intended.add(pathKey(t.path))
      }
      const diffs = diffLeaves(original, modified)
      if (diffs.some((d) => !intended.has(pathKey(d.path)))) return { ...result, ok: false, message: 'Conferência falhou: outros campos mudariam. Nada foi enviado.' }
      if (diffs.length === 0) {
        result.applied.push(...group.map((t) => t.field))
        continue
      }
      if (opts.dryRun) {
        result.dryRun!.push({ method: t0.method, url, changes: group.map((t) => ({ field: t.field, before: getPath(original, t.path), after: rawByField[t.field] })) })
        result.applied.push(...group.map((t) => t.field))
        continue
      }
      const write = await request(t0.method, url, modified)
      if (!ok2xx(write.status)) return { ...result, ok: false, message: `O iFood recusou a alteração (HTTP ${write.status}).` }
      const check = await request('GET', detailUrl)
      const after = t0.unwrap?.length ? getPath(check.json, t0.unwrap) : check.json
      const wrong = group.filter((t) => !Object.is(getPath(after, t.path), rawByField[t.field]))
      if (!ok2xx(check.status) || wrong.length) return { ...result, ok: false, message: `Enviado, mas a verificação não confirmou: ${wrong.map((t) => t.field).join(', ') || 'leitura falhou'}.` }
      result.applied.push(...group.map((t) => t.field))
    } else {
      // patch: um molde por campo
      const body = structuredClone(t0.patchBody)
      for (const p of t0.idPaths ?? []) setPath(body, p, ifoodId)
      setPath(body, t0.path, rawByField[t0.field])
      if (opts.dryRun) {
        result.dryRun!.push({ method: t0.method, url, changes: [{ field: t0.field, before: undefined, after: rawByField[t0.field] }] })
        result.applied.push(t0.field)
        continue
      }
      const write = await request(t0.method, url, body)
      if (!ok2xx(write.status)) return { ...result, ok: false, message: `O iFood recusou a alteração (HTTP ${write.status}).` }
      result.applied.push(t0.field)
    }
  }
  result.message = opts.dryRun ? 'Simulação pronta (nada enviado).' : 'Aplicado e conferido no iFood.'
  return result
}

/** Aplica uma pendência do Orvia em um item do iFood. */
export async function applyPending(
  p: HubPendingItem,
  current: MenuItem | null,
  templates: Template[],
  request: PortalRequest,
  opts: { dryRun?: boolean } = {},
): Promise<ApplyResult & { missing: Field[] }> {
  if (!p.ifood_id) return { ok: false, message: 'Item novo: criar no iFood ainda é feito pelo portal.', applied: [], rawBefore: {}, missing: [] }
  const desired = desiredFromPending(p, current)
  const { missing, usable } = coverage(desired, templates)
  if (missing.length) return { ok: false, message: 'Falta ensinar alguns campos.', applied: [], rawBefore: {}, missing }
  if (usable.length === 0) return { ok: true, message: 'O iFood já está igual.', applied: [], rawBefore: {}, missing: [] }
  const raw: Partial<Record<Field, unknown>> = {}
  for (const t of usable) raw[t.field] = encode(t, (desired as any)[t.field])
  return { ...(await applyRaw(p.ifood_id, raw, templates, request, opts)), missing: [] }
}
