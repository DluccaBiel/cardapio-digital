import { timingSafeEqual } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { audit } from '@/lib/audit'
import { getWorkspaceBySlug } from '@/lib/db/workspaces'
import { exchangeCode, fetchBusinesses, fetchMe, META_STATE_COOKIE, metaOAuthOrigin } from '@/lib/meta/api'
import { encryptToken } from '@/lib/meta/crypto'
import { MetaError } from '@/lib/meta/graph'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { createServerClient } from '@/lib/supabaseServer'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function sameNonce(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/**
 * GET /api/meta/oauth/callback?code&state
 * Valida o state (cookie), troca o code por token de longa duração, grava a conexão
 * (sessão/RLS) e o token CRIPTOGRAFADO (service role), e lista os portfólios.
 */
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin
  let ws = ''
  try {
    ws = JSON.parse(req.cookies.get(META_STATE_COOKIE)?.value ?? '{}').ws ?? ''
  } catch {
    ws = ''
  }
  const back = (status: string) => {
    const target = /^[a-z0-9-]{1,64}$/.test(ws) ? `/a/${ws}/configuracoes?tab=integracoes&meta=${status}` : '/'
    const res = NextResponse.redirect(new URL(target, origin))
    res.cookies.set(META_STATE_COOKIE, '', { path: '/api/meta/oauth', maxAge: 0 })
    return res
  }

  const params = req.nextUrl.searchParams
  if (params.get('error')) return back('cancelado')

  let saved: { nonce?: string; ws?: string } = {}
  try {
    saved = JSON.parse(req.cookies.get(META_STATE_COOKIE)?.value ?? '{}')
  } catch {
    saved = {}
  }
  const state = params.get('state') ?? ''
  const code = params.get('code') ?? ''
  if (!saved.nonce || !state || !sameNonce(saved.nonce, state) || !code) return back('state_invalido')

  const db = createServerClient()
  const { data: u } = await db.auth.getUser()
  if (!u.user) return NextResponse.redirect(new URL('/login', origin))
  const workspace = await getWorkspaceBySlug(ws)
  if (!workspace || !['owner', 'coordenador'].includes(workspace.role)) return back('sem_permissao')

  try {
    // redirect_uri idêntico ao usado no início (endereço oficial em produção)
    const { token, expiresAt } = await exchangeCode(code, `${metaOAuthOrigin(origin)}/api/meta/oauth/callback`)
    const me = await fetchMe(token)

    const { data: conn, error: connErr } = await db
      .from('meta_connections')
      .upsert(
        {
          workspace_id: workspace.id,
          fb_user_id: me.id,
          fb_user_name: me.name,
          connected_by: u.user.id,
          scopes: me.scopes,
          token_expires_at: expiresAt,
          status: 'active',
          last_error: null,
        },
        { onConflict: 'workspace_id,fb_user_id' },
      )
      .select('id')
      .single()
    if (connErr || !conn) return back('erro_salvar')

    const admin = createAdminClient()
    const { error: tokErr } = await admin
      .from('meta_connection_tokens')
      .upsert({ connection_id: conn.id, workspace_id: workspace.id, token_ciphertext: encryptToken(token) }, { onConflict: 'connection_id' })
    if (tokErr) return back('erro_salvar')

    const businesses = await fetchBusinesses(token)
    if (businesses.length > 0) {
      await db
        .from('meta_businesses')
        .upsert(
          businesses.map((b) => ({ workspace_id: workspace.id, connection_id: conn.id, business_id: b.id, name: b.name })),
          { onConflict: 'workspace_id,business_id' },
        )
    }

    await audit({
      workspaceId: workspace.id,
      actorType: 'user',
      actorId: u.user.id,
      action: 'meta_connection.connect',
      entityType: 'meta_connection',
      entityId: conn.id,
      metadata: { businesses: businesses.length, scopes: me.scopes }, // nunca o token
    })
    return back(businesses.length > 0 ? 'ok' : 'sem_portfolios')
  } catch (e) {
    console.error('Meta OAuth callback falhou:', e instanceof MetaError ? e.message : 'erro inesperado')
    return back('erro_meta')
  }
}
