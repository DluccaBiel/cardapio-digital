import { NextResponse } from 'next/server'
import { renderReportCard } from '@/lib/reports/card'
import { payloadSchema } from '@/lib/reports/payload-schema'
import type { ReportPayload } from '@/lib/reports/format'
import { createServerClient } from '@/lib/supabaseServer'

export const dynamic = 'force-dynamic'

/** POST /api/reports/card — PNG da prévia (ainda não salva), para "Baixar imagem". Só com sessão. */
export async function POST(req: Request) {
  const db = createServerClient()
  const { data: u } = await db.auth.getUser()
  if (!u.user) return NextResponse.json({ error: 'Sessão expirada.' }, { status: 401 })
  const raw = await req.text()
  if (raw.length > 400_000) return NextResponse.json({ error: 'Relatório grande demais.' }, { status: 413 })
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 })
  }
  const parsed = payloadSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Relatório inválido.' }, { status: 400 })
  return renderReportCard(parsed.data as unknown as ReportPayload)
}
