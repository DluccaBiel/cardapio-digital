import { z } from 'zod'
import { audit } from '@/lib/audit'
import { authenticate, isResponse } from '@/lib/api/auth'
import { err, ok, preflight, readJson } from '@/lib/api/http'
import { parseIfMatch } from '@/lib/menu/model'
import { normalizeBrPhone } from '@/lib/sdr/providers/osm'
import { changeStage, ensureSdrDefaults, findLeadByPhone, leadView } from '@/lib/sdr/core'

export const dynamic = 'force-dynamic'
export const OPTIONS = preflight
void parseIfMatch

const body = z.object({
  name: z.string().trim().min(1).max(200),
  phone: z.string().trim().min(8).max(30),
  /** O lead escreveu primeiro (veio de anúncio/indicação): já entra como "respondeu". */
  inbound: z.boolean().optional(),
})

/** POST /api/v1/sdr/leads — transforma a conversa aberta em lead do SDR. */
export async function POST(req: Request) {
  const auth = await authenticate(req, 'sdr:escrever')
  if (isResponse(auth)) return auth
  const parsed = body.safeParse(await readJson(req))
  if (!parsed.success) return err(req, 'validation_failed', 'Informe nome e telefone.')
  const phone = normalizeBrPhone(parsed.data.phone)
  if (!phone) return err(req, 'validation_failed', 'Telefone brasileiro inválido.')
  const db = auth.ctx.db
  await ensureSdrDefaults(db, auth.workspaceId)

  const existing = await findLeadByPhone(db, auth.workspaceId, phone)
  if (existing) return err(req, 'conflict', 'Este número já é um lead do SDR.', { lead_id: (existing as any).id })

  const { data, error } = await db
    .from('prospect_leads')
    .insert({ workspace_id: auth.workspaceId, source: 'whatsapp', name: parsed.data.name, phone, niche: 'food', status: 'novo', stage: 'novo' })
    .select('id')
    .single()
  if (error || !data) return err(req, 'internal', 'Não consegui criar o lead.')
  // Quem escreveu primeiro não recebe "primeiro contato": vai direto para "respondeu".
  await changeStage(db, auth.workspaceId, data.id, parsed.data.inbound ? 'respondeu' : 'novo', { enroll: !parsed.data.inbound })
  await audit({ workspaceId: auth.workspaceId, actorType: 'api_key', actorId: auth.keyId, action: 'sdr_lead.create', entityType: 'prospect_lead', entityId: data.id, metadata: { source: 'whatsapp' } })
  const view = await leadView(db, auth.workspaceId, data.id)
  return ok(req, view, { status: 201, headers: view ? { ETag: view.lead.etag } : {} })
}
