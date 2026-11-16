'use server'

import { z } from 'zod'
import { audit } from '../../../../lib/audit'
import { researchAnswer } from '../../../../lib/api/research'
import { getWorkspaceBySlug } from '../../../../lib/db/workspaces'
import { createServerClient } from '../../../../lib/supabaseServer'

const schema = z.object({
  clientId: z.string().uuid(),
  city: z.string().trim().max(100).optional(),
})

type ResearchData = Awaited<ReturnType<typeof researchAnswer>>

/**
 * Pesquisa IA sobre um cliente (mesma engine do /api/v1/research), a partir do painel.
 * Lê o cliente com a sessão do usuário (RLS) e não envia PII (e-mail/telefone) ao agente.
 */
export async function researchClientAction(ws: string, input: unknown): Promise<{ ok: true; data: ResearchData } | { ok: false; error: string }> {
  const workspace = await getWorkspaceBySlug(ws)
  if (!workspace) return { ok: false, error: 'Workspace não encontrado.' }
  const parsed = schema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Pedido inválido.' }

  const db = createServerClient()
  const { data: userData } = await db.auth.getUser()
  if (!userData.user) return { ok: false, error: 'Sessão expirada.' }

  const { data: client } = await db
    .from('clients')
    .select('*')
    .eq('id', parsed.data.clientId)
    .eq('workspace_id', workspace.id)
    .maybeSingle()
  if (!client) return { ok: false, error: 'Cliente não encontrado.' }

  const c = client as Record<string, any>
  const nicho = c.niche === 'health' ? 'saúde' : 'alimentação'
  const question = [
    parsed.data.city ? `Cidade/área: ${parsed.data.city}.` : '',
    `Analise a presença digital do negócio "${c.name}" (nicho: ${nicho}).`,
    'Avalie site e Instagram (profissionalismo, atividade), pontos fortes, oportunidades de melhoria e concorrentes bem avaliados na região.',
  ]
    .filter(Boolean)
    .join(' ')
    .slice(0, 500)
  const context = `Instagram: ${c.instagram || 'não informado'}; site: ${c.website || 'não informado'}; status na assessoria: ${c.status}.`

  try {
    const data = await researchAnswer({ question, context, max_sources: 6 })
    await audit({
      workspaceId: workspace.id,
      actorType: 'user',
      actorId: userData.user.id,
      action: 'research.answered',
      entityType: 'client',
      entityId: c.id,
      metadata: { mode: data.mode, status: data.status, sources: data.sources.length, panel: true, screen: 'prospeccao' },
    })
    return { ok: true, data }
  } catch {
    return { ok: false, error: 'Falha na pesquisa. Tente de novo em instantes.' }
  }
}
