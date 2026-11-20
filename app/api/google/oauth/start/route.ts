import { randomBytes } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { getWorkspaceBySlug } from '@/lib/db/workspaces'
import { consentUrl, GOOGLE_STATE_COOKIE, googleAppConfig, googleOrigin } from '@/lib/google/calendar'
import { tokenCryptoReady } from '@/lib/meta/crypto'
import { createServerClient } from '@/lib/supabaseServer'

export const dynamic = 'force-dynamic'

/** GET /api/google/oauth/start?ws=<slug> — "Conectar Google Agenda" (dono/coordenador). */
export async function GET(req: NextRequest) {
  const ws = req.nextUrl.searchParams.get('ws') ?? ''
  if (!/^[a-z0-9-]{1,64}$/.test(ws)) return NextResponse.redirect(new URL('/login', req.nextUrl.origin))
  const origin = googleOrigin(req.nextUrl.origin)
  if (origin !== req.nextUrl.origin) return NextResponse.redirect(new URL(`/api/google/oauth/start?ws=${encodeURIComponent(ws)}`, origin))
  const back = (status: string) => NextResponse.redirect(new URL(`/a/${encodeURIComponent(ws)}/sdr?google=${status}`, origin))

  const db = createServerClient()
  const { data: u } = await db.auth.getUser()
  if (!u.user) return NextResponse.redirect(new URL(`/login?next=/a/${ws}/sdr`, origin))
  const workspace = await getWorkspaceBySlug(ws)
  if (!workspace || !['owner', 'coordenador'].includes(workspace.role)) return back('sem_permissao')
  const app = googleAppConfig()
  if (!app || !tokenCryptoReady()) return back('nao_configurado')

  const nonce = randomBytes(24).toString('base64url')
  const res = NextResponse.redirect(consentUrl(app.clientId, `${origin}/api/google/oauth/callback`, nonce))
  res.cookies.set(GOOGLE_STATE_COOKIE, JSON.stringify({ nonce, ws }), {
    httpOnly: true,
    secure: req.nextUrl.protocol === 'https:',
    sameSite: 'lax',
    path: '/api/google/oauth',
    maxAge: 600,
  })
  return res
}
