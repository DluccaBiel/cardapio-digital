'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Building2, CheckCircle2, Loader2, LogOut, RefreshCw, TriangleAlert } from 'lucide-react'
import { disconnectMetaAction, refreshBusinessesAction, syncMetaAction, toggleBusinessAction } from '@/app/a/[ws]/meta-actions'
import { cn, Toggle } from '@/components/hub/ui'

export type MetaConnectionView = {
  id: string
  fb_user_name: string | null
  status: 'active' | 'expired' | 'revoked'
  token_expires_at: string | null
  scopes: string[]
  created_at: string
}

export type MetaBusinessView = {
  id: string
  connection_id: string
  business_id: string
  name: string
  enabled: boolean
  last_synced_at: string | null
  accounts_count: number
  sync_error: string | null
}

const STATUS_MSG: Record<string, { ok: boolean; text: string }> = {
  ok: { ok: true, text: 'Conta do Facebook conectada. Ative os portfólios que quer sincronizar.' },
  sem_portfolios: { ok: false, text: 'Conectado, mas nenhum portfólio apareceu. Confira se seu perfil tem acesso a um Gerenciador de Negócios.' },
  cancelado: { ok: false, text: 'Conexão cancelada no Facebook.' },
  state_invalido: { ok: false, text: 'A conexão expirou ou veio de outra aba. Tente de novo.' },
  sem_permissao: { ok: false, text: 'Somente dono ou coordenador conectam o Facebook.' },
  nao_configurado: { ok: false, text: 'O app da Meta ainda não está configurado no servidor (META_APP_ID, META_APP_SECRET e META_TOKEN_KEY).' },
  erro_meta: { ok: false, text: 'A Meta recusou a conexão. Confira as permissões do app (ads_read, business_management) e tente de novo.' },
  erro_salvar: { ok: false, text: 'Não consegui salvar a conexão (migration de integrações aplicada?).' },
}

/** Marca do Facebook (o lucide v1 não traz ícones de marca). */
function Facebook({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.04V9.41c0-3.02 1.8-4.7 4.54-4.7 1.31 0 2.68.24 2.68.24v2.97h-1.5c-1.5 0-1.96.93-1.96 1.89v2.26h3.33l-.53 3.49h-2.8V24C19.6 23.1 24 18.1 24 12.07z" />
    </svg>
  )
}

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—')

