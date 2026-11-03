'use server'

import { createServerClient } from '@/lib/supabaseServer'
import { createClient } from '@/lib/supabaseAdmin'
import { revalidatePath } from 'next/cache'

export async function gerarRelatorio(formData: FormData) {
  const titulo = formData.get('titulo') as string

  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado')

  const admin = createClient()

  const { data: relatorio, error } = await admin
    .from('relatorios')
    .insert({ user_id: user.id, titulo, status: 'gerado', token: crypto.randomUUID() })
    .select()
    .single()

  if (error) throw new Error(error.message)

  const { data: produtos } = await admin
    .from('produtos')
    .select('*')
    .eq('user_id', user.id)

  const itens = (produtos || []).map((p: any) => {
    const precoAtual = Number(p.preco || 0)
    const ref = p.preco_referencia != null ? Number(p.preco_referencia) : null
    let comparacao = null
    let precoMercado = null

    if (ref) {
      if (precoAtual < ref * 0.9) comparacao = 'abaixo'
      else if (precoAtual > ref * 1.1) comparacao = 'acima'
      else comparacao = 'ideal'
      precoMercado = Math.round(ref * 0.95 * 100) / 100
    }

    return {
      relatorio_id: relatorio.id,
      produto_id: p.id,
      acao: (!p.imagem_url || (p.descricao && p.descricao.length < 20)) ? 'alterar' : 'manter',
      preco_sugerido: precoAtual > 0 ? Math.round(precoAtual * 1.05 * 100) / 100 : null,
      preco_sugerido_mercado: precoMercado,
      descricao_sugerida: !p.descricao || p.descricao.length < 20 ? `Descreva ${p.nome}: ingredientes, modo de preparo e diferencial.` : null,
      combo_sugerido: p.categoria ? `Combo: ${p.nome} + bebida da categoria ${p.categoria}` : null,
      preco_referencia: ref,
      comparacao_mercado: comparacao,
      aprovado: false,
    }
  })

  if (itens.length) {
    await admin.from('relatorio_itens').insert(itens)
  }

  revalidatePath('/relatorios')
  return { success: true, relatorioId: relatorio.id }
}