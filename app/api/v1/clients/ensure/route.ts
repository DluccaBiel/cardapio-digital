import { authenticate, isResponse } from '@/lib/api/auth'
import { err, ok, preflight, readJson } from '@/lib/api/http'
import { audit } from '@/lib/audit'
import { z } from 'zod'

export const dynamic = 'force-dynamic'
export const OPTIONS = preflight

const bodySchema = z.object({
  name: z.string().trim().min(1).max(160),
  ifood_merchant_id: z.string().trim().min(1).max(80).nullable().optional(),
})

const COLS = 'id, name, ifood_merchant_id'
type ClientRow = { id: string; name: string; ifood_merchant_id: string | null }

/** Escapa curingas do ILIKE: o nome vira comparação exata, só sem diferenciar maiúsculas. */
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`)

/**
 * POST /api/v1/clients/ensure — "garante" o cliente da loja do iFood.
 * 1) acha pelo ifood_merchant_id; 2) senão, pelo nome (case-insensitive), ignorando
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

  const byMerchant = async (): Promise<ClientRow | null> => {
    if (!merchantId) return null
    const { data } = await db
      .from('clients')
      .select(COLS)
      .eq('workspace_id', ws)
      .eq('ifood_merchant_id', merchantId)
      .is('archived_at', null)
      .maybeSingle()
    return (data as ClientRow | null) ?? null
  }

  const existing = await byMerchant()
  if (existing) return ok(req, { ...existing, created: false })

  const { data: byName, error: nameErr } = await db
    .from('clients')
    .select(COLS)
    .eq('workspace_id', ws)
    .is('archived_at', null)
    .ilike('name', escapeLike(name))
    .order('created_at', { ascending: true })
    .limit(10)
  if (nameErr) return err(req, 'internal', 'Falha ao procurar o cliente.')

  const candidates = (byName ?? []) as ClientRow[]
  // Com merchant: só aceita cliente sem loja vinculada (ou da mesma loja). Sem merchant: o primeiro.
  const found = merchantId
    ? candidates.find((c) => !c.ifood_merchant_id || c.ifood_merchant_id === merchantId)
    : candidates[0]

  if (found) {
    if (merchantId && !found.ifood_merchant_id) {
      const upd = await db
        .from('clients')
        .update({ ifood_merchant_id: merchantId })
        .eq('id', found.id)
        .eq('workspace_id', ws)
        .is('ifood_merchant_id', null)
      if (!upd.error) found.ifood_merchant_id = merchantId
    }
    return ok(req, { ...found, created: false })
  }

  const { data: created, error } = await db
    .from('clients')
    .insert({ workspace_id: ws, name, ifood_merchant_id: merchantId })
    .select(COLS)
    .single()
  if (error || !created) {
    // Corrida: outra chamada criou a mesma loja (uq_clients_ifood_merchant) → devolve a existente.
    if (error?.code === '23505') {
      const again = await byMerchant()
      if (again) return ok(req, { ...again, created: false })
    }
    return err(req, 'internal', 'Não consegui cadastrar o cliente.')
  }
  const row = created as ClientRow
  await audit({
    workspaceId: ws,
    actorType: 'api_key',
    actorId: auth.keyId,
    action: 'client.created_by_extension',
    entityType: 'client',
    entityId: row.id,
    metadata: { source: 'ifood' },
  })
  return ok(req, { ...row, created: true }, { status: 201 })
}
