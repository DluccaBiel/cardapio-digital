import { createAdminClient } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'

/**
 * Mantém o projeto Supabase (plano gratuito) ativo: o Supabase pausa o banco após
 * 7 dias sem atividade. A Vercel chama esta rota 1×/dia (vercel.json → crons) com
 * `Authorization: Bearer $CRON_SECRET`. Faz só uma leitura mínima — não grava nada.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('unauthorized', { status: 401 })
  }
  const started = Date.now()
  const { error } = await createAdminClient().from('workspaces').select('id', { head: true, count: 'exact' }).limit(1)
  if (error) {
    console.error('[keepalive] falha ao consultar o banco', error.code) // sem dados sensíveis
    return Response.json({ ok: false }, { status: 503 })
  }
  return Response.json({ ok: true, ms: Date.now() - started })
}
