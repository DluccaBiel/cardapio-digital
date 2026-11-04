'use client'

import { useState, useEffect } from 'react'
import { createClient } from '../../lib/supabase'

export default function Produtos() {
  const [produtos, setProdutos] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [novo, setNovo] = useState({
    nome: '', descricao: '', preco: '', categoria: '',
    status: 'ativo', preco_referencia: '',
  })
  const [imagem, setImagem] = useState<File | null>(null)

  const supabase = createClient()

  useEffect(() => { carregar() }, [])

  async function carregar() {
    const { data } = await supabase
      .from('produtos')
      .select('*')
      .order('criado_em', { ascending: false })
    setProdutos(data || [])
    setLoading(false)
  }

  async function adicionar(e: React.FormEvent) {
    e.preventDefault()
    let imagemUrl = ''

    if (imagem) {
      const nomeArquivo = `${Date.now()}-${imagem.name}`
      const { error: uploadError } = await supabase.storage
        .from('produto-imagens')
        .upload(nomeArquivo, imagem)
      if (uploadError) {
        alert('Erro ao enviar imagem: ' + uploadError.message)
        return
      }
      imagemUrl = supabase.storage.from('produto-imagens').getPublicUrl(nomeArquivo).data.publicUrl
    }

    const { error } = await supabase.from('produtos').insert([
      {
        nome: novo.nome,
        descricao: novo.descricao,
        preco: parseFloat(novo.preco) || 0,
        categoria: novo.categoria,
        imagem_url: imagemUrl,
        status: novo.status,
        preco_referencia: novo.preco_referencia ? parseFloat(novo.preco_referencia) : null,
      }
    ])

    if (error) { alert('Erro: ' + error.message); return }

    carregar()
    setNovo({ nome: '', descricao: '', preco: '', categoria: '', status: 'ativo', preco_referencia: '' })
    setImagem(null)
  }

  function statusMercado(atual: number, ref: number | null) {
    if (!ref) return { texto: '-', cor: '#6b7280' }
    if (atual < ref * 0.9) return { texto: 'Abaixo', cor: '#059669' }
    if (atual > ref * 1.1) return { texto: 'Acima', cor: '#dc2626' }
    return { texto: 'Ideal', cor: '#d97706' }
  }

  return (
    <div className="container">
      <h1>Produtos</h1>

      <div className="card">
        <h2>Adicionar Produto</h2>
        <form onSubmit={adicionar}>
          <label>Nome</label>
          <input required value={novo.nome} onChange={e => setNovo({ ...novo, nome: e.target.value })} />

          <label>Descrição</label>
          <textarea value={novo.descricao} onChange={e => setNovo({ ...novo, descricao: e.target.value })} />

          <label>Preço Atual (R$)</label>
          <input type="number" step="0.01" required value={novo.preco} onChange={e => setNovo({ ...novo, preco: e.target.value })} />

          <label>Preço de Referência / Concorrência (R$)</label>
          <input type="number" step="0.01" value={novo.preco_referencia} onChange={e => setNovo({ ...novo, preco_referencia: e.target.value })} />
          <p style={{ fontSize: '0.8rem', color: '#666' }}>Preço praticado pela concorrência para comparação.</p>

          <label>Categoria</label>
          <input value={novo.categoria} onChange={e => setNovo({ ...novo, categoria: e.target.value })} />

          <label>Imagem (própria)</label>
          <input type="file" accept="image/*" onChange={e => setImagem(e.target.files?.[0] || null)} />

          <label>Status</label>
          <select value={novo.status} onChange={e => setNovo({ ...novo, status: e.target.value })}>
            <option value="ativo">Ativo</option>
            <option value="inativo">Inativo</option>
          </select>

          <button type="submit" className="btn btn-primary">Adicionar Produto</button>
        </form>
      </div>

      <h2>Lista de Produtos</h2>
      {loading ? <p>Carregando...</p> : (
        <table>
          <thead>
            <tr>
              <th>Imagem</th><th>Nome</th><th>Categoria</th><th>Preço Atual</th><th>Preço Ref.</th><th>Status Mercado</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {produtos.map((p: any) => {
              const atual = Number(p.preco || 0)
              const ref = p.preco_referencia != null ? Number(p.preco_referencia) : null
              const { texto, cor } = statusMercado(atual, ref)
              return (
                <tr key={p.id}>
                  <td>{p.imagem_url ? <img src={p.imagem_url} style={{ width: '50px', height: '50px', objectFit: 'cover', borderRadius: '6px' }} /> : 'sem foto'}</td>
                  <td><strong>{p.nome}</strong></td>
                  <td>{p.categoria || '-'}</td>
                  <td>R$ {atual.toFixed(2)}</td>
                  <td>{ref ? `R$ ${ref.toFixed(2)}` : '-'}</td>
                  <td style={{ color: cor, fontWeight: '600' }}>{texto}</td>
                  <td>{p.status}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
