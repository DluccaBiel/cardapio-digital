import { timingSafeEqual } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { audit } from '@/lib/audit'
import { getWorkspaceBySlug } from '@/lib/db/workspaces'
import { exchangeGoogleCode, GOOGLE_STATE_COOKIE, GoogleError, googleOrigin, saveGoogleConnection } from '@/lib/google/calendar'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { createServerClient } from '@/lib/supabaseServer'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const same = (a: string, b: string) => {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/** GET /api/google/oauth/callback — valida o state, troca o code e grava o refresh token criptografado. */
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin
  let saved: { nonce?: string; ws?: string } = {}
  try {
    saved = JSON.parse(req.cookies.get(GOOGLE_STATE_COOKIE)?.value ?? '{}')
  } catch {
    saved = {}
  }
  const ws = /^[a-z0-9-]{1,64}$/.test(saved.ws ?? '') ? saved.ws! : ''
  const back = (status: string) => {
    const res = NextResponse.redirect(new URL(ws ? `/a/${ws}/sdr?google=${status}` : '/', origin))
    res.cookies.set(GOOGLE_STATE_COOKIE, '', { path: '/api/google/oauth', maxAge: 0 })
    return res
  }
  const p = req.nextUrl.searchParams
  if (p.get('error')) return back('cancelado')
  const state = p.get('state') ?? ''
  const code = p.get('code') ?? ''
  if (!saved.nonce || !state || !same(saved.nonce, state) || !code) return back('state_invalido')

  const db = createServerClient()
  const { data: u } = await db.auth.getUser()
  if (!u.user) return NextResponse.redirect(new URL('/login', origin))
  const workspace = await getWorkspaceBySlug(ws)
  if (!workspace || !['owner', 'coordenador'].includes(workspace.role)) return back('sem_permissao')

  try {
    const { refreshToken, email } = await exchangeGoogleCode(code, `${googleOrigin(origin)}/api/google/oauth/callback`)
    await saveGoogleConnection(createAdminClient(), workspace.id, refreshToken, email, u.user.id)
    await audit({ workspaceId: workspace.id, actorType: 'user', actorId: u.user.id, action: 'google_calendar.connect', entityType: 'google_connection', entityId: workspace.id })
    return back('ok')
  } catch (e) {
    console.error('Google OAuth callback falhou:', e instanceof GoogleError ? e.message : 'erro inesperado')
    return back('erro')
  }
}
