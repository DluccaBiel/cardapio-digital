'use client'

import { useState } from 'react'
import { brand } from '@orvia/brand'
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
    <div className="auth-page">
      <div className="auth-bg-words" aria-hidden="true">
        <span className="w1">Gestão</span>
        <span className="w2">Inteligência</span>
        <span className="w3">Estratégia</span>
        <span className="w4">Revolução</span>
      </div>
      <div className="auth-card">
        <div className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={brand.logos.logoWhite} alt={brand.name} width={230} height={61} />
        </div>
        <div className="gold-rule" />
        <div className="tagline">{brand.tagline}</div>
        <h2>Cadastro de Cliente</h2>
        {error && <div className="flash error">{error}</div>}
        <form onSubmit={handleCadastro}>
          <label>Nome de usuário</label>
          <input type="text" required value={username} onChange={e => setUsername(e.target.value)} />
          <label>E-mail</label>
          <input type="email" required value={email} onChange={e => setEmail(e.target.value)} />
          <label>Senha</label>
          <input type="password" required value={password} onChange={e => setPassword(e.target.value)} />
          <button type="submit" className="btn btn-primary" disabled={loading} style={{ width: '100%', marginTop: '0.5rem' }}>
            {loading ? 'Criando...' : 'Criar conta'}
          </button>
        </form>
        <p style={{ marginTop: '1.25rem', fontSize: '0.9rem', color: '#8FA0C4' }}>
          Já tem conta?{' '}
          <a href="/login" className="btn btn-outline" style={{ padding: '0.2rem 0.6rem', fontSize: '0.9rem', display: 'inline-block' }}>Entrar</a>
        </p>
        <p className="version">{brand.name} v{brand.version}</p>
        <p className="micro">Gestão · Dados · IA</p>
      </div>
    </div>
  )
}
