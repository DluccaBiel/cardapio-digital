import { authenticate, isResponse } from '@/lib/api/auth'
import { err, ok, preflight, readJson } from '@/lib/api/http'
import { audit } from '@/lib/audit'
import { researchAnswer } from '@/lib/api/research'
import { z } from 'zod'

export const dynamic = 'force-dynamic'
export const maxDuration = 90
export const OPTIONS = preflight

const bodySchema = z.object({
  /** Pergunta em texto livre, em português. */
  question: z.string().trim().min(5, 'Escreva uma pergunta com pelo menos 5 caracteres.').max(500, 'Pergunta muito longa (máx. 500).'),
  /** Contexto opcional (segmento, cidade, produto, estratégia). */
  context: z.string().trim().max(1200).optional(),
  /** Quantas fontes devolver (1 a 8). */
  max_sources: z.number().int().min(1).max(8).default(5),
})

/**
 * Agente de pesquisa para as extensões.
 *
 * `POST /api/v1/research` com `X-API-Key` de escopo `pesquisa:ler`:
 *   { "question": "...", "context": "...", "max_sources": 5 }
 * Resposta: { data: { answer, sources, mode, status, notices, answered_at } }
 *
 * Somente leitura: não grava nada além do audit_log (sem conteúdo sensível).
 */
export async function POST(req: Request) {
  const auth = await authenticate(req, 'pesquisa:ler')
  if (isResponse(auth)) return auth

  const parsed = bodySchema.safeParse(await readJson(req))
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return err(req, 'validation_failed', `Pedido inválido: ${issue?.path.join('.')} ${issue?.message}`)
  }

  try {
    const answer = await researchAnswer(parsed.data)
    await audit({
      workspaceId: auth.workspaceId,
      actorType: 'api_key',
      actorId: auth.keyId,
      action: 'research.answered',
      entityType: 'workspace',
      entityId: auth.workspaceId,
      // NUNCA gravar a pergunta/resposta (pode conter dados de clientes)
      metadata: { mode: answer.mode, status: answer.status, sources: answer.sources.length },
    })
    return ok(req, answer)
  } catch {
    return err(req, 'internal', 'O agente de pesquisa não conseguiu responder agora. Tente de novo em instantes.')
  }
}
