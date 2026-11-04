'use server'

import { createServerClient } from '@/lib/supabaseServer'
import { createClient } from '@/lib/supabaseAdmin'
import { revalidatePath } from 'next/cache'

export async function importarProdutosCSV(formData: FormData) {
  const file = formData.get('csvFile') as File
  if (!file) throw new Error('Nenhum arquivo enviado')

  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado')

  const admin = createClient()

  const text = await file.text()
  const lines = text.split('\n').filter(l => l.trim())
  if (lines.length < 2) throw new Error('CSV vazio ou inválido')

  const headers = lines[0].split(',').map(h => h.trim().toLowerCase())
  const produtos: any[] = []

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''))
    const produto: any = { user_id: user.id }
    headers.forEach((h, idx) => {
      const val = values[idx] || ''
      if (h === 'nome') produto.nome = val
      if (h === 'descricao') produto.descricao = val
      if (h === 'preco') produto.preco = parseFloat(val) || 0
      if (h === 'categoria') produto.categoria = val
      if (h === 'preco_referencia') produto.preco_referencia = parseFloat(val) || null
      if (h === 'imagem_url') produto.imagem_url = val || null
      if (h === 'status') produto.status = val || 'ativo'
    })
    if (produto.nome) produtos.push(produto)
  }

  if (produtos.length === 0) throw new Error('Nenhum produto válido encontrado')

  const { error } = await admin.from('produtos').insert(produtos)
  if (error) throw new Error(error.message)

  revalidatePath('/dashboard')
  revalidatePath('/produtos')
  return { success: true, total: produtos.length }
}