'use server'

import { createAdminClient as createClient } from '../lib/supabaseAdmin'

export async function clienteResponder(formData: FormData) {
  const token = formData.get('token') as string
  const acao = formData.get('acao') as string // 'aprovar' | 'rejeitar'

  const admin = createClient()

  const { data: relatorio, error } = await admin
    .from('relatorios')
    .select('*')
    .eq('token', token)
    .single()

  if (error || !relatorio) throw new Error('Relatório não encontrado')

  if (acao === 'aprovar') {
    await admin
      .from('relatorio_itens')
      .update({ aprovado: true })
      .eq('relatorio_id', relatorio.id)

    await admin
      .from('relatorios')
      .update({ status: 'aprovado', aprovado_em: new Date().toISOString() })
      .eq('id', relatorio.id)
  } else if (acao === 'rejeitar') {
    await admin
      .from('relatorios')
      .update({ status: 'rejeitado' })
      .eq('id', relatorio.id)
  }

  return { success: true }
}
