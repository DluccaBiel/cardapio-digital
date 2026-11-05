'use client'

import { useState } from 'react'
import { brand } from '@orvia/brand'
import { createClient } from '../../lib/supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const supabase = createClient()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    window.location.href = '/dashboard'
  }

  return (
    <div className="auth-page">
      <div className="auth-glow g1" aria-hidden="true" />
      <div className="auth-glow g2" aria-hidden="true" />
      <div className="auth-glow g3" aria-hidden="true" />
      <div className="auth-card">
        <div className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={brand.logos.mark} alt="" width={88} height={88} />
          <span className="brand-word">{brand.name}</span>
        </div>
        <div className="gold-rule" />
        <div className="tagline">{brand.tagline}</div>
        <h2>Login</h2>
        {error && <div className="flash error">{error}</div>}
        <form onSubmit={handleLogin}>
          <label>E-mail</label>
          <input type="email" required value={email} onChange={e => setEmail(e.target.value)} />
          <label>Senha</label>
          <input type="password" required value={password} onChange={e => setPassword(e.target.value)} />
          <button type="submit" className="btn btn-primary" disabled={loading} style={{ width: '100%', marginTop: '0.5rem' }}>
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
        <p style={{ marginTop: '1.25rem', fontSize: '0.9rem', color: '#8FA0C4' }}>
          Não tem conta?{' '}
          <a href="/cadastro" className="btn btn-outline" style={{ padding: '0.2rem 0.6rem', fontSize: '0.9rem', display: 'inline-block' }}>Cadastrar</a>
        </p>
        <p className="version">{brand.name} v{brand.version}</p>
        <p className="micro">Gestão · Dados · IA</p>
      </div>
    </div>
  )
}
