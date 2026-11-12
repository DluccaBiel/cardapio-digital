import { NextResponse } from 'next/server'
import { findWorkspaceByCode } from '../../../lib/shortlink'

export const dynamic = 'force-dynamic'

/**
 * Link curto: `/c/<código>` → tela de Extensões do workspace.
 * O código é derivado do slug (lib/shortlink.ts); não há tabela nova.
 */
export async function GET(req: Request, { params }: { params: { code: string } }) {
  const slug = await findWorkspaceByCode(params.code)
  const target = slug ? `/a/${slug}/extensoes` : '/login'
  return NextResponse.redirect(new URL(target, req.url), 307)
}