export function IntegrationsPanel({
  ws,
  appConfigured,
  schemaReady,
  connections,
  businesses,
  status,
}: {
  ws: string
  appConfigured: boolean
  schemaReady: boolean
  connections: MetaConnectionView[]
  businesses: MetaBusinessView[]
  status: string | null
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(status ? STATUS_MSG[status] ?? null : null)
  const enabledCount = businesses.filter((b) => b.enabled).length

  const run = async (key: string, fn: () => Promise<{ ok: true } | { ok: false; error: string }>, okText: string) => {
    setBusy(key)
    const res = await fn()
    setBusy(null)
    setMsg(res.ok ? { ok: true, text: okText } : { ok: false, text: res.error })
    if (res.ok) router.refresh()
  }

  const sync = async () => {
    setBusy('sync')
    const res = await syncMetaAction(ws)
    setBusy(null)
    if (!res.ok) return setMsg({ ok: false, text: res.error })
    setMsg({
      ok: res.errors.length === 0,
      text: `${res.total} conta(s) de anúncio sincronizada(s) de ${res.businesses} portfólio(s).${res.errors.length ? ` Avisos: ${res.errors.join(' · ')}` : ''}`,
    })
    router.refresh()
  }

  return (
    <section className="mt-5 space-y-4">
      <div className="rounded-[8px] border border-[#222225] bg-[#111113] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-[6px] bg-[#1877F2]/15 text-[#5B9BFF]">
              <Facebook size={20} />
            </span>
            <div>
              <h2 className="text-[15px] font-bold text-[#F7F5F1]">Meta (Facebook e Instagram Ads)</h2>
              <p className="mt-0.5 max-w-xl text-[12px] text-[#8E8A86]">
                Conecte sua conta do Facebook, escolha os portfólios e sincronize todas as contas de anúncio: saldo, gasto, ROAS, término e última alteração.
                O acesso é só de leitura (ads_read, business_management) e o token fica criptografado no servidor.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              href={appConfigured && schemaReady ? `/api/meta/oauth/start?ws=${encodeURIComponent(ws)}` : undefined}
              aria-disabled={!appConfigured || !schemaReady}
              className={cn(
                'inline-flex h-10 items-center gap-2 rounded-[6px] px-4 text-[13px] font-bold no-underline hover:no-underline',
                appConfigured && schemaReady ? 'bg-[#1877F2] text-white hover:bg-[#2D86FF]' : 'pointer-events-none bg-[#1D1D20] text-[#6E6A66]',
              )}
            >
              <Facebook size={15} /> {connections.length ? 'Conectar outra conta' : 'Conectar com o Facebook'}
            </a>
            <button
              type="button"
              onClick={sync}
              disabled={busy !== null || enabledCount === 0}
              className="inline-flex h-10 items-center gap-2 rounded-[6px] border border-[#2A2A2E] px-4 text-[13px] font-semibold text-[#ECE9E3] hover:border-[#D7141F] disabled:opacity-40"
            >
              {busy === 'sync' ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} Sincronizar contas
            </button>
          </div>
        </div>

        {!appConfigured && (
          <div className="mt-4 rounded-[6px] border border-[#F59E0B]/35 bg-[#F59E0B]/10 p-3 text-[12px] leading-relaxed text-[#FBBF24]">
            Falta configurar o app da Meta no servidor. Na Vercel (Settings → Environment Variables), cadastre <code>META_APP_ID</code>, <code>META_APP_SECRET</code> e{' '}
            <code>META_TOKEN_KEY</code> e refaça o deploy. No app da Meta, adicione o produto “Login do Facebook” com a URL de redirecionamento{' '}
            <code>https://undercuthub.vercel.app/api/meta/oauth/callback</code>.
          </div>
        )}
        {!schemaReady && (
          <div className="mt-4 rounded-[6px] border border-[#F59E0B]/35 bg-[#F59E0B]/10 p-3 text-[12px] text-[#FBBF24]">
            O banco ainda não tem as tabelas de integração — aplique a migration <code>20261116210000_meta_integrations.sql</code>.
          </div>
        )}
        {msg && (
          <div
            role="status"
            className={cn(
              'mt-4 flex items-start gap-2 rounded-[6px] border p-3 text-[12px]',
              msg.ok ? 'border-[#22C55E]/35 bg-[#22C55E]/10 text-[#86EFAC]' : 'border-[#D7141F]/40 bg-[#D7141F]/10 text-[#FFB199]',
            )}
          >
            {msg.ok ? <CheckCircle2 size={14} className="mt-0.5 shrink-0" /> : <TriangleAlert size={14} className="mt-0.5 shrink-0" />}
            <span>{msg.text}</span>
          </div>
        )}
      </div>

      {connections.map((conn) => {
        const list = businesses.filter((b) => b.connection_id === conn.id)
        const expired = conn.status !== 'active' || (conn.token_expires_at && new Date(conn.token_expires_at).getTime() < Date.now())
        return (
          <div key={conn.id} className="rounded-[8px] border border-[#222225] bg-[#111113]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1C1C1F] px-5 py-3">
              <div>
                <p className="text-[13px] font-semibold text-[#ECE9E3]">{conn.fb_user_name ?? 'Conta do Facebook'}</p>
                <p className="text-[11px] text-[#85817C]">
                  Conectada em {fmt(conn.created_at)} · acesso válido até {fmt(conn.token_expires_at)}
                  {expired && <span className="ml-1 font-semibold text-[#F0333D]">· expirada — reconecte</span>}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => run(`ref-${conn.id}`, () => refreshBusinessesAction(ws, conn.id), 'Lista de portfólios atualizada.')}
                  className="inline-flex h-8 items-center gap-1.5 rounded-[5px] border border-[#2A2A2E] px-3 text-[12px] text-[#CFCBC4] hover:text-white disabled:opacity-40"
                >
                  {busy === `ref-${conn.id}` ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Atualizar portfólios
                </button>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => {
                    if (window.confirm('Desconectar esta conta do Facebook? Os portfólios dela deixam de sincronizar (as contas já salvas continuam).'))
                      void run(`del-${conn.id}`, () => disconnectMetaAction(ws, conn.id), 'Conta desconectada.')
                  }}
                  className="inline-flex h-8 items-center gap-1.5 rounded-[5px] border border-[#2A2A2E] px-3 text-[12px] text-[#CFCBC4] hover:border-[#D7141F] hover:text-white disabled:opacity-40"
                >
                  <LogOut size={13} /> Desconectar
                </button>
              </div>
            </div>
            <ul className="divide-y divide-[#18181B]">
              {list.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <Building2 size={16} className="shrink-0 text-[#8E8A86]" />
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-semibold text-[#ECE9E3]">{b.name}</p>
                      <p className="text-[11px] text-[#85817C]">
                        ID {b.business_id}
                        {b.enabled && ` · ${b.accounts_count} conta(s) · última sincronização ${fmt(b.last_synced_at)}`}
                      </p>
                      {b.sync_error && <p className="text-[11px] text-[#F0333D]">{b.sync_error}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={cn('font-mono text-[10px] font-bold uppercase tracking-[0.1em]', b.enabled ? 'text-[#4ADE80]' : 'text-[#6E6A66]')}>
                      {b.enabled ? 'Conectado' : 'Desligado'}
                    </span>
                    <Toggle
                      size="sm"
                      label={`Conectar portfólio ${b.name}`}
                      checked={b.enabled}
                      disabled={busy !== null}
                      onChange={(v) => run(`tg-${b.id}`, () => toggleBusinessAction(ws, b.id, v), v ? `${b.name} conectado. Clique em Sincronizar contas.` : `${b.name} desligado.`)}
                    />
                  </div>
                </li>
              ))}
              {list.length === 0 && <li className="px-5 py-6 text-center text-[12px] text-[#85817C]">Nenhum portfólio visível para esta conta.</li>}
            </ul>
          </div>
        )
      })}
    </section>
  )
}
