'use server'

import { createServerClient } from '../../lib/supabaseServer'
import { createAdminClient as createClient } from '../../lib/supabaseAdmin'
import { revalidatePath } from 'next/cache'
import * as XLSX from 'xlsx'

export async function importarProdutosCSV(formData: FormData) {
  const file = formData.get('csvFile') as File
  if (!file) throw new Error('Nenhum arquivo enviado')

  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado')

  const admin = createClient()

  const arrayBuffer = await file.arrayBuffer()
  const ext = file.name.split('.').pop()?.toLowerCase()

  let produtos: any[] = []

  if (ext === 'csv') {
    const text = await file.text()
    const lines = text.split('\n').filter(l => l.trim())
    if (lines.length < 2) throw new Error('CSV vazio ou inválido')

    const headers = lines[0].split(',').map(h => h.trim().toLowerCase())
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
  } else if (ext === 'xlsx' || ext === 'xls') {
    const workbook = XLSX.read(arrayBuffer, { type: 'array' })
    const sheetName = workbook.SheetNames[0]
    const worksheet = workbook.Sheets[sheetName]
    const json: any[] = XLSX.utils.sheet_to_json(worksheet, { defval: '' })

    for (const row of json) {
      const produto: any = { user_id: user.id }

      // Mapear colunas (aceita variações de nome)
      const nome = row.nome || row.Nome || row.nome_produto || row.produto || ''
      const descricao = row.descricao || row.Descricao || row.descricao_produto || ''
      const preco = row.preco || row.Preco || row.preco_atual || row.valor || 0
      const categoria = row.categoria || row.Categoria || ''
      const precoReferencia = row.preco_referencia || row.Preco_Referencia || row.preco_concorrencia || null
      const imagemUrl = row.imagem_url || row.Imagem || row.foto || ''
      const status = row.status || row.Status || 'ativo'

      produto.nome = String(nome || '')
      produto.descricao = String(descricao || '')
      produto.preco = parseFloat(String(preco)) || 0
      produto.categoria = String(categoria || '')
      produto.preco_referencia = precoReferencia ? parseFloat(String(precoReferencia)) || null : null
      produto.imagem_url = String(imagemUrl || '') || null
      produto.status = String(status || 'ativo')

      if (produto.nome) produtos.push(produto)
    }
  } else {
    throw new Error('Formato não suportado. Envie um arquivo .csv ou .xlsx')
  }

  if (produtos.length === 0) throw new Error('Nenhum produto válido encontrado')

  const { error } = await admin.from('produtos').insert(produtos)
  if (error) throw new Error(error.message)

  revalidatePath('/dashboard')
  revalidatePath('/produtos')
  return { success: true, total: produtos.length }
}