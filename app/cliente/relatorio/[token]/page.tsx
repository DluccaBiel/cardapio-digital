import { createAdminClient as createClient } from '../../../../lib/supabaseAdmin'
import { clienteResponder } from '../../../../actions/cliente-responder'
import { notFound } from 'next/navigation'

export default async function ClienteRelatorioPage({ params }: { params: { token: string } }) {
  const admin = createClient()

  const { data: relatorio, error } = await admin
    .from('relatorios')
    .select('*')
    .eq('token', params.token)
    .single()

  if (error || !relatorio) notFound()

  const { data: itens } = await admin
    .from('relatorio_itens')
    .select('*, produtos(*)')
    .eq('relatorio_id', relatorio.id)
    .order('created_at', { ascending: true })

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
      <h1>Relatório de Otimização do Cardápio</h1>
      <p><strong>{relatorio.titulo}</strong></p>
      <p>
        <strong>Status:</strong>{' '}
        {relatorio.status === 'aprovado' ? <span style={{ color: '#059669', fontWeight: '600' }}>✅ Aprovado</span>
        : relatorio.status === 'rejeitado' ? <span style={{ color: '#dc2626', fontWeight: '600' }}>❌ Rejeitado</span>
        : <span style={{ color: '#d97706', fontWeight: '600' }}>⏳ Pendente</span>}
      </p>

      {relatorio.status === 'gerado' || relatorio.status === 'enviado' ? (
        <div style={{ background: '#f3f4f6', padding: '1.5rem', borderRadius: '12px', marginBottom: '1.5rem' }}>
          <h2>Deseja aprovar ou rejeitar este relatório?</h2>
          <p>Ao aprovar, as alterações sugeridas serão aplicadas ao cardápio.</p>
          <form action={clienteResponder} method="POST" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <input type="hidden" name="token" value={relatorio.token} />
            <button type="submit" name="acao" value="aprovar" className="btn btn-success">✅ Aprovar Relatório</button>
            <button type="submit" name="acao" value="rejeitar" className="btn btn-danger">❌ Rejeitar Relatório</button>
          </form>
        </div>
      ) : null}

      <h2>Itens Sugeridos</h2>
      <table>
        <thead>
          <tr>
            <th>Produto</th><th>Preço Atual</th><th>Preço Sugerido</th><th>Status Mercado</th><th>Combo Sugerido</th><th>Descrição Sugerida</th>
          </tr>
        </thead>
        <tbody>
          {(itens || []).map((item: any) => {
            const p = item.produtos || {}
            const atual = Number(p.preco || 0)
            const ref = item.preco_referencia != null ? Number(item.preco_referencia) : null
            let mercado = '-'
            if (ref) {
              if (atual < ref * 0.9) mercado = 'Abaixo'
              else if (atual > ref * 1.1) mercado = 'Acima'
              else mercado = 'Ideal'
            }
            return (
              <tr key={item.id}>
                <td><strong>{p.nome || '-'}</strong></td>
                <td>R$ {atual.toFixed(2)}</td>
                <td>{item.preco_sugerido_mercado != null ? `R$ ${Number(item.preco_sugerido_mercado).toFixed(2)}` : item.preco_sugerido != null ? `R$ ${Number(item.preco_sugerido).toFixed(2)}` : '-'}</td>
                <td>{mercado}</td>
                <td>{item.combo_sugerido || '-'}</td>
                <td>{item.descricao_sugerida || '-'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {relatorio.status === 'aprovado' && (
        <p style={{ marginTop: '1rem', color: '#059669', fontWeight: '600' }}>
          ✅ Este relatório foi aprovado. O administrador poderá aplicar as alterações nos produtos.
        </p>
      )}
      {relatorio.status === 'rejeitado' && (
        <p style={{ marginTop: '1rem', color: '#dc2626', fontWeight: '600' }}>
          ❌ Este relatório foi rejeitado.
        </p>
      )}
    </div>
  )
}