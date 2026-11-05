import { createServerClient } from '../../lib/supabaseServer'
import { importarProdutosCSV } from '../actions/importar-produtos'
import { redirect } from 'next/navigation'

export default async function AdminDashboard() {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

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

      <div className="card" style={{ background: 'var(--orvia-surface)', border: '1px solid var(--orvia-primary-500)' }}>
        <h2 style={{ color: 'var(--orvia-primary-400)', marginBottom: '1rem' }}>Importar Produtos via CSV</h2>
        <p style={{ marginBottom: '1rem', color: '#a1a1aa', fontSize: '0.9rem' }}>
          Anexe sua planilha CSV com colunas: <strong>nome, descricao, preco, categoria, preco_referencia, imagem_url, status</strong>
        </p>
        <form action={importarProdutosCSV as unknown as (formData: FormData) => void} method="POST" encType="multipart/form-data" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="file"
            name="csvFile"
            accept=".csv,.xlsx,.xls"
            required
            className="btn btn-outline"
            style={{
              padding: '0.6rem 1rem',
              background: '#0f0f0f',
              color: '#e5e5e5',
              border: '1px solid #3a3a3a',
              borderRadius: '8px',
              cursor: 'pointer',
            }}
          />
          <button type="submit" className="btn btn-primary" style={{ padding: '0.6rem 1.5rem' }}>
            Importar Produtos
          </button>
        </form>
        <p style={{ marginTop: '0.8rem', fontSize: '0.8rem', color: '#666' }}>
          Exporte seus produtos em CSV ou Excel (.xlsx) e anexe aqui para sincronizar tudo de uma vez.
        </p>
      </div>

      <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem' }}>
        <a href="/produtos" className="btn btn-primary">Gerenciar Produtos</a>
        <a href="/relatorios" className="btn btn-outline" style={{ marginLeft: '0.5rem' }}>Relatórios</a>
      </div>
    </div>
  )
}