import { authenticate, isResponse } from '@/lib/api/auth'
import { err, ok, preflight } from '@/lib/api/http'
import { ensureSdrDefaults, findLeadByPhone, leadView, phoneVariants } from '@/lib/sdr/core'

export const dynamic = 'force-dynamic'
export const OPTIONS = preflight

/**
 * GET /api/v1/sdr/leads/by-phone?phone=5519999990000
 * Ficha do lead da conversa aberta no WhatsApp Web (ou `lead: null` se o número não é lead).
 */
export async function GET(req: Request) {
  const auth = await authenticate(req, 'sdr:ler')
  if (isResponse(auth)) return auth
  const phone = new URL(req.url).searchParams.get('phone') ?? ''
  if (!phoneVariants(phone).length) return err(req, 'invalid_input', 'Telefone inválido.')
  await ensureSdrDefaults(auth.ctx.db, auth.workspaceId)
  const lead = await findLeadByPhone(auth.ctx.db, auth.workspaceId, phone)
  if (!lead) return ok(req, { lead: null })
  const view = await leadView(auth.ctx.db, auth.workspaceId, (lead as any).id)
  return ok(req, view, { headers: view ? { ETag: view.lead.etag } : {} })
}
