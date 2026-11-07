'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, Copy, KeyRound, Plug, Plus, ShieldCheck } from 'lucide-react'
import { cn, FieldLabel, Modal, TextInput, TextSelect, Toast } from '@/components/hub/ui'
import { Btn, Empty } from '@/components/hub/menu/shared'
import { createApiKeyAction, pairIfoodExtensionAction, revokeApiKeyAction } from '@/app/a/[ws]/extensoes/actions'

type Extension = { id: string; slug: string; name: string; description: string | null }
type ApiKey = {
  id: string
  name: string
  key_prefix: string
  scopes: string[]
  extension_id: string | null
  last_used_at: string | null
  expires_at: string | null
  revoked_at: string | null
  created_at: string
}
type Install = { extension_id: string; version: string | null; status: string; last_seen_at: string | null; api_keys?: { name: string } | { name: string }[] | null }

function installKeyName(i: Install): string | null {
  const k = Array.isArray(i.api_keys) ? i.api_keys[0] : i.api_keys
  return k?.name ?? null
}

const SCOPE_INFO: { value: string; label: string; hint: string }[] = [
  { value: 'clientes:ler', label: 'Clientes · ler', hint: 'listar clientes para escolher o destino' },
  { value: 'catalogo:ler', label: 'Cardápio · ler', hint: 'ler cardápio e pendências' },
  { value: 'catalogo:escrever', label: 'Cardápio · escrever', hint: 'importar do iFood, confirmar aplicação, criar combo' },
  { value: 'clientes:escrever', label: 'Clientes · escrever', hint: 'não necessário para a extensão iFood' },
  { value: 'extensoes:ler', label: 'Extensões · ler', hint: 'diagnóstico' },
]
const DEFAULT_SCOPES = ['clientes:ler', 'catalogo:ler', 'catalogo:escrever']

function when(iso: string | null) {
  if (!iso) return '—'
  // fuso fixo: servidor (UTC) e navegador precisam renderizar o mesmo texto (hidratação)
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
}

