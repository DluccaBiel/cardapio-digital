import { NextResponse } from 'next/server'
import { renderReportCard } from '@/lib/reports/card'
import type { ReportPayload } from '@/lib/reports/format'
import { createServerClient } from '@/lib/supabaseServer'

export const dynamic = 'force-dynamic'

/** GET /api/reports/{id}/card — PNG de um relatório salvo (histórico). Sessão + RLS. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) return NextResponse.json({ error: 'id inválido' }, { status: 400 })
  const db = createServerClient()
  const { data: u } = await db.auth.getUser()
  if (!u.user) return NextResponse.json({ error: 'Sessão expirada.' }, { status: 401 })
  const { data } = await db.from('reports').select('payload').eq('id', params.id).maybeSingle()
  if (!data) return NextResponse.json({ error: 'Relatório não encontrado.' }, { status: 404 })
  return renderReportCard(data.payload as ReportPayload)
}
