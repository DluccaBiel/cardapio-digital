import { NextResponse } from 'next/server'
import { z } from 'zod'
import { clearFails, recordFail, tokenMatches, tooManyFails } from '../../../../lib/admin-token'
import { createAdminClient } from '../../../../lib/supabaseAdmin'
import { createServerClient } from '../../../../lib/supabaseServer'

export const dynamic = 'force-dynamic'

/**
 * Login do ADM por chave de acesso (sem e-mail/senha digitados).
 * A chave vive só no servidor (ADMIN_ACCESS_TOKEN_HASH ou ADMIN_ACCESS_TOKEN) e abre a sessão do usuário
 * ADMIN_ACCESS_EMAIL: o servidor gera um link mágico interno e o consome na hora (cookies de sessão normais).
 */
export async function POST(req: Request) {
  const ip = (req.headers.get('x-forwarded-for') ?? 'local').split(',')[0]!.trim()
  const fail = (status: number, error: string) => NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } })

  const email = process.env.ADMIN_ACCESS_EMAIL?.trim()
  if (!email || (!process.env.ADMIN_ACCESS_TOKEN_HASH && !process.env.ADMIN_ACCESS_TOKEN)) return fail(503, 'Login por chave não configurado neste ambiente.')
  if (tooManyFails(ip)) return fail(429, 'Muitas tentativas. Aguarde 15 minutos.')

  const body = z.object({ token: z.string().min(1).max(200) }).safeParse(await req.json().catch(() => null))
  if (!body.success) return fail(400, 'Informe a chave.')

  if (!tokenMatches(body.data.token, { hash: process.env.ADMIN_ACCESS_TOKEN_HASH, plain: process.env.ADMIN_ACCESS_TOKEN })) {
    recordFail(ip)
    await new Promise((ok) => setTimeout(ok, 800)) // atrasa tentativas em série
    return fail(401, 'Chave inválida.')
  }

  const admin = createAdminClient()
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  const tokenHash = link.data?.properties?.hashed_token
  if (link.error || !tokenHash) return fail(500, 'Não consegui abrir a sessão do administrador.')

  const supabase = createServerClient()
  const { error } = await supabase.auth.verifyOtp({ type: 'magiclink', token_hash: tokenHash })
  if (error) return fail(500, 'Não consegui abrir a sessão do administrador.')

  clearFails(ip)
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
}
