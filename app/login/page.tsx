'use client'

import { useState } from 'react'
import { brand } from '@undercut/brand'
import { createClient } from '../../lib/supabase'

/**
 * Atalhos de conta SÓ no ambiente local (`next dev`): preenchem apenas o e-mail.
 * Nenhuma senha fica no código. Em build de produção, NODE_ENV é 'production'
 * e o bloco é removido do bundle.
 */
const DEV_ACCOUNTS =
  process.env.NODE_ENV === 'development'
    ? [
        { label: 'Usuário comum', email: 'usuario@undercut.com' },
        { label: 'Coordenador / Suporte', email: 'coordenador@undercut.com' },
        { label: 'Usuário teste', email: 'teste@undercut.com' },
        { label: 'Owner', email: 'owner@undercut.com' },
      ]
    : []

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

    window.location.href = '/'
  }

  return (
    <div className="auth-page">
      <div className="auth-streaks" aria-hidden="true" />
      <div className="auth-streaks s2" aria-hidden="true" />
      <div className="auth-redline" aria-hidden="true" />
      <div className="auth-card">
        <div className="hud" aria-hidden="true">
          <span>Box · LOGIN</span>
          <span className="live">Pista aberta</span>
        </div>
        <div className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="wordmark" src={brand.logos.logoWhite} alt={brand.name} width={248} height={44} />
        </div>
        <div className="tagline">{brand.tagline}</div>
        <h2>Login</h2>
        {error && <div className="flash error">{error}</div>}
        <form onSubmit={handleLogin}>
          {DEV_ACCOUNTS.length > 0 && (
            <>
              <label htmlFor="dev-account">Conta (atalho local)</label>
              <select
                id="dev-account"
                value={DEV_ACCOUNTS.some(a => a.email === email) ? email : ''}
                onChange={e => {
                  setEmail(e.target.value)
                  setPassword('')
                }}
              >
                <option value="">— Digitar e-mail —</option>
                {DEV_ACCOUNTS.map(a => (
                  <option key={a.email} value={a.email}>
                    {a.label} · {a.email}
                  </option>
                ))}
              </select>
            </>
          )}
          <label>E-mail</label>
          <input type="email" required value={email} onChange={e => setEmail(e.target.value)} />
          <label>Senha</label>
          <input type="password" required value={password} onChange={e => setPassword(e.target.value)} />
          <button type="submit" className="btn btn-primary" disabled={loading} style={{ width: '100%', marginTop: '0.5rem' }}>
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
        <p className="alt">
          Não tem conta?{' '}
          <a href="/cadastro" className="btn btn-outline btn-sm">Cadastrar</a>
        </p>
        <p className="version">{brand.name} v{brand.version}</p>
        <p className="micro">Tráfego · Dados · Estratégia</p>
      </div>
    </div>
  )
}
