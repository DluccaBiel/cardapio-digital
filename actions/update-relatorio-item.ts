'use server'

import { createServerClient } from '../lib/supabaseServer'
import { createAdminClient as createClient } from '../lib/supabaseAdmin'
import { revalidatePath } from 'next/cache'

export async function updateRelatorioItem(formData: FormData) {
  const itemId = formData.get('itemId') as string
  const relatorioId = formData.get('relatorioId') as string
  const acao = formData.get('acao') as string
  const precoSugerido = formData.get('precoSugerido')
  const precoSugeridoMercado = formData.get('precoSugeridoMercado')
  const precoReferencia = formData.get('precoReferencia')
  const comparacaoMercado = formData.get('comparacaoMercado') as string
  const descricaoSugerida = formData.get('descricaoSugerida') as string
  const comboSugerido = formData.get('comboSugerido') as string
  const aprovado = formData.get('aprovado') === 'on'

  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado')

  const admin = createClient()

  const updateData: Record<string, any> = {
    acao,
    descricao_sugerida: descricaoSugerida || null,
    combo_sugerido: comboSugerido || null,
    aprovado,
    preco_referencia: precoReferencia ? parseFloat(String(precoReferencia)) : null,
    comparacao_mercado: comparacaoMercado || null,
  }

  if (precoSugeridoMercado !== '' && precoSugeridoMercado !== null) {
    updateData.preco_sugerido_mercado = parseFloat(String(precoSugeridoMercado))
    updateData.preco_sugerido = null
  } else if (precoSugerido !== '' && precoSugerido !== null) {
    updateData.preco_sugerido = parseFloat(String(precoSugerido))
    updateData.preco_sugerido_mercado = null
  } else {
    updateData.preco_sugerido = null
    updateData.preco_sugerido_mercado = null
  }

  const { error } = await admin
    .from('relatorio_itens')
    .update(updateData)
    .eq('id', itemId)

  if (error) throw new Error(error.message)

  revalidatePath(`/admin/relatorios/${relatorioId}`)
  return { success: true }
}
