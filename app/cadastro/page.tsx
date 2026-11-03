'use client'

import { useState } from 'react'
import { createClient } from '../../lib/supabase'

export default function Cadastro() {
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const supabase = createClient()

  async function handleCadastro(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { username, role: 'cliente' } }
    })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    if (data.user) {
      window.location.href = '/login'
    }
  }

  return (
    <div className="container">
      <div className="card" style={{ maxWidth: '400px' }}>
        <h2>Cadastro de Cliente</h2>
        {error && <div className="flash error">{error}</div>}
        <form onSubmit={handleCadastro}>
          <label>Nome de usuário</label>
          <input type="text" required value={username} onChange={e => setUsername(e.target.value)} />
          <label>E-mail</label>
          <input type="email" required value={email} onChange={e => setEmail(e.target.value)} />
          <label>Senha</label>
          <input type="password" required value={password} onChange={e => setPassword(e.target.value)} />
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Criando...' : 'Criar conta'}
          </button>
        </form>
        <p style={{ marginTop: '1rem', fontSize: '0.9rem' }}>
          Já tem conta? <a href="/login" className="btn btn-outline" style={{ padding: '0.2rem 0.6rem' }}>Entrar</a>
        </p>
      </div>
    </div>
  )
}
