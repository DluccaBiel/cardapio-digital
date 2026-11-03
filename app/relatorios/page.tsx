import { createServerClient } from '@/lib/supabaseServer'
import { gerarRelatorio } from '@/actions/gerar-relatorio'
import { redirect } from 'next/navigation'

export default async function AdminRelatoriosPage() {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: relatorios } = await supabase
    .from('relatorios')
    .select('*')
    .eq('user_id', user.id)
    .order('criado_em', { ascending: false })

  return (
    <div className="container">
      <h1>Relatórios de Otimização</h1>

      <div className="card" style={{ maxWidth: '500px', marginBottom: '1.5rem' }}>
        <h2>Gerar Novo Relatório</h2>
        <form action={gerarRelatorio} method="POST">
          <label>Título</label>
          <input type="text" name="titulo" defaultValue="Otimização de Cardápio" />
          <button type="submit" className="btn btn-primary">Gerar Relatório Automático</button>
        </form>
      </div>

      <h2>Relatórios Existentes</h2>
      <table>
        <thead>
          <tr>
            <th>Título</th><th>Status</th><th>Criado em</th><th>Link para o Cliente</th><th>Ações</th>
          </tr>
        </thead>
        <tbody>
          {(relatorios || []).map((r: any) => (
            <tr key={r.id}>
              <td>{r.titulo}</td>
              <td>
                {r.status === 'aprovado' ? <span className="approved">{r.status}</span>
                : r.status === 'rejeitado' ? <span className="rejeitado">{r.status}</span>
                : <span className="pending">{r.status}</span>}
              </td>
              <td>{new Date(r.criado_em).toLocaleString('pt-BR')}</td>
              <td>
                <div className="link-box">
                  <input type="text" value={`${typeof window !== 'undefined' ? window.location.origin : ''}/cliente/relatorio/${r.token}`} readOnly />
                  <button type="button" className="btn btn-sm btn-outline" onClick={() => {
                    const link = `${typeof window !== 'undefined' ? window.location.origin : ''}/cliente/relatorio/${r.token}`
                    navigator.clipboard.writeText(link)
                    alert('Link copiado: ' + link)
                  }}>Copiar</button>
                </div>
              </td>
              <td>
                <a href={`/admin/relatorios/${r.id}`} className="btn btn-sm btn-outline">Editar Itens</a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}