export function ExtensionsScreen({
  ws,
  workspaceName,
  canManage,
  hubUrl,
  extensions,
  keys,
  installs,
  highlightPair = false,
}: {
  highlightPair?: boolean
  ws: string
  workspaceName: string
  canManage: boolean
  hubUrl: string
  extensions: Extension[]
  keys: ApiKey[]
  installs: Install[]
}) {
  const router = useRouter()
  const refresh = useCallback(() => router.refresh(), [router])
  const [creating, setCreating] = useState(false)
  const [revoking, setRevoking] = useState<ApiKey | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const extName = useMemo(() => new Map(extensions.map((e) => [e.id, e.name])), [extensions])
  const installBy = useMemo(() => new Map(installs.map((i) => [i.extension_id, i])), [installs])
  const [origin, setOrigin] = useState(hubUrl)
  useEffect(() => {
    if (!hubUrl) setOrigin(window.location.origin)
  }, [hubUrl])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 pb-10 pt-5 sm:px-6 md:px-[30px] md:pt-[26px]">
      <h1 className="text-[26px] font-extrabold leading-tight tracking-[-0.03em] text-[#F1F5FC] md:text-[28px]">Extensões</h1>
      <p className="mt-1 text-[13px] text-[#8A97AC]">
        Conecte as extensões do Chrome ao Orvia com chaves de acesso por escopo · <span className="text-[#C9D3E3]">{workspaceName}</span>
      </p>

      {/* Catálogo */}
      <div className="mt-6 grid gap-3 md:grid-cols-2">
        {extensions.map((e) => {
          const inst = installBy.get(e.id)
          const online = inst?.last_seen_at && Date.now() - new Date(inst.last_seen_at).getTime() < 10 * 60_000
          return (
            <article key={e.id} className="rounded-xl border border-[#1E2738] bg-[#0D1320] p-4">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#3D8EFF]/35 bg-[#3D8EFF]/10 text-[#3D8EFF]">
                  <Plug size={18} />
                </span>
                <div className="min-w-0">
                  <h2 className="text-[15px] font-bold text-[#F1F5FC]">{e.name}</h2>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-[#8A97AC]">{e.description}</p>
                  <p className="mt-2 text-[12px] text-[#B4BFD0]">
                    <span className={cn('mr-1.5 inline-block h-2 w-2 rounded-full', online ? 'bg-[#34D399]' : inst ? 'bg-[#FBBF24]' : 'bg-[#4B5870]')} />
                    {inst ? `${online ? 'Conectada agora' : 'Instalada (sem contato recente)'} · v${inst.version ?? '?'} · último contato ${when(inst.last_seen_at)}` : 'Ainda não conectada'}
                  </p>
                  {inst && installKeyName(inst) && <p className="mt-0.5 text-[11px] text-[#7C8AA1]">Acesso: {installKeyName(inst)}</p>}
                </div>
              </div>
            </article>
          )
        })}
      </div>

      {canManage && <PairCard ws={ws} highlight={highlightPair} onDone={refresh} />}

      {/* Passo a passo */}
      <section className="mt-6 rounded-xl border border-[#1E2738] bg-[#0D1320] p-4 text-[13px] leading-relaxed text-[#B4BFD0]">
        <h2 className="flex items-center gap-2 text-[14px] font-bold text-[#F1F5FC]">
          <ShieldCheck size={16} className="text-[#34D399]" /> Conexão manual (outro navegador ou sem a ponte)
        </h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>Gere uma chave abaixo (escopos padrão já são os mínimos).</li>
          <li>
            No Chrome: <span className="font-mono text-[12px]">chrome://extensions</span> → Modo do desenvolvedor → Carregar sem compactação → pasta{' '}
            <span className="font-mono text-[12px]">apps/extensions/orvia-ifood</span>.
          </li>
          <li>
            Abra as opções da extensão, cole o endereço do Orvia (<span className="font-mono text-[12px]">{origin || 'https://orvia-gestao.vercel.app'}</span>) e a chave → “Testar conexão”.
          </li>
        </ol>
      </section>

      {/* Chaves */}
      <section className="mt-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-[16px] font-bold text-[#F1F5FC]">
            <KeyRound size={16} className="text-[#6EA8FF]" /> Chaves de API
          </h2>
          {canManage && (
            <Btn variant="primary" onClick={() => setCreating(true)}>
              <Plus size={14} /> Gerar chave
            </Btn>
          )}
        </div>
        {!canManage ? (
          <div className="mt-3">
            <Empty title="Somente dono ou coordenador gerenciam chaves">Peça a um responsável do workspace para gerar a chave da extensão.</Empty>
          </div>
        ) : keys.length === 0 ? (
          <div className="mt-3">
            <Empty title="Nenhuma chave criada">Gere a primeira chave para conectar a extensão Orvia · iFood.</Empty>
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-xl border border-[#1E2738]">
            <table className="w-full min-w-[820px] border-collapse text-left">
              <thead>
                <tr className="border-b border-[#1A2231] bg-[#0B111D] text-[10px] font-bold uppercase tracking-[0.1em] text-[#8A97AC]">
                  <th className="px-3 py-2.5">Nome</th>
                  <th className="px-3 py-2.5">Prefixo</th>
                  <th className="px-3 py-2.5">Extensão</th>
                  <th className="px-3 py-2.5">Escopos</th>
                  <th className="px-3 py-2.5">Último uso</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => {
                  const expired = k.expires_at && new Date(k.expires_at).getTime() < Date.now()
                  return (
                    <tr key={k.id} className="border-b border-[#141B28] bg-[#0D1320] text-[12px] last:border-b-0">
                      <td className="px-3 py-2.5 font-semibold text-[#E8EDF7]">{k.name}</td>
                      <td className="px-3 py-2.5 font-mono text-[#B4BFD0]">{k.key_prefix}…</td>
                      <td className="px-3 py-2.5 text-[#B4BFD0]">{k.extension_id ? extName.get(k.extension_id) ?? '—' : '—'}</td>
                      <td className="px-3 py-2.5">
                        <span className="flex flex-wrap gap-1">
                          {k.scopes.map((s) => (
                            <span key={s} className="rounded border border-[#26314A] bg-[#080D18] px-1.5 py-px font-mono text-[10px] text-[#B4BFD0]">
                              {s}
                            </span>
                          ))}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-[#8A97AC]">{when(k.last_used_at)}</td>
                      <td className="px-3 py-2.5">
                        {k.revoked_at ? (
                          <span className="text-[#F87171]">Revogada</span>
                        ) : expired ? (
                          <span className="text-[#FBBF24]">Expirada</span>
                        ) : (
                          <span className="text-[#34D399]">Ativa{k.expires_at ? ` até ${when(k.expires_at)}` : ''}</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {!k.revoked_at && (
                          <Btn size="sm" variant="danger" onClick={() => setRevoking(k)}>
                            Revogar
                          </Btn>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {creating && (
        <CreateKeyModal
          ws={ws}
          extensions={extensions}
          onClose={() => {
            setCreating(false)
            router.refresh()
          }}
        />
      )}
      {revoking && (
        <Modal title="Revogar chave" onClose={() => setRevoking(null)}>
          <p className="text-[13px] text-[#C9D3E3]">
            Revogar <b>{revoking.name}</b> ({revoking.key_prefix}…)? A extensão que usa essa chave para de funcionar imediatamente.
          </p>
          <div className="mt-5 flex justify-end gap-2 border-t border-[#1A2231] pt-4">
            <Btn variant="ghost" onClick={() => setRevoking(null)}>
              Cancelar
            </Btn>
            <Btn
              variant="danger"
              onClick={async () => {
                const res = await revokeApiKeyAction(ws, revoking.id)
                setRevoking(null)
                setToast(res.ok ? 'Chave revogada.' : res.error)
                router.refresh()
              }}
            >
              Revogar
            </Btn>
          </div>
        </Modal>
      )}
      <Toast message={toast} />
    </div>
  )
}

function CreateKeyModal({ ws, extensions, onClose }: { ws: string; extensions: Extension[]; onClose: () => void }) {
  const ifood = extensions.find((e) => e.slug === 'orvia-ifood')
  const [name, setName] = useState('')
  const [extensionId, setExtensionId] = useState(ifood?.id ?? '')
  const [scopes, setScopes] = useState<string[]>(DEFAULT_SCOPES)
  const [expires, setExpires] = useState('180')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  if (created) {
    return (
      <Modal title="Chave criada" description="Copie agora — ela não será exibida de novo." onClose={onClose} width="max-w-lg">
        <div className="flex items-center gap-2 rounded-lg border border-[#3D8EFF]/50 bg-[#0C1A31] p-3">
          <code className="min-w-0 flex-1 break-all font-mono text-[12px] text-white">{created}</code>
          <Btn
            size="sm"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(created)
                setCopied(true)
              } catch {
                setCopied(false)
              }
            }}
          >
            {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copiada' : 'Copiar'}
          </Btn>
        </div>
        <p className="mt-3 text-[12px] leading-relaxed text-[#8A97AC]">
          Cole nas opções da extensão (campo de senha). Não envie por chat/e-mail. Se perder, revogue e gere outra.
        </p>
        <div className="mt-5 flex justify-end border-t border-[#1A2231] pt-4">
          <Btn variant="primary" onClick={onClose}>
            Concluir
          </Btn>
        </div>
      </Modal>
    )
  }

  const submit = async () => {
    setBusy(true)
    setError(null)
    const res = await createApiKeyAction(ws, {
      name,
      extension_id: extensionId || null,
      scopes,
      expires_in_days: Number.parseInt(expires, 10) || 0,
    })
    setBusy(false)
    if (res.ok) setCreated(res.key)
    else setError(res.error)
  }

  return (
    <Modal title="Gerar chave de API" onClose={onClose} width="max-w-lg">
      <label className="block">
        <FieldLabel>Nome da chave</FieldLabel>
        <TextInput value={name} onChange={setName} autoFocus placeholder="Ex.: Chrome do escritório" />
      </label>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className="block">
          <FieldLabel>Extensão</FieldLabel>
          <TextSelect
            value={extensionId}
            onChange={setExtensionId}
            ariaLabel="Extensão"
            options={[...extensions.map((e) => ({ value: e.id, label: e.name })), { value: '', label: 'Nenhuma (uso geral)' }]}
          />
        </label>
        <label className="block">
          <FieldLabel>Validade</FieldLabel>
          <TextSelect
            value={expires}
            onChange={setExpires}
            ariaLabel="Validade"
            options={[
              { value: '30', label: '30 dias' },
              { value: '90', label: '90 dias' },
              { value: '180', label: '180 dias' },
              { value: '365', label: '1 ano' },
              { value: '0', label: 'Sem expiração' },
            ]}
          />
        </label>
      </div>
      <div className="mt-3">
        <FieldLabel>Escopos</FieldLabel>
        <div className="space-y-1.5">
          {SCOPE_INFO.map((s) => {
            const on = scopes.includes(s.value)
            return (
              <label key={s.value} className="flex cursor-pointer items-start gap-2 rounded-lg border border-[#1E2738] bg-[#080D18] px-3 py-2">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => setScopes((cur) => (on ? cur.filter((x) => x !== s.value) : [...cur, s.value]))}
                  className="mt-0.5 accent-[#3D8EFF]"
                />
                <span>
                  <span className="block text-[12px] font-semibold text-[#E8EDF7]">{s.label}</span>
                  <span className="block text-[11px] text-[#7C8AA1]">{s.hint}</span>
                </span>
              </label>
            )
          })}
        </div>
      </div>
      {error && <p className="mt-3 rounded-lg border border-[#F87171]/40 bg-[#F87171]/10 px-3 py-2 text-[12px] text-[#FCA5A5]">{error}</p>}
      <div className="mt-5 flex justify-end gap-2 border-t border-[#1A2231] pt-4">
        <Btn variant="ghost" onClick={onClose}>
          Cancelar
        </Btn>
        <Btn variant="primary" disabled={busy} onClick={submit}>
          {busy ? 'Gerando…' : 'Gerar chave'}
        </Btn>
      </div>
    </Modal>
  )
}

type PairState = { kind: 'idle' | 'busy' | 'ok' | 'err'; text?: string }

/**
 * "Conectar com um clique": a extensão instalada injeta uma ponte nesta página
 * (marca data-orvia-ifood no <html> e responde por window.postMessage, mesma origem).
 * O painel gera a chave no servidor e a entrega direto à extensão — ninguém vê/cola a chave.
 */
function PairCard({ ws, highlight, onDone }: { ws: string; highlight: boolean; onDone: () => void }) {
  const [version, setVersion] = useState<string | null>(null)
  const [state, setState] = useState<PairState>({ kind: 'idle' })

  useEffect(() => {
    const read = () => setVersion(document.documentElement.dataset.orviaIfood ?? null)
    read()
    const timer = setTimeout(read, 1000)
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return
      const data = event.data as { source?: string; type?: string; version?: string; ok?: boolean; error?: string; workspace?: string } | null
      if (!data || data.source !== 'orvia-ext') return
      if (data.type === 'hello' && data.version) setVersion(data.version)
      if (data.type === 'paired') {
        if (data.ok) {
          setState({ kind: 'ok', text: `Extensão conectada${data.workspace ? ` ao workspace “${data.workspace}”` : ''}. Pode abrir o portal do iFood.` })
          onDone()
        } else setState({ kind: 'err', text: data.error ?? 'A extensão recusou a conexão.' })
      }
    }
    window.addEventListener('message', onMessage)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('message', onMessage)
    }
  }, [onDone])

  const connect = async () => {
    setState({ kind: 'busy', text: 'Gerando acesso e entregando à extensão…' })
    const res = await pairIfoodExtensionAction(ws)
    if (!res.ok) return setState({ kind: 'err', text: res.error })
    window.postMessage({ source: 'orvia-hub', type: 'pair', key: res.key, hubUrl: window.location.origin }, window.location.origin)
    setTimeout(() => setState((cur) => (cur.kind === 'busy' ? { kind: 'err', text: 'A extensão não respondeu. Recarregue esta página (F5) e tente de novo.' } : cur)), 15000)
  }

  return (
    <section
      className={cn(
        'mt-6 rounded-xl border bg-[#0D1320] p-4',
        highlight ? 'border-[#3D8EFF] shadow-[0_0_0_3px_rgba(61,142,255,0.18)]' : 'border-[#1E2738]',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-[15px] font-bold text-[#F1F5FC]">
            <Plug size={16} className="text-[#6EA8FF]" /> Conectar a extensão iFood neste navegador
          </h2>
          <p className="mt-1 text-[12px] text-[#8A97AC]">
            {version
              ? `Extensão detectada (v${version}). Um clique e ela fica conectada — sem copiar chave.`
              : 'Extensão não detectada neste navegador. Instale/ative a extensão e recarregue esta página (F5).'}
          </p>
        </div>
        <Btn variant="primary" disabled={!version || state.kind === 'busy'} onClick={connect}>
          {state.kind === 'busy' ? 'Conectando…' : state.kind === 'ok' ? 'Conectar de novo' : 'Conectar extensão'}
        </Btn>
      </div>
      {state.text && (
        <p
          role="status"
          className={cn(
            'mt-3 rounded-lg px-3 py-2 text-[12px]',
            state.kind === 'ok' && 'bg-[#34D399]/10 text-[#6EE7B7]',
            state.kind === 'err' && 'bg-[#F87171]/10 text-[#FCA5A5]',
            state.kind === 'busy' && 'bg-[#3D8EFF]/10 text-[#CFE0FF]',
          )}
        >
          {state.text}
        </p>
      )}
    </section>
  )
}
