import type { NextResponse } from 'next/server'
import { createAdminClient } from '../supabaseAdmin'
import type { Ctx } from '../menu/mutations'
import { err } from './http'
import { hashApiKey, looksLikeApiKey, type ApiScope } from './keys'

export type ApiKeyCtx = {
  keyId: string
  workspaceId: string
  extensionId: string | null
  scopes: string[]
  ctx: Ctx
}

/**
 * Rate limit por chave — janela fixa de 1 min, EM MEMÓRIA por instância
 * (decisoes-em-aberto #4: migrar para tabela Postgres se houver abuso/várias instâncias).
 */
const windows = new Map<string, { start: number; count: number }>()
function rateLimit(keyId: string, limit: number): { allowed: boolean; remaining: number; reset: number } {
  const now = Date.now()
  const current = windows.get(keyId)
  if (!current || now - current.start >= 60_000) {
    windows.set(keyId, { start: now, count: 1 })
    return { allowed: true, remaining: limit - 1, reset: Math.ceil((now + 60_000) / 1000) }
  }
  current.count += 1
  return { allowed: current.count <= limit, remaining: Math.max(0, limit - current.count), reset: Math.ceil((current.start + 60_000) / 1000) }
}

const lastTouch = new Map<string, number>()

/**
 * Autentica `X-API-Key` → hash → chave ativa → escopo → rate limit.
 * Retorna contexto com cliente service-role + workspace da chave.
 * Toda query posterior DEVE filtrar por ctx.workspaceId (mutations.ts já faz).
 */
export async function authenticate(req: Request, scope: ApiScope | null): Promise<ApiKeyCtx | NextResponse> {
  const raw = req.headers.get('x-api-key')
  if (!looksLikeApiKey(raw)) return err(req, 'unauthorized', 'Chave de API ausente ou inválida (header X-API-Key).')

  const admin = createAdminClient()
  const { data: key, error } = await admin
    .from('api_keys')
    .select('id, workspace_id, extension_id, scopes, rate_limit_per_minute, expires_at, revoked_at, last_used_at')
    .eq('key_hash', hashApiKey(raw))
    .maybeSingle()
  if (error) return err(req, 'internal', 'Falha ao validar a chave.')
  if (!key || key.revoked_at) return err(req, 'unauthorized', 'Chave revogada ou inexistente.')
  if (key.expires_at && new Date(key.expires_at).getTime() < Date.now()) return err(req, 'unauthorized', 'Chave expirada.')

  const { data: ws } = await admin.from('workspaces').select('id, deleted_at').eq('id', key.workspace_id).maybeSingle()
  if (!ws || (ws as any).deleted_at) return err(req, 'unauthorized', 'Workspace indisponível.')

  if (scope && !(key.scopes as string[]).includes(scope)) {
    return err(req, 'forbidden_scope', `Chave sem escopo ${scope}`, { required: scope })
  }

  const limit = key.rate_limit_per_minute ?? 60
  const rl = rateLimit(key.id, limit)
  if (!rl.allowed) {
    return err(req, 'rate_limited', 'Muitas requisições. Aguarde um pouco.', {}, {
      'Retry-After': String(Math.max(1, rl.reset - Math.floor(Date.now() / 1000))),
      'X-RateLimit-Limit': String(limit),
      'X-RateLimit-Remaining': '0',
    })
  }

  // last_used_at no máx. 1×/min por instância
  const prev = lastTouch.get(key.id) ?? 0
  if (Date.now() - prev > 60_000) {
    lastTouch.set(key.id, Date.now())
    // builder do supabase é lazy: precisa de then() para executar
    admin.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', key.id).then(() => undefined)
  }

  return {
    keyId: key.id,
    workspaceId: key.workspace_id,
    extensionId: key.extension_id,
    scopes: key.scopes as string[],
    ctx: { db: admin, workspaceId: key.workspace_id, actor: { type: 'api_key', id: key.id } },
  }
}

export function isResponse(value: unknown): value is NextResponse {
  return value instanceof Response
}
