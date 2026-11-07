import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { audit } from '@/lib/audit'
import { err, ok, preflight, readJson } from '@/lib/api/http'
import { generateApiKey, IFOOD_EXTENSION_SCOPES } from '@/lib/api/keys'
import { createAdminClient } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'
export const OPTIONS = preflight

/**
 * Login de usuário DENTRO da extensão (e-mail + senha do Orvia).
 * O servidor valida no Supabase Auth, confere o papel no workspace e emite uma
 * chave da extensão (escopos mínimos, 365 dias) — a senha nunca é guardada.
 * Re-login do mesmo dispositivo revoga a chave anterior desse dispositivo.
 */
const body = z.object({
  email: z.string().trim().email().max(200),
  password: z.string().min(1).max(200),
  workspace_slug: z.string().trim().max(80).optional(),
  device_id: z.string().regex(/^[a-z0-9-]{8,64}$/i),
  device_label: z.string().trim().max(60).optional(),
})

const ROLES = new Set(['owner', 'coordenador', 'editor'])

// Freio contra força bruta: 8 tentativas/min por IP (em memória por instância)
const attempts = new Map<string, { start: number; count: number }>()
function tooMany(ip: string): boolean {
  const now = Date.now()
  const cur = attempts.get(ip)
  if (!cur || now - cur.start > 60_000) {
    attempts.set(ip, { start: now, count: 1 })
    return false
  }
  cur.count += 1
  return cur.count > 8
}

export async function POST(req: Request) {
  const ip = (req.headers.get('x-forwarded-for') ?? 'local').split(',')[0]!.trim()
  if (tooMany(ip)) return err(req, 'rate_limited', 'Muitas tentativas. Aguarde 1 minuto.', {}, { 'Retry-After': '60' })

  const parsed = body.safeParse(await readJson(req))
  if (!parsed.success) return err(req, 'validation_failed', 'Informe e-mail e senha válidos.')
  const { email, password, workspace_slug, device_id, device_label } = parsed.data

  const auth = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: signed, error: signErr } = await auth.auth.signInWithPassword({ email, password })
  if (signErr || !signed.user) return err(req, 'unauthorized', 'E-mail ou senha incorretos.')
  const userId = signed.user.id
  await auth.auth.signOut().catch(() => undefined) // não mantemos sessão: a extensão usa a chave

  const admin = createAdminClient()
  const { data: memberships } = await admin
    .from('members')
    .select('role, workspaces!inner ( id, name, slug, deleted_at )')
    .eq('user_id', userId)
  const allowed = (memberships ?? [])
    .map((m: any) => ({ role: m.role as string, ws: Array.isArray(m.workspaces) ? m.workspaces[0] : m.workspaces }))
    .filter((m) => m.ws && !m.ws.deleted_at && ROLES.has(m.role))
  if (allowed.length === 0) {
    return err(req, 'forbidden_scope', 'Sua conta não tem workspace com permissão de edição. Crie seu workspace no Orvia primeiro.')
  }
  const chosen = workspace_slug ? allowed.find((m) => m.ws.slug === workspace_slug) : allowed.length === 1 ? allowed[0] : undefined
  if (!chosen) {
    return ok(req, { needs_workspace: true, workspaces: allowed.map((m) => ({ slug: m.ws.slug, name: m.ws.name })) })
  }

  const { data: ext } = await admin.from('extensions').select('id').eq('slug', 'orvia-ifood').maybeSingle()
  if (!ext) return err(req, 'internal', 'Extensão não registrada no servidor.')

  const name = `Extensão · ${email} · ${(device_label || 'Chrome').slice(0, 30)} · ${device_id.slice(0, 8)}`
  // Mesmo dispositivo fazendo login de novo: revoga a chave anterior dele
  await admin
    .from('api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('workspace_id', chosen.ws.id)
    .eq('name', name)
    .is('revoked_at', null)

  const { key, prefix, hash } = generateApiKey()
  const { data: row, error } = await admin
    .from('api_keys')
    .insert({
      workspace_id: chosen.ws.id,
      extension_id: ext.id,
      name,
      key_hash: hash,
      key_prefix: prefix,
      scopes: IFOOD_EXTENSION_SCOPES,
      expires_at: new Date(Date.now() + 365 * 86_400_000).toISOString(),
      created_by: userId,
    })
    .select('id')
    .single()
  if (error || !row) return err(req, 'internal', 'Não foi possível criar o acesso da extensão.')

  await audit({
    workspaceId: chosen.ws.id,
    actorType: 'user',
    actorId: userId,
    action: 'api_key.create',
    entityType: 'api_key',
    entityId: row.id,
    metadata: { via: 'extension_login', prefix }, // nunca senha nem chave
  })

  return ok(req, { key, workspace: { name: chosen.ws.name, slug: chosen.ws.slug }, user: { email } })
}
