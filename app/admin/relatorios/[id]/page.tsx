import { createServerClient } from '../../../../lib/supabaseServer'
import { createAdminClient as createClient } from '../../../../lib/supabaseAdmin'
import { updateRelatorioItem } from '../../../../actions/update-relatorio-item'
import { applyRelatorio } from '../../../../actions/apply-relatorio'
import { redirect } from 'next/navigation'
import { notFound } from 'next/navigation'

export default async function RelatorioDetailPage({ params }: { params: { id: string } }) {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const admin = createClient()

  const { data: relatorio, error } = await admin
    .from('relatorios')
    .select('*')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .single()

  if (error || !relatorio) notFound()

  const { data: itens } = await admin
    .from('relatorio_itens')
    .select('*, produtos(*)')
    .eq('relatorio_id', params.id)
    .order('created_at', { ascending: true })

  function statusTexto(ref: number | null, atual: number) {
    if (!ref) return { texto: '-', cor: '#6b7280' }
    if (atual < ref * 0.9) return { texto: 'Abaixo', cor: '#059669' }
    if (atual > ref * 1.1) return { texto: 'Acima', cor: '#dc2626' }
    return { texto: 'Ideal', cor: '#d97706' }
  }

  return (
    <div className="container">
      <nav style={{ marginBottom: '1rem' }}>
        <a href="/relatorios" className="btn btn-outline">← Voltar aos relatórios</a>
      </nav>

      <h1>Relatório: {relatorio.titulo}</h1>
      <p>
        <strong>Status:</strong>{' '}
        {relatorio.status === 'aprovado' ? (
          <span className="approved">{relatorio.status}</span>
        ) : relatorio.status === 'rejeitado' ? (
          <span className="rejeitado">{relatorio.status}</span>
        ) : (
          <span className="pending">{relatorio.status}</span>
        )}
      </p>
      <p>Criado em: {new Date(relatorio.criado_em).toLocaleString('pt-BR')}</p>

      {relatorio.status === 'aprovado' && (
        <form action={applyRelatorio as unknown as (formData: FormData) => void} method="POST" style={{ marginBottom: '1.5rem' }}>
          <input type="hidden" name="relatorioId" value={relatorio.id} />
          <button type="submit" className="btn btn-success">
            ✅ Aplicar Alterações Aprovadas nos Produtos
          </button>
        </form>
      )}

      <h2>Itens ({itens?.length || 0})</h2>
      <table>
        <thead>
          <tr>
            <th>Produto</th><th>Preço Atual</th><th>Preço Ref.</th><th>Mercado</th>
            <th>Preço Sugerido</th><th>Ação</th><th>Aprovado?</th>
          </tr>
        </thead>
        <tbody>
          {(itens || []).map((item: any) => {
            const p = item.produtos || {}
            const atual = Number(p.preco || 0)
            const ref = item.preco_referencia != null ? Number(item.preco_referencia) : null
            const { texto, cor } = statusTexto(ref, atual)
            const sugerido = item.preco_sugerido_mercado != null
              ? item.preco_sugerido_mercado
              : item.preco_sugerido != null ? item.preco_sugerido : null

            return (
              <tr key={item.id}>
                <td><strong>{p.nome || '-'}</strong></td>
                <td>R$ {atual.toFixed(2)}</td>
                <td>{ref ? `R$ ${ref.toFixed(2)}` : '-'}</td>
                <td style={{ color: cor, fontWeight: '600' }}>{texto}</td>

                <td>
                  <form action={updateRelatorioItem as unknown as (formData: FormData) => void} method="POST" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <input type="hidden" name="itemId" value={item.id} />
                    <input type="hidden" name="relatorioId" value={relatorio.id} />
                    <input type="hidden" name="acao" value={item.acao} />
                    <input type="hidden" name="precoReferencia" value={ref ?? ''} />
                    <input type="hidden" name="comparacaoMercado" value={item.comparacao_mercado || ''} />
                    <input type="hidden" name="descricaoSugerida" value={item.descricao_sugerida || ''} />
                    <input type="hidden" name="comboSugerido" value={item.combo_sugerido || ''} />
                    <input
                      type="number"
                      step="0.01"
                      name="precoSugeridoMercado"
                      defaultValue={sugerido != null ? sugerido : ''}
                      style={{ width: '90px', padding: '0.25rem' }}
                    />
                    <button type="submit" className="btn btn-sm btn-outline">Salvar preço</button>
                  </form>
                </td>

                <td>{item.acao}</td>
                <td>
                  <form action={updateRelatorioItem as unknown as (formData: FormData) => void} method="POST" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <input type="hidden" name="itemId" value={item.id} />
                    <input type="hidden" name="relatorioId" value={relatorio.id} />
                    <input type="hidden" name="acao" value={item.acao} />
                    <input type="hidden" name="precoSugeridoMercado" value={item.preco_sugerido_mercado ?? ''} />
                    <input type="hidden" name="precoReferencia" value={ref ?? ''} />
                    <input type="hidden" name="comparacaoMercado" value={item.comparacao_mercado || ''} />
                    <input type="hidden" name="descricaoSugerida" value={item.descricao_sugerida || ''} />
                    <input type="hidden" name="comboSugerido" value={item.combo_sugerido || ''} />
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer', fontSize: '0.9rem' }}>
                      <input type="checkbox" name="aprovado" defaultChecked={item.aprovado} onChange={(e) => e.target.form?.requestSubmit()} />
                      {item.aprovado ? '✅ Sim' : '⏳ Não'}
                    </label>
                  </form>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {relatorio.status !== 'aprovado' && (
        <p style={{ color: '#6b7280', fontSize: '0.9rem', marginTop: '1rem' }}>
          O botão de aplicar só aparece depois que o cliente aprovar o relatório pelo link.
        </p>
      )}
    </div>
  )
}