'use client'

import { useEffect, useState } from 'react'
import { brand } from '@undercut/brand'
import { createClient } from '../../lib/supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'chave' | 'senha'>('senha')
  const [token, setToken] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const supabase = createClient()

  // Acesso por chave fica escondido: abre com /login?adm=1 ou clicando 5x na versão.
  const [taps, setTaps] = useState(0)
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('adm') === '1') setMode('chave')
  }, [])
  useEffect(() => { if (taps >= 5) { setMode('chave'); setTaps(0) } }, [taps])

  async function handleToken(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/auth/token-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error ?? 'Não foi possível entrar.')
        setLoading(false)
        return
      }
      const next = new URLSearchParams(window.location.search).get('next')
      window.location.href = next && next.startsWith('/') && !next.startsWith('//') ? next : '/'
    } catch {
      setError('Sem conexão com o servidor. Tente de novo.')
      setLoading(false)
    }
  }

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
        <h2>{mode === 'chave' ? 'Acesso ADM' : 'Login'}</h2>
        {error && <div className="flash error">{error}</div>}
        {mode === 'chave' ? (
          <form onSubmit={handleToken}>
            <label>Chave de acesso</label>
            <input type="password" required autoComplete="off" spellCheck={false} value={token} onChange={e => setToken(e.target.value)} placeholder="Cole a chave do administrador" />
            <button type="submit" className="btn btn-primary" disabled={loading || token.trim().length < 32} style={{ width: '100%', marginTop: '0.5rem' }}>
              {loading ? 'Entrando...' : 'Entrar com a chave'}
            </button>
            <p className="alt">
              <button type="button" className="btn btn-outline btn-sm" onClick={() => { setError(''); setMode('senha') }}>Voltar ao login normal</button>
            </p>
          </form>
        ) : (
        <>
        <form onSubmit={handleLogin}>
          <label>E-mail</label>
          <input type="email" required value={email} onChange={e => setEmail(e.target.value)} />
          <label>Senha</label>
          <input type="password" required value={password} onChange={e => setPassword(e.target.value)} />
          <button type="submit" className="btn btn-primary" disabled={loading} style={{ width: '100%', marginTop: '0.5rem' }}>
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
        </>
        )}
        <p className="alt">
          Não tem conta?{' '}
          <a href="/cadastro" className="btn btn-outline btn-sm">Cadastrar</a>
        </p>
        <p className="version" onClick={() => setTaps(t => t + 1)} style={{ userSelect: 'none' }}>{brand.name} v{brand.version}</p>
        <p className="micro">Tráfego · Dados · Estratégia</p>
      </div>
    </div>
  )
}
