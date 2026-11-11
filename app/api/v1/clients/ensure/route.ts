import { authenticate, isResponse } from '@/lib/api/auth'
import { err, ok, preflight, readJson } from '@/lib/api/http'
import { audit } from '@/lib/audit'
import { platformOfExtensionId, STORE_COLUMN } from '@/lib/api/extensions'
import { z } from 'zod'

export const dynamic = 'force-dynamic'
export const OPTIONS = preflight

const bodySchema = z.object({
  name: z.string().trim().min(1).max(160),
  ifood_merchant_id: z.string().trim().min(1).max(80).nullable().optional(),
})

type ClientRow = { id: string; name: string; ifood_merchant_id: string | null; cardapioweb_store_id?: string | null; anotaai_store_id?: string | null }

/** Escapa curingas do ILIKE: o nome vira comparação exata, só sem diferenciar maiúsculas. */
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`)

/**
 * POST /api/v1/clients/ensure — "garante" o cliente da loja (iFood ou Cardápio Web).
 * O canal vem da extensão da chave: iFood usa clients.ifood_merchant_id, Cardápio Web
 * usa clients.cardapioweb_store_id (0006). O campo do corpo continua `ifood_merchant_id`
 * por compatibilidade com as extensões já publicadas — é "o id da loja no canal".
 * 1) acha pelo id da loja; 2) senão, pelo nome (case-insensitive), ignorando
 *    clientes já vinculados a OUTRA loja (redes com o mesmo nome); 3) senão, cria.
 * Escopo catalogo:escrever (o da extensão). Idempotente. SEMPRE filtrado pelo workspace da chave.
 * Sem If-Match: é criação/vinculação (POST); o único "update" preenche ifood_merchant_id
 * quando ainda está NULL — nunca sobrescreve um valor existente.
 */
export async function POST(req: Request) {
  const auth = await authenticate(req, 'catalogo:escrever')
  if (isResponse(auth)) return auth
  const parsed = bodySchema.safeParse(await readJson(req))
  if (!parsed.success) return err(req, 'validation_failed', 'Informe o nome da loja (name).')
  const { name, ifood_merchant_id } = parsed.data
  const merchantId = ifood_merchant_id ?? null
  const db = auth.ctx.db
  const ws = auth.workspaceId
  const platform = await platformOfExtensionId(db, auth.extensionId)
  const col = STORE_COLUMN[platform]
  const COLS: string = col === 'ifood_merchant_id' ? 'id, name, ifood_merchant_id' : `id, name, ifood_merchant_id, ${col}`
  const storeOf = (c: ClientRow) => (c[col] ?? null) as string | null
  // Resposta no formato que as extensões já entendem: ifood_merchant_id = id da loja NO CANAL da chave
  const out = (c: ClientRow, created: boolean) => ({ id: c.id, name: c.name, ifood_merchant_id: storeOf(c), created })

  const byMerchant = async (): Promise<ClientRow | null> => {
    if (!merchantId) return null
    const { data } = await db
      .from('clients')
      .select(COLS)
      .eq('workspace_id', ws)
      .eq(col, merchantId)
      .is('archived_at', null)
      .maybeSingle()
    return (data as ClientRow | null) ?? null
  }

  const existing = await byMerchant()
  if (existing) return ok(req, out(existing, false))

  const { data: byName, error: nameErr } = await db
    .from('clients')
    .select(COLS)
    .eq('workspace_id', ws)
    .is('archived_at', null)
    .ilike('name', escapeLike(name))
    .order('created_at', { ascending: true })
    .limit(10)
  if (nameErr) return err(req, 'internal', 'Falha ao procurar o cliente.')

  const candidates = (byName ?? []) as unknown as ClientRow[]
  // Com merchant: só aceita cliente sem loja vinculada (ou da mesma loja). Sem merchant: o primeiro.
  const found = merchantId
    ? candidates.find((c) => !storeOf(c) || storeOf(c) === merchantId)
    : candidates[0]

  if (found) {
    if (merchantId && !storeOf(found)) {
      const upd = await db
        .from('clients')
        .update({ [col]: merchantId })
        .eq('id', found.id)
        .eq('workspace_id', ws)
        .is(col, null)
      if (!upd.error) found[col] = merchantId
    }
    return ok(req, out(found, false))
  }

  const { data: created, error } = await db
    .from('clients')
    .insert({ workspace_id: ws, name, [col]: merchantId })
    .select(COLS)
    .single()
  if (error || !created) {
    // Corrida: outra chamada criou a mesma loja (índice único do canal) → devolve a existente.
    if (error?.code === '23505') {
      const again = await byMerchant()
      if (again) return ok(req, out(again, false))
    }
    return err(req, 'internal', 'Não consegui cadastrar o cliente.')
  }
  const row = created as unknown as ClientRow
  await audit({
    workspaceId: ws,
    actorType: 'api_key',
    actorId: auth.keyId,
    action: 'client.created_by_extension',
    entityType: 'client',
    entityId: row.id,
    metadata: { source: platform },
  })
  return ok(req, out(row, true), { status: 201 })
}
