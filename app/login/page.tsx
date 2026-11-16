import { LoginForm, type DevAccount } from './LoginForm'

export const dynamic = 'force-dynamic'

/**
 * Atalhos de conta SÓ no ambiente local (`next dev`).
 * As senhas NÃO ficam no código: vêm de variáveis do .env.local (gitignored),
 * lidas aqui no servidor. Em produção (NODE_ENV=production) a lista é vazia e
 * nada é enviado ao navegador.
 *
 *   DEV_LOGIN_USUARIO_PASSWORD=...
 *   DEV_LOGIN_COORDENADOR_PASSWORD=...
 *   DEV_LOGIN_TESTE_PASSWORD=...
 *   DEV_LOGIN_OWNER_PASSWORD=...
 */
function devAccounts(): DevAccount[] {
  if (process.env.NODE_ENV !== 'development') return []
  return [
    { label: 'Usuário comum', email: 'usuario@undercut.com', password: process.env.DEV_LOGIN_USUARIO_PASSWORD || null },
    { label: 'Coordenador / Suporte', email: 'coordenador@undercut.com', password: process.env.DEV_LOGIN_COORDENADOR_PASSWORD || null },
    { label: 'Usuário teste', email: 'teste@undercut.com', password: process.env.DEV_LOGIN_TESTE_PASSWORD || null },
    { label: 'Owner', email: 'owner@undercut.com', password: process.env.DEV_LOGIN_OWNER_PASSWORD || null },
  ]
}

export default function LoginPage() {
  return <LoginForm devAccounts={devAccounts()} />
}
