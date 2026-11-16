import { authenticate, isResponse } from '@/lib/api/auth'
import { err, ok, preflight, readJson } from '@/lib/api/http'
import { z } from 'zod'

export const dynamic = 'force-dynamic'
export const maxDuration = 90
export const OPTIONS = preflight

const bodySchema = z.object({
  /** Nicho de atuação: 'food' ou 'health' */
  niche: z.enum(['food', 'health']),
  /** Filtrar por status (opcional) */
  status: z.enum(['ativo', 'pausado', 'encerrado']).optional(),
})

/**
 * POST /api/v1/clients/search — Pesquisar clientes por nicho
 * Escopo: catalogo:ler
 * Corpo: { niche: 'food' | 'health', status?: 'ativo' | 'pausado' | 'encerrado' }
 * Retorna: nome, telefone, email, faturamento (monthly_fee), instagram, website
 */
export async function POST(req: Request) {
  const auth = await authenticate(req, 'catalogo:ler')
  if (isResponse(auth)) return auth

  const parsed = bodySchema.safeParse(await readJson(req))
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return err(req, 'validation_failed', `Pedido inválido: ${issue?.path.join('.')} ${issue?.message}`)
  }

  const { niche, status } = parsed.data
  const db = auth.ctx.db
  const ws = auth.workspaceId

  try {
    const query = db.from('clients')
      .select('id, name, email, phone, instagram, website, monthly_fee, status, archived_at, niche')
      .eq('workspace_id', ws)
      .eq('niche', niche)
      .is('archived_at', null)

    if (status) {
      query.eq('status', status)
    }

    const { data, error } = await query.order('name', { ascending: true })

    if (error) throw error

    // Formatar resposta: apenas clientes com alguns dados identificáveis
    const clients = (data ?? []).map((c: any) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      email: c.email,
      monthly_fee: c.monthly_fee,
      instagram: c.instagram,
      website: c.website,
      niche: c.niche,
      status: c.status,
    }))

    return ok(req, clients)
  } catch {
    return err(req, 'internal', 'Falha ao pesquisar clientes. Tente de novo em instantes.')
  }
}