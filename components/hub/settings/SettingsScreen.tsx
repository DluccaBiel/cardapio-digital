'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import {
  Check,
  Copy,
  ExternalLink,
  KeyRound,
  Loader2,
  Lock,
  Plus,
  Settings,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
  Wifi,
  WifiOff,
} from 'lucide-react'
import { cn, FieldLabel, Modal, TextInput, TextSelect, Toast } from '@/components/hub/ui'
import { Btn, Empty } from '@/components/hub/menu/shared'
import { ExtensionHub, type HubExtension } from '@/components/hub/extensions/ExtensionHub'
import {
  createClientAction,
  inviteMemberAction,
  removeMemberAction,
  updateMemberRoleAction,
} from '@/app/a/[ws]/configuracoes/actions'

export type SettingsMember = { id: string; user_id: string; role: string; created_at: string; email: string | null }
export type SettingsClient = {
  id: string
  name: string
  status: string
  email: string | null
  monthly_fee: number | null
  created_at: string
  /** Canais já vinculados (trava de loja gravada pela extensão). */
  ifood_merchant_id?: string | null
  cardapioweb_store_id?: string | null
  anotaai_store_id?: string | null
}
type InstallKey = { revoked_at?: string | null; expires_at?: string | null }
type Install = { extension_id: string; version: string | null; last_seen_at: string | null; status: string; api_keys?: InstallKey | InstallKey[] | null }

const ROLE_LABEL: Record<string, string> = { owner: 'OWNER', coordenador: 'SUPORTE', editor: 'EDITOR', visualizador: 'VISUALIZADOR' }

/** Data fixa em America/Sao_Paulo: servidor (UTC) e navegador renderizam o mesmo texto. */
function date(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
}

function keyOf(i: Install): InstallKey | null {
  return (Array.isArray(i.api_keys) ? i.api_keys[0] : i.api_keys) ?? null
}
function isOnline(i: Install | undefined): boolean {
  if (!i) return false
  const k = keyOf(i)
  if (!k || k.revoked_at || (k.expires_at && new Date(k.expires_at).getTime() < Date.now())) return false
  return Boolean(i.last_seen_at && Date.now() - new Date(i.last_seen_at).getTime() < 10 * 60_000)
}

type Tab = 'geral' | 'equipe' | 'clientes' | 'extensoes' | 'seguranca'
const TABS: { id: Tab; label: string; icon: typeof Settings }[] = [
  { id: 'geral', label: 'Visão geral', icon: Settings },
  { id: 'equipe', label: 'Equipe e acessos', icon: Users },
  { id: 'clientes', label: 'Clientes', icon: UserPlus },
  { id: 'extensoes', label: 'Extensões', icon: KeyRound },
  { id: 'seguranca', label: 'Segurança', icon: ShieldCheck },
]

