import { z } from 'zod'
import { authenticate, isResponse } from '@/lib/api/auth'
import { err, ok, preflight, readJson } from '@/lib/api/http'

export const dynamic = 'force-dynamic'
export const OPTIONS = preflight

const body = z.object({ version: z.string().trim().max(40), manifest_name: z.string().trim().max(120).optional() })

/**
 * Handshake da extensão: registra/atualiza extension_installs (versão + last_seen_at).
 * A chave precisa ter sido criada para uma extensão (api_keys.extension_id).
 */
export async function POST(req: Request) {
  const auth = await authenticate(req, null)
  if (isResponse(auth)) return auth
  if (!auth.extensionId) return err(req, 'forbidden_scope', 'Esta chave não está vinculada a uma extensão.')
  const parsed = body.safeParse(await readJson(req))
  if (!parsed.success) return err(req, 'validation_failed', 'Corpo inválido: informe version.')

  const db = auth.ctx.db
  const now = new Date().toISOString()
  const { data, error } = await db
    .from('extension_installs')
    .upsert(
      {
        workspace_id: auth.workspaceId,
        extension_id: auth.extensionId,
        api_key_id: auth.keyId,
        version: parsed.data.version,
        status: 'active',
        last_seen_at: now,
      },
      { onConflict: 'workspace_id,extension_id' },
    )
    .select('id, version, status, last_seen_at')
    .single()
  if (error) return err(req, 'internal', 'Falha ao registrar a instalação.')
  return ok(req, data)
}
