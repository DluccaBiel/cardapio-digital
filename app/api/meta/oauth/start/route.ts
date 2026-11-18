import { randomBytes } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { getWorkspaceBySlug } from '@/lib/db/workspaces'
import { META_STATE_COOKIE as STATE_COOKIE, metaAppConfig, metaOAuthOrigin, oauthDialogUrl } from '@/lib/meta/api'
import { tokenCryptoReady } from '@/lib/meta/crypto'
import { createServerClient } from '@/lib/supabaseServer'

export const dynamic = 'force-dynamic'

// nome do cookie de state: META_STATE_COOKIE (lib/meta/api)

/**
 * GET /api/meta/oauth/start?ws=<slug>
 * Inicia o "Conectar com o Facebook": exige sessão + owner/coordenador,
 * grava um `state` aleatório (cookie httpOnly, 10 min) e redireciona ao diálogo da Meta.
 */
export async function GET(req: NextRequest) {
  const ws = req.nextUrl.searchParams.get('ws') ?? ''
  const back = (status: string) => NextResponse.redirect(new URL(`/a/${encodeURIComponent(ws)}/configuracoes?tab=integracoes&meta=${status}`, req.nextUrl.origin))

  if (!/^[a-z0-9-]{1,64}$/.test(ws)) return NextResponse.redirect(new URL('/login', req.nextUrl.origin))

  // Alias legado → recomeça no endereço oficial (sessão, cookie de state e callback no mesmo domínio).
  const origin = metaOAuthOrigin(req.nextUrl.origin)
  if (origin !== req.nextUrl.origin) {
    return NextResponse.redirect(new URL(`/api/meta/oauth/start?ws=${encodeURIComponent(ws)}`, origin))
  }

  const db = createServerClient()
  const { data: u } = await db.auth.getUser()
  if (!u.user) return NextResponse.redirect(new URL(`/login?next=/a/${ws}/configuracoes`, req.nextUrl.origin))

  const workspace = await getWorkspaceBySlug(ws)
  if (!workspace || !['owner', 'coordenador'].includes(workspace.role)) return back('sem_permissao')

  const app = metaAppConfig()
  if (!app || !tokenCryptoReady()) return back('nao_configurado')

  const nonce = randomBytes(24).toString('base64url')
  const redirectUri = `${origin}/api/meta/oauth/callback`
  const res = NextResponse.redirect(oauthDialogUrl(app.appId, redirectUri, nonce))
  res.cookies.set(STATE_COOKIE, JSON.stringify({ nonce, ws }), {
    httpOnly: true,
    secure: req.nextUrl.protocol === 'https:',
    sameSite: 'lax',
    path: '/api/meta/oauth',
    maxAge: 600,
  })
  return res
}