export function SettingsScreen({
  ws,
  workspaceName,
  workspaceSlug,
  plan,
  role,
  canManage,
  shortUrl,
  members,
  clients,
  extensions,
  installs,
  activeKeys,
}: {
  ws: string
  workspaceName: string
  workspaceSlug: string
  plan: string
  role: string
  canManage: boolean
  shortUrl: string
  members: SettingsMember[]
  clients: SettingsClient[]
  extensions: HubExtension[]
  installs: Install[]
  activeKeys: number
}) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('geral')
  const [toast, setToast] = useState<string | null>(null)
  const [invite, setInvite] = useState(false)
  const [newClient, setNewClient] = useState(false)
  const [busyMember, setBusyMember] = useState<string | null>(null)
  const onlineIds = new Set(extensions.filter((e) => isOnline(installs.find((i) => i.extension_id === e.id))).map((e) => e.id))
  const onlineCount = onlineIds.size
  const canAdmin = role === 'owner'

  const flash = (message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(null), 4000)
  }

  const changeRole = async (memberId: string, next: string) => {
    setBusyMember(memberId)
    const res = await updateMemberRoleAction(ws, { memberId, role: next })
    setBusyMember(null)
    flash(res.ok ? 'Papel atualizado.' : res.error)
    if (res.ok) router.refresh()
  }

  const remove = async (memberId: string) => {
    setBusyMember(memberId)
    const res = await removeMemberAction(ws, memberId)
    setBusyMember(null)
    flash(res.ok ? 'Acesso removido.' : res.error)
    if (res.ok) router.refresh()
  }

  return (
    <div className="relative mx-auto w-full max-w-[1400px] px-4 pb-12 pt-5 sm:px-6 md:px-[30px] md:pt-[26px]">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-64 bg-[radial-gradient(ellipse_at_top,rgba(215,20,31,0.10),transparent_62%)]" aria-hidden="true" />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="uc-title text-[32px] text-[#F7F5F1] md:text-[40px]">Configurações</h1>
          <p className="mt-1 text-[13px] text-[#8E8A86]">
            ADM do workspace <span className="text-[#CFCBC4]">{workspaceName}</span> · acessos, clientes, extensões e segurança.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-[#C8C2B8]/40 bg-[#2A2308] px-3 py-1.5 font-mono text-[10px] font-extrabold uppercase tracking-[0.16em] text-[#C8C2B8]">
            {ROLE_LABEL[role] ?? role.toUpperCase()}
          </span>
          <Link
            href={`/a/${ws}/extensoes`}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] px-3 text-[12px] font-semibold text-[#DAD6CF] no-underline hover:border-[#D7141F]/45 hover:text-white hover:no-underline"
          >
            <Wifi size={14} /> Extensões
          </Link>
        </div>
      </div>

      <div role="tablist" aria-label="Configurações" className="mt-5 flex flex-wrap gap-1.5">
        {TABS.map((t) => {
          const Icon = t.icon
          const active = tab === t.id
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.id)}
              className={cn(
                'inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-[12px] font-semibold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D7141F]',
                active
                  ? 'border-[#D7141F]/60 bg-[#D7141F]/15 text-[#F7F5F1] shadow-[0_0_22px_-8px_rgba(215,20,31,0.8)]'
                  : 'border-white/[0.08] bg-white/[0.02] text-[#9F9A94] hover:border-white/20 hover:text-white',
              )}
            >
              <Icon size={14} /> {t.label}
            </button>
          )
        })}
      </div>

      {tab === 'geral' && (
        <div className="uc-fade-up mt-4 grid gap-3 lg:grid-cols-3">
          <div className="rounded-3xl border border-white/[0.08] bg-[#0C0C0E] p-5 lg:col-span-2">
            <h2 className="text-[15px] font-bold text-[#F7F5F1]">Workspace</h2>
            <dl className="mt-3 grid gap-2 sm:grid-cols-2">
              <Info label="Nome" value={workspaceName} />
              <Info label="Slug" value={workspaceSlug} mono />
              <Info label="Plano" value={plan} />
              <Info label="Papel" value={ROLE_LABEL[role] ?? role} />
            </dl>
            {shortUrl && (
              <div className="mt-4 flex flex-wrap items-center gap-2 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-3">
                <span className="font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-[#85817C]">Link curto de acesso</span>
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[#B8B3AC]">{shortUrl}</span>
                <CopyButton value={shortUrl} />
              </div>
            )}
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              <Summary label="Extensões conectadas" value={`${onlineCount}/${extensions.length}`} ok={onlineCount > 0} />
              <Summary label="Chaves ativas" value={String(activeKeys)} ok={activeKeys > 0} />
              <Summary label="Clientes" value={String(clients.length)} ok={clients.length > 0} />
            </div>
          </div>
          <div className="rounded-3xl border border-white/[0.08] bg-[#0C0C0E] p-5">
            <h2 className="text-[15px] font-bold text-[#F7F5F1]">Conexões por extensão</h2>
            <ul className="mt-3 space-y-2">
              {extensions.length === 0 && <li className="text-[12px] text-[#85817C]">Nenhuma extensão no catálogo.</li>}
              {extensions.map((e) => {
                const inst = installs.find((i) => i.extension_id === e.id)
                const on = onlineIds.has(e.id)
                return (
                  <li key={e.id} className="flex items-center justify-between gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2">
                    <span className="min-w-0">
                      <span className="block truncate text-[12px] font-semibold text-[#ECE9E3]">{e.name}</span>
                      <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-[#55555C]">{inst?.version ? `v${inst.version}` : 'sem versão'}</span>
                    </span>
                    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold', on ? 'bg-[#34D399]/12 text-[#6EE7B7]' : 'bg-white/[0.04] text-[#85817C]')}>
                      {on ? <Wifi size={11} /> : <WifiOff size={11} />} {on ? 'online' : 'offline'}
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        </div>
      )}

      {tab === 'equipe' && (
        <section className="uc-fade-up mt-4 rounded-3xl border border-white/[0.08] bg-[#0C0C0E] p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-[15px] font-bold text-[#F7F5F1]">Equipe e acessos</h2>
              <p className="mt-1 text-[12px] text-[#85817C]">OWNER cria e altera acessos. SUPORTE (coordenador) vê todos os clientes e extensões.</p>
            </div>
            {canAdmin && (
              <Btn variant="primary" onClick={() => setInvite(true)}>
                <UserPlus size={14} /> Novo acesso
              </Btn>
            )}
          </div>
          {members.length === 0 ? (
            <div className="mt-4">
              <Empty title="Nenhum acesso listado">Só o owner enxerga a equipe completa.</Empty>
            </div>
          ) : (
            <div className="mt-4 overflow-x-auto rounded-2xl border border-white/[0.07]">
              <table className="w-full min-w-[560px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-white/[0.06] bg-black/30 font-mono text-[10px] uppercase tracking-[0.1em] text-[#8E8A86]">
                    <th className="px-3 py-2.5">E-mail</th>
                    <th className="px-3 py-2.5">Papel</th>
                    <th className="px-3 py-2.5">Desde</th>
                    <th className="px-3 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => (
                    <tr key={m.id} className="border-b border-white/[0.05] text-[12px] last:border-b-0">
                      <td className="px-3 py-2.5 text-[#ECE9E3]">{m.email ?? <span className="font-mono text-[#85817C]">{m.user_id.slice(0, 8)}…</span>}</td>
                      <td className="px-3 py-2.5">
                        {canAdmin ? (
                          <select
                            value={m.role}
                            disabled={busyMember === m.id}
                            onChange={(e) => changeRole(m.id, e.target.value)}
                            className="h-8 rounded-lg border border-white/10 bg-[#0B0B0C] px-2 text-[12px] text-[#ECE9E3] outline-none focus:border-[#D7141F]"
                          >
                            <option value="owner">OWNER</option>
                            <option value="coordenador">SUPORTE</option>
                            <option value="editor">EDITOR</option>
                            <option value="visualizador">VISUALIZADOR</option>
                          </select>
                        ) : (
                          <span className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 font-mono text-[10px] text-[#CFCBC4]">{ROLE_LABEL[m.role] ?? m.role}</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-[#8E8A86]">{date(m.created_at)}</td>
                      <td className="px-3 py-2.5 text-right">
                        {canAdmin && (
                          <button
                            type="button"
                            disabled={busyMember === m.id}
                            onClick={() => remove(m.id)}
                            className="inline-flex h-8 items-center gap-1 rounded-lg border border-[#FF6A3D]/30 px-2 text-[11px] font-semibold text-[#FFB199] hover:bg-[#FF6A3D]/10 disabled:opacity-50"
                          >
                            {busyMember === m.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} Remover
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!canAdmin && <p className="mt-3 text-[11px] text-[#85817C]">Somente o OWNER cria/remove acessos. Você pode ver a equipe e todos os clientes.</p>}
        </section>
      )}

      {tab === 'clientes' && (
        <section className="uc-fade-up mt-4 rounded-3xl border border-white/[0.08] bg-[#0C0C0E] p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-[15px] font-bold text-[#F7F5F1]">Clientes</h2>
              <p className="mt-1 text-[12px] text-[#85817C]">Cada cliente tem seus canais (iFood, Cardápio Web, Anota AI) e aparece no relatório das extensões.</p>
            </div>
            {canManage && (
              <Btn variant="primary" onClick={() => setNewClient(true)}>
                <Plus size={14} /> Novo cliente
              </Btn>
            )}
          </div>
          {clients.length === 0 ? (
            <div className="mt-4">
              <Empty title="Nenhum cliente cadastrado">Cadastre o primeiro cliente para conectar extensões, cardápio e relatórios.</Empty>
            </div>
          ) : (
            <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {clients.map((c) => {
                const channels: { key: string; label: string }[] = []
                if (c.ifood_merchant_id) channels.push({ key: 'ifood', label: 'iFood' })
                if (c.cardapioweb_store_id) channels.push({ key: 'cw', label: 'Cardápio Web' })
                if (c.anotaai_store_id) channels.push({ key: 'anotaai', label: 'Anota AI' })
                return (
                  <article key={c.id} className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-3.5">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="min-w-0 truncate text-[13px] font-bold text-[#F7F5F1]">{c.name}</h3>
                      <span className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-[#9F9A94]">{c.status}</span>
                    </div>
                    <p className="mt-1 truncate text-[11px] text-[#85817C]">{c.email ?? 'sem e-mail cadastrado'}</p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {channels.length > 0 ? (
                        channels.map((ch) => (
                          <span
                            key={ch.key}
                            className="inline-flex items-center gap-1 rounded-full border border-[#34D399]/30 bg-[#34D399]/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-[#A7F3D0]"
                          >
                            <span className="h-1 w-1 rounded-full bg-[#34D399]" aria-hidden="true" /> {ch.label}
                          </span>
                        ))
                      ) : (
                        <span className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-[#85817C]">
                          sem canal conectado
                        </span>
                      )}
                    </div>
                    <div className="mt-2 flex items-center justify-between font-mono text-[10px] text-[#55555C]">
                      <span>{c.monthly_fee != null ? `R$ ${c.monthly_fee.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}/mês` : 'sem honorário'}</span>
                      <span>{date(c.created_at)}</span>
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </section>
      )}

      {tab === 'extensoes' && (
        <div className="uc-fade-up mt-4">
          <ExtensionHub ws={ws} extensions={extensions} onlineIds={onlineIds} canManage={canManage} onToast={flash} />
          <div className="mt-3 rounded-2xl border border-[#FBBF24]/20 bg-[#FBBF24]/[0.05] px-4 py-3 text-[12px] leading-relaxed text-[#FDE68A]">
            O catálogo é global: uma extensão cadastrada aqui aparece para todos os workspaces. Use slugs estáveis (ex.: <span className="font-mono">undercut-99food</span>) e publique o .zip em <span className="font-mono">public/extensoes/</span>.
          </div>
        </div>
      )}

      {tab === 'seguranca' && (
        <section className="uc-fade-up mt-4 grid gap-3 lg:grid-cols-2">
          <div className="rounded-3xl border border-[#34D399]/25 bg-[#34D399]/[0.04] p-5">
            <h2 className="flex items-center gap-2 text-[15px] font-bold text-[#F7F5F1]">
              <Lock size={16} className="text-[#6EE7B7]" /> Verificação de segurança
            </h2>
            <ul className="mt-3 space-y-2 text-[12px] leading-relaxed text-[#CFCBC4]">
              {[
                'Chaves de API guardadas só como hash SHA-256; o valor aparece uma única vez.',
                'RLS ativo em todas as tabelas; service role só no servidor (nunca no navegador/extensão).',
                'Escopos mínimos por extensão + rate limit por chave (padrão 60 req/min).',
                'If-Match obrigatório nas escritas da API (controle de edição concorrente).',
                'HTTPS + HSTS e cabeçalhos de segurança (nosniff, frame-ancestors, referrer).',
                'Prints em bucket privado com URL assinada de 10 min e escopo por workspace.',
                'Pesquisa com fontes públicas e proteção SSRF; nada de conteúdo sensível no audit_log.',
                'Retenção: audit 12 meses (IP 90 dias) e histórico de imagens 90 dias.',
              ].map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <Check size={14} className="mt-0.5 shrink-0 text-[#34D399]" /> <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-3xl border border-white/[0.08] bg-[#0C0C0E] p-5">
            <h2 className="text-[15px] font-bold text-[#F7F5F1]">Recomendações</h2>
            <ul className="mt-3 space-y-2 text-[12px] leading-relaxed text-[#B8B3AC]">
              <li>· Revogue chaves antigas e gere uma nova a cada troca de computador.</li>
              <li>· Dê acesso de SUPORTE apenas a quem precisa ver todos os clientes.</li>
              <li>· Nunca cole a chave em chat/e-mail; use o botão de copiar do painel.</li>
              <li>· Mantenha a extensão atualizada pelo Hub (pacote do ADM).</li>
              <li>· Configure ANTHROPIC_API_KEY só no servidor/Vercel para o agente de pesquisa com IA.</li>
            </ul>
            <div className="mt-4 rounded-2xl border border-[#FF6A3D]/20 bg-[#FF6A3D]/[0.05] px-3 py-2 text-[11px] leading-relaxed text-[#FFB199]">
              Encontrou algo estranho? Revogue as chaves do workspace, troque a senha e fale com o suporte.
            </div>
          </div>
        </section>
      )}

      {invite && (
        <InviteModal
          ws={ws}
          onClose={() => setInvite(false)}
          onDone={(message) => {
            setInvite(false)
            flash(message)
            router.refresh()
          }}
        />
      )}
      {newClient && (
        <NewClientModal
          ws={ws}
          onClose={() => setNewClient(false)}
          onDone={(message) => {
            setNewClient(false)
            flash(message)
            router.refresh()
          }}
        />
      )}
      <Toast message={toast} />
    </div>
  )
}

function Info({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2">
      <dt className="font-mono text-[9px] uppercase tracking-[0.14em] text-[#85817C]">{label}</dt>
      <dd className={cn('mt-0.5 truncate text-[13px] text-[#ECE9E3]', mono && 'font-mono text-[12px]')}>{value}</dd>
    </div>
  )
}

function Summary({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2">
      <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-[#85817C]">{label}</p>
      <p className={cn('font-display text-[20px]', ok ? 'text-[#6EE7B7]' : 'text-[#F7F5F1]')}>{value}</p>
    </div>
  )
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Btn
      size="sm"
      variant="secondary"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        } catch {
          setCopied(false)
        }
      }}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copiado' : 'Copiar'}
    </Btn>
  )
}

function InviteModal({ ws, onClose, onDone }: { ws: string; onClose: () => void; onDone: (message: string) => void }) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('coordenador')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setBusy(true)
    setError(null)
    const res = await inviteMemberAction(ws, { email, role })
    setBusy(false)
    if (!res.ok) return setError(res.error)
    onDone(res.invited ? `Convite enviado para ${res.email}.` : `Acesso de ${res.email} atualizado.`)
  }

  return (
    <Modal title="Novo acesso" description="OWNER convida por e-mail e define o papel." onClose={onClose} width="max-w-lg">
      <label className="block">
        <FieldLabel>E-mail</FieldLabel>
        <TextInput value={email} onChange={setEmail} autoFocus type="email" placeholder="pessoa@empresa.com.br" />
      </label>
      <div className="mt-3">
        <FieldLabel>Papel</FieldLabel>
        <TextSelect
          value={role}
          onChange={setRole}
          ariaLabel="Papel"
          options={[
            { value: 'coordenador', label: 'SUPORTE · vê todos os clientes e extensões' },
            { value: 'editor', label: 'EDITOR · opera cardápio e conexões' },
            { value: 'visualizador', label: 'VISUALIZADOR · somente leitura' },
            { value: 'owner', label: 'OWNER · controle total' },
          ]}
        />
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-[#85817C]">
        Se a pessoa ainda não tem conta, o Supabase envia um convite. Se já tem, o papel é atualizado e ela entra com a senha atual.
      </p>
      {error && <p className="mt-3 rounded-xl border border-[#FF6A3D]/40 bg-[#FF6A3D]/10 px-3 py-2 text-[12px] text-[#FFB199]">{error}</p>}
      <div className="mt-5 flex justify-end gap-2 border-t border-[#1C1C1F] pt-4">
        <Btn variant="ghost" onClick={onClose}>
          Cancelar
        </Btn>
        <Btn variant="primary" disabled={busy || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)} onClick={submit}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />} {busy ? 'Salvando…' : 'Enviar convite'}
        </Btn>
      </div>
    </Modal>
  )
}

function NewClientModal({ ws, onClose, onDone }: { ws: string; onClose: () => void; onDone: (message: string) => void }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [instagram, setInstagram] = useState('')
  const [fee, setFee] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setBusy(true)
    setError(null)
    const parsedFee = fee.trim() ? Number.parseFloat(fee.replace(',', '.')) : ''
    const res = await createClientAction(ws, {
      name,
      email,
      phone,
      instagram,
      monthly_fee: parsedFee === '' || !Number.isFinite(parsedFee) ? '' : parsedFee,
      notes,
    })
    setBusy(false)
    if (!res.ok) return setError(res.error)
    onDone('Cliente cadastrado.')
  }

  return (
    <Modal title="Novo cliente" description="Cada cliente pode ter cardápio e extensões por canal." onClose={onClose} width="max-w-lg">
      <label className="block">
        <FieldLabel>Nome</FieldLabel>
        <TextInput value={name} onChange={setName} autoFocus placeholder="Ex.: Hamburgueria do Zé" />
      </label>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className="block">
          <FieldLabel>E-mail</FieldLabel>
          <TextInput value={email} onChange={setEmail} type="email" placeholder="contato@…" />
        </label>
        <label className="block">
          <FieldLabel>Telefone / WhatsApp</FieldLabel>
          <TextInput value={phone} onChange={setPhone} placeholder="(11) 9…" />
        </label>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className="block">
          <FieldLabel>Instagram</FieldLabel>
          <TextInput value={instagram} onChange={setInstagram} placeholder="@cliente" />
        </label>
        <label className="block">
          <FieldLabel>Honorário (R$/mês)</FieldLabel>
          <TextInput value={fee} onChange={setFee} placeholder="0,00" />
        </label>
      </div>
      <label className="mt-3 block">
        <FieldLabel>Observações</FieldLabel>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="w-full resize-y rounded-xl border border-[#2A2A2E] bg-[#0B0B0C] px-3 py-2 text-[13px] text-[#ECE9E3] outline-none placeholder:text-[#85817C] focus:border-[#D7141F] focus:ring-2 focus:ring-[#D7141F]/20"
          placeholder="Segmento, cidade, canais…"
        />
      </label>
      {error && <p className="mt-3 rounded-xl border border-[#FF6A3D]/40 bg-[#FF6A3D]/10 px-3 py-2 text-[12px] text-[#FFB199]">{error}</p>}
      <div className="mt-5 flex justify-end gap-2 border-t border-[#1C1C1F] pt-4">
        <Btn variant="ghost" onClick={onClose}>
          Cancelar
        </Btn>
        <Btn variant="primary" disabled={busy || name.trim().length < 1} onClick={submit}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} {busy ? 'Salvando…' : 'Cadastrar cliente'}
        </Btn>
      </div>
    </Modal>
  )
}
