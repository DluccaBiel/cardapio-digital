import { authenticate, isResponse } from '@/lib/api/auth'
import { err, ok, preflight, readJson } from '@/lib/api/http'
import { researchAnswer } from '@/lib/api/research'
import { z } from 'zod'

export const dynamic = 'force-dynamic'
export const maxDuration = 90
export const OPTIONS = preflight

const bodySchema = z.object({
  /** ID do cliente para pesquisar */
  clientId: z.string().uuid(),
  /** Pergunta sobre o cliente (opcional - se não informado, usa dados do cliente) */
  question: z.string().trim().min(5).max(500).optional(),
  /** Nicho do cliente: food ou health */
  niche: z.enum(['food', 'health']).optional(),
  /** Cidade do cliente (opcional) */
  city: z.string().trim().max(100).optional(),
})

/**
 * POST /api/v1/clients/research — Pesquisa IA sobre cliente
 * Escopo: pesquisa:ler
 * Corpo: { clientId: uuid, question?: string, niche?: 'food'|'health', city?: string }
 * Retorna: análise da IA sobre website, Instagram, mercado, sugestões de qualificação
 */
export async function POST(req: Request) {
  const auth = await authenticate(req, 'pesquisa:ler')
  if (isResponse(auth)) return auth

  const parsed = bodySchema.safeParse(await readJson(req))
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return err(req, 'validation_failed', `Pedido inválido: ${issue?.path.join('.')} ${issue?.message}`)
  }

  const { clientId, question, niche, city } = parsed.data
  const db = auth.ctx.db
  const ws = auth.workspaceId

  try {
    // Buscar dados do cliente
    const { data: client, error } = await db.from('clients')
      .select('id, name, email, phone, instagram, website, monthly_fee, status, niche, archived_at')
      .eq('id', clientId)
      .eq('workspace_id', ws)
      .single()

    if (error || !client) {
      return err(req, 'not_found', 'Cliente não encontrado.')
    }

    // Construir pergunta para o agente de pesquisa
    const baseQuestion = `Pesquise sobre este cliente para qualificação de lead:`
    
    let researchQuestion = ''
    if (question) {
      researchQuestion = question
    } else {
      // Pergunta padrão baseada nos dados do cliente
      researchQuestion = `
        Cliente: ${client.name}
        Nicho: ${client.niche || 'não definido'}
        Instagram: ${client.instagram || 'não definido'}
        Website: ${client.website || 'não definido'}
        Faturamento mensal: ${client.monthly_fee || 0} (R$)
        Status: ${client.status}
        
        Por favor, analise:
        1. A qualidade e completude do website (se existir) - ele parece profissional, tem catálogo online, reservas?
        2. O Instagram está bem definido e ativo? Quantos seguidores? O perfil parece profissional para o nicho ${client.niche || 'alimentação/saúde'}?
        3. Quais são os pontos fortes e áreas de melhoria para este cliente baseado em evidências públicas?
        4. Sugestões de como a assessoria pode ajudar este cliente (cardápio otimização, estratégias de mídia, etc.)
        5. Existem concorentes bem avaliados na mesma cidade/segmento? Pesquise se houver cidade informada.
      `.trim()
    }

    // Se tiver cidade, adicionar ao contexto
    const fullContext = city ? `Cidade/Área: ${city}. ${researchQuestion}` : researchQuestion

    const answer = await researchAnswer({
      question: fullContext,
      context: `Dados reais do cliente do Undercut: nome=${client.name}, nicho=${client.niche}, instagram=${client.instagram}, website=${client.website}, monthly_fee=${client.monthly_fee}, status=${client.status}`,
      max_sources: 6,
    })

    // Enriquecer resposta com dados reais do cliente
    const enriched = {
      ...answer,
      clientData: {
        id: client.id,
        name: client.name,
        niche: client.niche,
        status: client.status,
        monthly_fee: client.monthly_fee,
        instagram: client.instagram,
        website: client.website,
        email: client.email,
        phone: client.phone,
      },
      researchContext: {
        question: researchQuestion,
        niche: niche || client.niche,
        city: city,
        hasWebsite: !!client.website,
        hasInstagram: !!client.instagram,
      }
    }

    return ok(req, enriched)
  } catch {
    return err(req, 'internal', 'Falha na pesquisa IA. Tente de novo em instantes.')
  }
}