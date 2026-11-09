import { authenticate, isResponse } from '@/lib/api/auth'
import { err, ok, preflight, readJson } from '@/lib/api/http'
import { decodePng, optimizationSchema } from '@/lib/menu/optimizations'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
export const OPTIONS = preflight

const OK_STATUS = new Set(['ok', 'feito', 'done'])
const ERR_STATUS = new Set(['erro', 'error', 'failed'])

/**
 * Recebe o resultado de uma otimização aprovada: plano congelado, status por
 * alteração e os prints (print 1..3) — guardados em bucket privado, vinculados
 * ao cliente. Escopo catalogo:escrever. Total ≤ ~4,5 MB (limite da Vercel).
 */
export async function POST(req: Request) {
  const auth = await authenticate(req, 'catalogo:escrever')
  if (isResponse(auth)) return auth
  const parsed = optimizationSchema.safeParse(await readJson(req))
  if (!parsed.success) return err(req, 'validation_failed', `Dados inválidos: ${parsed.error.issues[0]?.path.join('.')} ${parsed.error.issues[0]?.message}`)
  const b = parsed.data

  const { data: client } = await auth.ctx.db.from('clients').select('id').eq('workspace_id', auth.workspaceId).eq('id', b.client_id).is('archived_at', null).maybeSingle()
  if (!client) return err(req, 'not_found', 'Cliente não encontrado.')

  const images: { name: string; buf: Buffer }[] = []
  for (const e of b.evidence) {
    const buf = decodePng(e.content_base64)
    if (!buf) return err(req, 'validation_failed', `Imagem inválida: ${e.name} (precisa ser PNG de até 2,5 MB).`)
    images.push({ name: e.name, buf })
  }

  const okCount = b.results.filter((r) => OK_STATUS.has(r.status.toLowerCase())).length
  const errorCount = b.results.filter((r) => ERR_STATUS.has(r.status.toLowerCase())).length
  const { data: row, error } = await auth.ctx.db
    .from('menu_optimizations')
    .insert({
      workspace_id: auth.workspaceId,
      client_id: b.client_id,
      plan_hash: b.plan_hash,
      version: b.version,
      summary: b.summary,
      aborted: b.aborted,
      approved: b.approved,
      results: b.results,
      ok_count: okCount,
      error_count: errorCount,
      created_by_key: auth.keyId,
    })
    .select('id')
    .single()
  if (error || !row) return err(req, 'internal', 'Não consegui salvar a otimização.')

  let saved = 0
  for (const img of images) {
    const path = `${auth.workspaceId}/${b.client_id}/${row.id}/${img.name.replace(/[^A-Za-z0-9._-]+/g, '_')}`
    const up = await auth.ctx.db.storage.from('optimization-evidence').upload(path, img.buf, { contentType: 'image/png', upsert: true })
    if (up.error) continue
    const ins = await auth.ctx.db.from('menu_optimization_evidence').insert({ workspace_id: auth.workspaceId, optimization_id: row.id, name: img.name, storage_path: path, bytes: img.buf.length })
    if (!ins.error) saved += 1
  }
  await audit({
    workspaceId: auth.workspaceId,
    actorType: 'api_key',
    actorId: auth.keyId,
    action: 'optimization.saved',
    entityType: 'client',
    entityId: b.client_id,
    metadata: { optimization_id: row.id, ok: okCount, errors: errorCount, images: saved },
  })
  return ok(req, { id: row.id, evidence: saved }, { status: 201 })
}

/** Histórico por cliente, com URLs assinadas (10 min) dos prints. */
export async function GET(req: Request) {
  const auth = await authenticate(req, 'catalogo:ler')
  if (isResponse(auth)) return auth
  const clientId = new URL(req.url).searchParams.get('client_id')
  if (!clientId || !/^[0-9a-f-]{36}$/i.test(clientId)) return err(req, 'invalid_input', 'client_id obrigatório.')
  const { data: rows } = await auth.ctx.db
    .from('menu_optimizations')
    .select('id, plan_hash, version, summary, aborted, ok_count, error_count, approved, results, created_at, menu_optimization_evidence ( name, storage_path )')
    .eq('workspace_id', auth.workspaceId)
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(20)
  const out = []
  for (const r of rows ?? []) {
    const evidence = []
    for (const ev of (r as any).menu_optimization_evidence ?? []) {
      const s = await auth.ctx.db.storage.from('optimization-evidence').createSignedUrl(ev.storage_path, 600)
      evidence.push({ name: ev.name, url: s.data?.signedUrl ?? null })
    }
    const { menu_optimization_evidence: _omit, ...rest } = r as any
    out.push({ ...rest, evidence })
  }
  return ok(req, out)
}
