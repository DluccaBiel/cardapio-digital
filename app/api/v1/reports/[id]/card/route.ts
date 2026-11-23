import { authenticate, isResponse } from '@/lib/api/auth'
import { err } from '@/lib/api/http'
import { renderReportCard } from '@/lib/reports/card'
import type { ReportPayload } from '@/lib/reports/format'

export const dynamic = 'force-dynamic'

/** GET /api/v1/reports/{id}/card — PNG do relatório para o robô enviar no grupo (escopo relatorios:ler). */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const auth = await authenticate(req, 'relatorios:ler')
  if (isResponse(auth)) return auth
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) return err(req, 'validation_failed', 'id inválido.')
  const { data } = await auth.ctx.db.from('reports').select('payload').eq('workspace_id', auth.workspaceId).eq('id', params.id).maybeSingle()
  if (!data) return err(req, 'not_found', 'Relatório não encontrado.')
  return renderReportCard(data.payload as ReportPayload)
}
