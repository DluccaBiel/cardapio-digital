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
      <div className="auth-streaks" aria-hidden="true" />
      <div className="auth-streaks s2" aria-hidden="true" />
      <div className="auth-redline" aria-hidden="true" />
      <div className="auth-card">
        <div className="hud" aria-hidden="true">
          <span>Box · CADASTRO</span>
          <span className="live">Pista aberta</span>
        </div>
        <div className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="wordmark" src={brand.logos.logoWhite} alt={brand.name} width={248} height={44} />
        </div>
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
        <p className="alt">
          Já tem conta?{' '}
          <a href="/login" className="btn btn-outline btn-sm">Entrar</a>
        </p>
        <p className="version">{brand.name} v{brand.version}</p>
        <p className="micro">Tráfego · Dados · Estratégia</p>
      </div>
    </div>
  )
}
