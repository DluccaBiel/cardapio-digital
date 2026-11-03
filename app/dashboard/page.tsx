import { createServerClient } from '../../lib/supabaseServer'

export default async function AdminDashboard() {
  const supabase = createServerClient()

  const { data: produtos } = await supabase
    .from('produtos')
    .select('*')
    .order('criado_em', { ascending: false })

  const total = produtos?.length || 0
  const semImagem = produtos?.filter(p => !p.imagem_url).length || 0

  return (
    <div className="container">
      <h1>Dashboard Admin</h1>
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem' }}>
        <div className="card" style={{ flex: 1, textAlign: 'center' }}>
          <div style={{ fontSize: '1.75rem', fontWeight: '700', color: '#2563eb' }}>{total}</div>
          <div style={{ fontSize: '0.85rem', color: '#666' }}>Produtos</div>
        </div>
        <div className="card" style={{ flex: 1, textAlign: 'center' }}>
          <div style={{ fontSize: '1.75rem', fontWeight: '700', color: '#d97706' }}>{semImagem}</div>
          <div style={{ fontSize: '0.85rem', color: '#666' }}>Sem imagem</div>
        </div>
      </div>
      <a href="/produtos" className="btn btn-primary">Gerenciar Produtos</a>
      <a href="/relatorios" className="btn btn-outline" style={{ marginLeft: '0.5rem' }}>Relatórios</a>
    </div>
  )
}
