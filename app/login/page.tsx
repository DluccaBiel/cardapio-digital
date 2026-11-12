'use client'

import { useState } from 'react'
import { brand } from '@undercut/brand'
import { createClient } from '../../lib/supabase'

type AccountType = 'coordenador' | 'usuario' | 'teste' | 'owner'

const ACCOUNTS: Record<AccountType, { email: string; password: string; label: string; showCustomInput: boolean }> = {
  coordenador: {
    email: 'coordenador@undercut.com',
    password: 'coordenador123',
    label: 'Coordenador / Suporte',
    showCustomInput: false,
  },
  usuario: {
    email: 'usuario@undercut.com',
    password: 'usuario123',
    label: 'Usuário Comum',
    showCustomInput: false,
  },
  teste: {
    email: 'teste@undercut.com',
    password: 'teste123',
    label: 'Usuário Teste',
    showCustomInput: false,
  },
  owner: {
    email: 'owner@undercut.com',
    password: 'owner123',
    label: 'OWNER',
    showCustomInput: true,
  },
}

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [accountType, setAccountType] = useState<AccountType>('usuario')
  const supabase = createClient()

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.name === 'email') setEmail(e.target.value)
    else if (e.target.name === 'password') setPassword(e.target.value)
    else if (e.target.name === 'accountType') setAccountType(e.target.value as AccountType)
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    // Use the selected account credentials
    const account = ACCOUNTS[accountType]
    
    // If owner with custom input, use the email/password typed by the user
    const loginEmail = accountType === 'owner' ? email : account.email
    const loginPassword = accountType === 'owner' ? password : account.password

    const { error } = await supabase.auth.signInWithPassword({
      email: loginEmail,
      password: loginPassword,
    })

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
          <div className="form-group">
            <label>E-mail</label>
            <input
              type="email"
              required
              value={email}
              onChange={e => handleChange(e)}
              name="email"
            />
          </div>
          <div className="form-group">
            <label>Senha</label>
            <input
              type="password"
              required
              value={password}
              onChange={e => handleChange(e)}
              name="password"
            />
          </div>

          <div className="form-group">
            <label>Conta</label>
            <select
              value={accountType}
              onChange={(e) => handleChange(e)}
              className="select-select"
            >
              <option value="usuario">Usuário Comum</option>
              <option value="coordenador">Coordenador / Suporte</option>
              <option value="teste">Usuário Teste</option>
              <option value="owner">OWNER</option>
            </select>
          </div>
          
          {ACCOUNTS[accountType].showCustomInput && (
            <div className="form-group">
              <label>Credenciais OWNER</label>
              <p className="text-[11px] text-[#85817C] mt-1">
                Use as credenciais do proprietário do sistema
              </p>
              <input
                type="email"
                required
                value={email}
                onChange={e => handleChange(e)}
                name="email"
                placeholder="owner@undercut.com"
              />
              <input
                type="password"
                required
                value={password}
                onChange={e => handleChange(e)}
                name="password"
                placeholder="senha do owner"
              />
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading}
            style={{ width: '100%', marginTop: '0.5rem' }}
          >
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
        <p className="alt">
          Não tem conta?{' '}
          <a href="/cadastro" className="btn btn-outline btn-sm">
            Cadastrar
          </a>
        </p>
        <p className="version">{brand.name} v{brand.version}</p>
        <p className="micro">Tráfego · Dados · Estratégia</p>
      </div>
    </div>
  )
}