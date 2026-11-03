'use server'

import { createServerClient } from '@/lib/supabaseServer'
import { createClient } from '@/lib/supabaseAdmin'
import { revalidatePath } from 'next/cache'

export async function applyRelatorio(formData: FormData) {
  const relatorioId = formData.get('relatorioId') as string

  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado')

  const admin = createClient()

  const { data: relatorio, error: relError } = await admin
    .from('relatorios')
    .select('*')
    .eq('id', relatorioId)
    .single()

  if (relError || !relatorio) throw new Error('Relatório não encontrado')
  if (relatorio.user_id !== user.id) throw new Error('Sem permissão')
  if (relatorio.status !== 'aprovado') {
    throw new Error('Somente relatórios aprovados pelo cliente podem ser aplicados')
  }

  const { data: itens, error: itensError } = await admin
    .from('relatorio_itens')
    .select('*, produtos(*)')
    .eq('relatorio_id', relatorioId)
    .eq('aprovado', true)

  if (itensError) throw new Error(itensError.message)

  for (const item of itens || []) {
    const produto = item.produtos
    if (!produto) continue

    const updates: Record<string, any> = { otimizado: true }

    if (item.preco_sugerido_mercado !== null && item.preco_sugerido_mercado !== undefined) {
      updates.preco = item.preco_sugerido_mercado
    } else if (item.preco_sugerido !== null && item.preco_sugerido !== undefined) {
      updates.preco = item.preco_sugerido
    }

    if (item.descricao_sugerida) {
      updates.descricao = item.descricao_sugerida
    }

    const { error: updError } = await admin
      .from('produtos')
      .update(updates)
      .eq('id', produto.id)

    if (updError) throw new Error(updError.message)
  }

  await admin
    .from('relatorios')
    .update({ status: 'aplicado' })
    .eq('id', relatorioId)

  revalidatePath(`/admin/relatorios/${relatorioId}`)
  revalidatePath('/admin/produtos')
  return { success: true }
}