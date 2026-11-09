'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Building2,
  Check,
  ChevronDown,
  Clock,
  Copy,
  ExternalLink,
  Info,
  MoreVertical,
  RefreshCw,
  Search,
  Star,
  UserPlus,
} from 'lucide-react'
import { formatBRL } from '@/lib/format'
import type { MockAdAccount } from '@/lib/mock'
import { cn, Modal, Toast, Toggle } from '@/components/hub/ui'
import { SYNC_EVENT } from '@/components/hub/Header'
import { createClientAndLinkAction, linkAccountAction, setWatchedAction, syncMetaAccountsAction } from '@/app/a/[ws]/contas/actions'

/** Modo real (painel): dados do banco + ações no servidor. Sem `live` = demonstração. */
export type AccountsLive = {
  ws: string
  canManage: boolean
  /** META_ACCESS_TOKEN + META_BUSINESS_ID presentes no servidor */
  configured: boolean
  /** migration 0007 aplicada (a leitura das contas funcionou) */
  schemaReady: boolean
  clients: { id: string; name: string }[]
}

type Tab = 'all' | 'watched' | 'unwatched'

const STATUS_STYLE: Record<MockAdAccount['status'], string> = {
  Ativa: 'border-[#2A3549] bg-[#161C26] text-[#34D399]',
  Pausada: 'border-[#FBBF24]/45 bg-[#FBBF24]/10 text-[#FBBF24]',
  Desativada: 'border-[#2A3549] bg-[#161C26] text-[#B4BFD0]',
  Pendente: 'border-[#F87171]/45 bg-[#F87171]/10 text-[#FCA5A5]',
}

function syncLabel(iso: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000))
  if (minutes < 1) return 'agora'
  if (minutes < 60) return `há ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `há ${hours} h`
  return `há ${Math.floor(hours / 24)} dias`
}

export function AccountsScreen({
  initialAccounts,
  workspaceName,
  live,
}: {
  initialAccounts: MockAdAccount[]
  workspaceName: string
  live?: AccountsLive
}) {
  const router = useRouter()
  const [accounts, setAccounts] = useState(initialAccounts)
  useEffect(() => setAccounts(initialAccounts), [initialAccounts])
  const [syncing, setSyncing] = useState(false)
  const [banner, setBanner] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [tab, setTab] = useState<Tab>('all')
  const [query, setQuery] = useState('')
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [linkFor, setLinkFor] = useState<MockAdAccount | null>(null)
  const [detailFor, setDetailFor] = useState<MockAdAccount | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(timer)
  }, [toast])

  const counts = useMemo(
    () => ({
      all: accounts.length,
      watched: accounts.filter((account) => account.watched).length,
      unwatched: accounts.filter((account) => !account.watched).length,
    }),
    [accounts],
  )

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    return accounts.filter((account) => {
      if (tab === 'watched' && !account.watched) return false
      if (tab === 'unwatched' && account.watched) return false
      if (term && !account.externalId.toLowerCase().includes(term) && !(account.name ?? '').toLowerCase().includes(term)) return false
      return true
    })
  }, [accounts, query, tab])

  const sync = useCallback(async () => {
    if (!live) return
    if (!live.canManage) return setBanner({ kind: 'err', text: 'Somente dono ou coordenador sincronizam as contas da Meta.' })
    setSyncing(true)
    setBanner(null)
    const res = await syncMetaAccountsAction(live.ws)
    setSyncing(false)
    if (!res.ok) return setBanner({ kind: 'err', text: res.error })
    setBanner({
      kind: 'ok',
      text: `${res.total} conta${res.total === 1 ? '' : 's'} sincronizada${res.total === 1 ? '' : 's'} da Meta · ${res.created} nova${res.created === 1 ? '' : 's'}${res.linked ? ` · ${res.linked} vinculada${res.linked === 1 ? '' : 's'} automaticamente pelo nome` : ''}.`,
    })
    router.refresh()
  }, [live, router])

  // Botão "Sincronizar" do cabeçalho: nesta tela, busca na Meta
  useEffect(() => {
    if (!live) return
    const onSync = (event: Event) => {
      event.preventDefault()
      void sync()
    }
    window.addEventListener(SYNC_EVENT, onSync)
    return () => window.removeEventListener(SYNC_EVENT, onSync)
  }, [live, sync])

  const toggleWatched = async (id: string) => {
    const next = !accounts.find((a) => a.id === id)?.watched
    setAccounts((current) => current.map((account) => (account.id === id ? { ...account, watched: next } : account)))
    if (!live) return
    const res = await setWatchedAction(live.ws, id, next)
    if (!res.ok) {
      setAccounts((current) => current.map((account) => (account.id === id ? { ...account, watched: !next } : account)))
      setToast(res.error)
    }
  }

  const setLink = async (accountId: string, client: { id: string; name: string } | null) => {
    if (!live) return
    const res = await linkAccountAction(live.ws, accountId, client?.id ?? null)
    if (!res.ok) return setToast(res.error)
    setAccounts((current) => current.map((a) => (a.id === accountId ? { ...a, clientId: client?.id ?? null, clientName: client?.name ?? null } : a)))
    setToast(client ? `Conta vinculada a ${client.name}.` : 'Vínculo removido.')
  }

  const copy = async (value: string, message: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setToast(message)
    } catch {
      setToast('Não foi possível copiar neste navegador.')
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1720px] px-4 pb-10 pt-5 sm:px-6 md:px-[30px] md:pt-[26px]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[26px] font-extrabold leading-tight tracking-[-0.03em] text-[#F1F5FC] md:text-[28px]">Contas de Anúncio</h1>
            <span className="rounded-full border border-[#3D8EFF]/45 bg-[#3D8EFF]/10 px-3 py-1 text-[11px] font-semibold text-[#6EA8FF]">
              {workspaceName}
            </span>
          </div>
          <p className="mt-1.5 text-[13px] text-[#8A97AC]">
            Mapeie contas da Business Manager da Meta e controle o acompanhamento da assessoria.
          </p>
        </div>
        <button
          type="button"
          disabled={!live || !live.canManage || syncing}
          onClick={() => void sync()}
          title={!live ? 'Demonstração' : !live.canManage ? 'Somente dono ou coordenador' : 'Buscar as contas do portfólio empresarial na Meta'}
          className="flex h-[46px] items-center gap-2 rounded-lg bg-[#3D8EFF] px-5 text-[14px] font-bold text-[#06101F] transition-colors hover:bg-[#6EA8FF] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw size={16} strokeWidth={2.2} className={cn(syncing && 'animate-spin')} />
          {syncing ? 'Buscando na Meta…' : 'Buscar contas da BM'}
        </button>
      </div>

      {live && (!live.configured || !live.schemaReady || banner) && (
        <div
          role="status"
          className={cn(
            'mt-4 rounded-xl border px-4 py-3 text-[12px] leading-relaxed',
            banner?.kind === 'ok' ? 'border-[#34D399]/40 bg-[#34D399]/10 text-[#A7F3D0]' : 'border-[#FBBF24]/40 bg-[#FBBF24]/10 text-[#FDE68A]',
          )}
        >
          {banner?.text ??
            (!live.schemaReady
              ? 'O banco ainda não tem os campos da sincronização com a Meta (migration 0007). Aplique a migration e recarregue.'
              : 'Integração com a Meta não configurada no servidor: cadastre META_ACCESS_TOKEN (token de Usuário do Sistema) e META_BUSINESS_ID na Vercel e refaça o deploy.')}
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 md:mt-6">
        <div className="flex flex-wrap items-center gap-1 rounded-xl border border-[#1A2231] bg-[#0D1320] p-1.5" role="tablist" aria-label="Filtro de contas">
          {(
            [
              { key: 'all', label: 'Todas' },
              { key: 'watched', label: 'Acompanhadas' },
              { key: 'unwatched', label: 'Não acompanhadas' },
            ] as const
          ).map((item) => (
            <button
              key={item.key}
              role="tab"
              aria-selected={tab === item.key}
              onClick={() => setTab(item.key)}
              className={cn(
                'flex h-[42px] items-center gap-2 rounded-lg px-4 text-[13px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3D8EFF]',
                tab === item.key ? 'bg-[#3D8EFF] font-bold text-[#06101F]' : 'text-[#A9B4C7] hover:bg-white/[0.04] hover:text-white',
              )}
            >
              {item.label}
              <span className={cn('text-[11px] font-bold', tab === item.key ? 'text-[#06101F]/70' : 'text-[#7F8CA3]')}>{counts[item.key]}</span>
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-[360px]">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#7F8CA3]" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar por nome ou act_id…"
            aria-label="Buscar conta por nome ou act_id"
            className="mb-0 h-[42px] w-full rounded-lg border border-[#26314A] bg-[#080D18] pl-9 pr-3 text-[13px] text-[#E8EDF7] outline-none placeholder:text-[#7C8AA1] focus:border-[#3D8EFF] focus:ring-2 focus:ring-[#3D8EFF]/20"
          />
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-[#1A2231] bg-[#0D1320]">
        <div className="hub-scrollbar max-h-[calc(100dvh-330px)] min-h-[380px] overflow-auto">
          <table className="w-full min-w-[1280px] table-fixed border-0 bg-transparent">
            <colgroup>
              <col style={{ width: 370 }} />
              <col style={{ width: 100 }} />
              <col style={{ width: 100 }} />
              <col style={{ width: 190 }} />
              <col style={{ width: 150 }} />
              <col style={{ width: 140 }} />
              <col style={{ width: 125 }} />
              <col style={{ width: 250 }} />
              <col style={{ width: 70 }} />
            </colgroup>
            <thead className="sticky top-0 z-20 bg-[#0D1320]">
              <tr>
                {['Conta / ID', 'Status', 'Tipo', 'Saldo', live ? 'Gasto no mês' : 'Gasto total', 'Última sinc.', 'Acompanhar', 'Cliente', 'Ações'].map((label) => (
                  <th
                    key={label}
                    scope="col"
                    className={cn(
                      'h-[52px] border-b border-[#1A2231] bg-[#0D1320] px-4 py-0 text-left text-[10px] font-bold uppercase tracking-[0.08em] text-[#8A97AC]',
                      label === 'Ações' && 'text-center',
                    )}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="h-[140px] text-center text-[13px] text-[#8A97AC]">
                    {live && accounts.length === 0 ? 'Nenhuma conta ainda — use “Buscar contas da BM” para trazer as contas do portfólio da Meta.' : 'Nenhuma conta encontrada.'}
                  </td>
                </tr>
              )}
              {filtered.map((account) => (
                <tr key={account.id} className="border-b border-[#1A2231] last:border-b-0 hover:bg-[#111A2B]">
                  <td className="h-[84px] px-4 py-0 align-middle">
                    <p className="truncate text-[14px] font-bold text-[#F1F5FC]">{account.name ?? account.externalId.replace('act_', '')}</p>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="truncate text-[10px] text-[#8A97AC]">{account.externalId}</span>
                      <button
                        type="button"
                        onClick={() => copy(account.externalId, 'ID da conta copiado.')}
                        aria-label="Copiar ID da conta"
                        className="text-[#7C8AA1] transition-colors hover:text-[#C9D3E3]"
                      >
                        <Copy size={11} />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setAccounts((current) => current.map((item) => (item.id === account.id ? { ...item, starred: !item.starred } : item)))
                          setToast(account.starred ? 'Conta removida dos destaques.' : 'Conta marcada como destaque.')
                        }}
                        aria-label={account.starred ? 'Remover destaque' : 'Marcar destaque'}
                        className={account.starred ? 'text-[#D4AF37]' : 'text-[#3B4659] hover:text-[#8A97AC]'}
                      >
                        <Star size={11} fill={account.starred ? 'currentColor' : 'none'} />
                      </button>
                    </div>
                    <p className="mt-1 truncate text-[10px] text-[#7C8AA1]">
                      {account.timezone}
                      {account.ownerBusinessName && ` · BM: ${account.ownerBusinessName}`}
                    </p>
                  </td>
                  <td className="h-[84px] px-4 py-0 align-middle">
                    <span className={cn('inline-flex rounded-full border px-3 py-1 text-[10px] font-bold', STATUS_STYLE[account.status])}>
                      {account.status}
                    </span>
                  </td>
                  <td className="h-[84px] px-4 py-0 align-middle">
                    <span
                      className={cn(
                        'inline-flex rounded-md border px-2 py-1 text-[10px] font-semibold',
                        account.type === 'Pré-paga'
                          ? 'border-[#3D8EFF]/45 bg-[#3D8EFF]/10 text-[#6EA8FF]'
                          : 'border-[#26314A] bg-[#0A0F1A] text-[#A9B4C7]',
                      )}
                    >
                      {account.type}
                    </span>
                  </td>
                  <td className="h-[84px] px-4 py-0 align-middle">
                    <div className="flex items-center gap-1.5">
                      {account.balance < 0 ? (
                        <span className="text-[13px] font-bold tabular-nums text-[#F87171]">Devedor {formatBRL(-account.balance)}</span>
                      ) : (
                        <span className="text-[13px] font-bold tabular-nums text-[#34D399]">{formatBRL(account.balance)}</span>
                      )}
                      <span title={`Saldo sincronizado ${syncLabel(account.lastSync)}`} className="text-[#7C8AA1]">
                        <Info size={12} />
                      </span>
                    </div>
                  </td>
                  <td className="h-[84px] px-4 py-0 align-middle text-[13px] font-bold tabular-nums text-[#F1F5FC]">
                    {formatBRL(account.spendTotal)}
                  </td>
                  <td className="h-[84px] px-4 py-0 align-middle">
                    <span className="flex items-center gap-1.5 text-[11px] text-[#8A97AC]">
                      <Clock size={12} />
                      {syncLabel(account.lastSync)}
                    </span>
                  </td>
                  <td className="h-[84px] px-4 py-0 align-middle">
                    <Toggle checked={account.watched} onChange={() => toggleWatched(account.id)} label={`Acompanhar ${account.name ?? account.externalId}`} />
                  </td>
                  <td className="h-[84px] px-4 py-0 align-middle">
                    {account.clientName ? (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setDetailFor(account)}
                          className="max-w-[160px] truncate text-left text-[12px] font-semibold text-[#6EA8FF] underline underline-offset-2 hover:text-[#9CC4FF]"
                        >
                          {account.clientName}
                        </button>
                        <ExternalLink size={12} className="shrink-0 text-[#6EA8FF]" />
                        <button
                          type="button"
                          aria-label="Ações do cliente"
                          onClick={() => setMenuFor(menuFor === account.id ? null : account.id)}
                          className="text-[#7C8AA1] hover:text-[#C9D3E3]"
                        >
                          <MoreVertical size={13} />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setLinkFor(account)}
                        className="flex items-center gap-1.5 text-[11px] text-[#8A97AC] transition-colors hover:text-[#E8EDF7]"
                      >
                        <UserPlus size={12} />
                        + Vincular cliente
                      </button>
                    )}
                  </td>
                  <td className="relative h-[84px] px-4 py-0 align-middle text-center">
                    <button
                      type="button"
                      aria-label="Mais ações"
                      onClick={() => setMenuFor(menuFor === account.id ? null : account.id)}
                      className="rounded-md p-1.5 text-[#7F8CA3] transition-colors hover:bg-white/[0.05] hover:text-white"
                    >
                      <MoreVertical size={16} />
                    </button>
                    {menuFor === account.id && (
                      <div className="absolute right-3 top-[62px] z-30 w-[190px] rounded-xl border border-[#26314A] bg-[#0B1120] p-1.5 text-left shadow-2xl">
                        <button
                          type="button"
                          onClick={() => {
                            setDetailFor(account)
                            setMenuFor(null)
                          }}
                          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[12px] text-[#C9D3E3] hover:bg-white/[0.05]"
                        >
                          <Info size={13} /> Ver detalhes
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            copy(account.externalId, 'ID da conta copiado.')
                            setMenuFor(null)
                          }}
                          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[12px] text-[#C9D3E3] hover:bg-white/[0.05]"
                        >
                          <Copy size={13} /> Copiar ID
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setMenuFor(null)
                            if (live) return void setLink(account.id, null)
                            setAccounts((current) => current.map((item) => (item.id === account.id ? { ...item, clientId: null, clientName: null } : item)))
                            setToast('Vínculo removido nesta demonstração.')
                          }}
                          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[12px] text-[#FCA5A5] hover:bg-[#F87171]/10"
                        >
                          <UserPlus size={13} /> Desvincular
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-3 px-1 text-[11px] text-[#7C8AA1]">
        {filtered.length} de {accounts.length} contas · {live ? 'dados da Meta (portfólio empresarial)' : 'dados fictícios de demonstração'}
      </p>

      {linkFor && live && (
        <LiveLinkModal
          account={linkFor}
          clients={live.clients}
          onClose={() => setLinkFor(null)}
          onLink={async (client) => {
            setLinkFor(null)
            await setLink(linkFor.id, client)
          }}
          onCreate={async (name) => {
            const res = await createClientAndLinkAction(live.ws, linkFor.id, name)
            if (!res.ok) return setToast(res.error)
            setLinkFor(null)
            setAccounts((current) => current.map((a) => (a.id === linkFor.id ? { ...a, clientId: res.client.id, clientName: res.client.name } : a)))
            setToast(`Cliente ${res.client.name} criado e vinculado.`)
            router.refresh()
          }}
        />
      )}

      {linkFor && !live && (
        <LinkAccountModal
          account={linkFor}
          onClose={() => setLinkFor(null)}
          onLink={(clientName) => {
            setAccounts((current) =>
              current.map((item) => (item.id === linkFor.id ? { ...item, clientId: clientName.toLowerCase(), clientName } : item)),
            )
            setLinkFor(null)
            setToast(`Conta vinculada a ${clientName} nesta demonstração.`)
          }}
        />
      )}

      {detailFor && (
        <Modal title={detailFor.name ?? detailFor.externalId} description={live ? 'Dados da última sincronização com a Meta' : 'Detalhes fictícios da conta'} onClose={() => setDetailFor(null)}>
          <div className="space-y-2 text-[12px]">
            {[
              ['ID externo', detailFor.externalId],
              ['Status', detailFor.status],
              ['Tipo', detailFor.type],
              ['Saldo', formatBRL(detailFor.balance)],
              [live ? 'Gasto no mês' : 'Gasto total', formatBRL(detailFor.spendTotal)],
              ...(detailFor.ownerBusinessName ? [['BM dona', detailFor.ownerBusinessName]] : []),
              ['Fuso', detailFor.timezone],
              ['Cliente', detailFor.clientName ?? 'Sem vínculo'],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between gap-4 rounded-lg border border-[#1E2738] bg-[#080D18] px-3 py-2">
                <span className="text-[#8A97AC]">{label}</span>
                <span className="font-semibold text-[#E8EDF7]">{value}</span>
              </div>
            ))}
          </div>
        </Modal>
      )}

      <Toast message={toast} />
    </div>
  )
}

function LinkAccountModal({
  account,
  onClose,
  onLink,
}: {
  account: MockAdAccount
  onClose: () => void
  onLink: (clientName: string) => void
}) {
  const options = ['Vila Grelha', 'Studio Aurora', 'Padaria Modelo', 'Empório Central', 'Cliente Alfa', 'Bella Massa']
  const [selected, setSelected] = useState(options[0])
  return (
    <Modal title="Vincular cliente" description={`${account.externalId} · demonstração`} onClose={onClose} width="max-w-sm">
      <div className="space-y-1">
        {options.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => setSelected(name)}
            className={cn(
              'flex w-full items-center justify-between rounded-lg px-3 py-2 text-[13px]',
              selected === name ? 'bg-[#3D8EFF]/15 text-[#E8EDF7]' : 'text-[#C9D3E3] hover:bg-white/[0.04]',
            )}
          >
            {name}
            {selected === name && <Check size={14} className="text-[#3D8EFF]" />}
          </button>
        ))}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-lg border border-[#26314A] px-4 py-2 text-[12px] font-semibold text-[#C9D3E3] hover:text-white">
          Cancelar
        </button>
        <button
          type="button"
          onClick={() => onLink(selected)}
          className="rounded-lg bg-[#3D8EFF] px-4 py-2 text-[12px] font-bold text-[#06101F] hover:bg-[#6EA8FF]"
        >
          Vincular
        </button>
      </div>
    </Modal>
  )
}

/** Vincular conta real: escolhe um cliente do workspace ou cria um com o nome da BM/conta. */
function LiveLinkModal({
  account,
  clients,
  onClose,
  onLink,
  onCreate,
}: {
  account: MockAdAccount
  clients: { id: string; name: string }[]
  onClose: () => void
  onLink: (client: { id: string; name: string }) => Promise<void>
  onCreate: (name: string) => Promise<void>
}) {
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [newName, setNewName] = useState(account.ownerBusinessName ?? account.name ?? '')
  const [busy, setBusy] = useState(false)
  const list = clients.filter((c) => c.name.toLowerCase().includes(filter.trim().toLowerCase())).slice(0, 50)
  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    await fn()
    setBusy(false)
  }
  const input = 'mb-0 h-[38px] w-full rounded-lg border border-[#26314A] bg-[#080D18] px-3 text-[13px] text-[#E8EDF7] outline-none placeholder:text-[#7C8AA1] focus:border-[#3D8EFF]'
  return (
    <Modal title="Vincular cliente" description={account.externalId} onClose={onClose} width="max-w-md">
      <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Buscar cliente…" aria-label="Buscar cliente" className={input} />
      <div className="hub-scrollbar mt-2 max-h-[240px] space-y-1 overflow-auto">
        {list.length === 0 && <p className="px-1 py-2 text-[12px] text-[#7C8AA1]">Nenhum cliente encontrado.</p>}
        {list.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setSelected(c.id)}
            className={cn('flex w-full items-center justify-between rounded-lg px-3 py-2 text-[13px]', selected === c.id ? 'bg-[#3D8EFF]/15 text-[#E8EDF7]' : 'text-[#C9D3E3] hover:bg-white/[0.04]')}
          >
            {c.name}
            {selected === c.id && <Check size={14} className="text-[#3D8EFF]" />}
          </button>
        ))}
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-lg border border-[#26314A] px-4 py-2 text-[12px] font-semibold text-[#C9D3E3] hover:text-white">
          Cancelar
        </button>
        <button
          type="button"
          disabled={!selected || busy}
          onClick={() => run(() => onLink(clients.find((c) => c.id === selected)!))}
          className="rounded-lg bg-[#3D8EFF] px-4 py-2 text-[12px] font-bold text-[#06101F] hover:bg-[#6EA8FF] disabled:opacity-50"
        >
          Vincular
        </button>
      </div>
      <div className="mt-4 border-t border-[#1A2231] pt-3">
        <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#8A97AC]">Ou criar novo cliente</p>
        <div className="mt-2 flex gap-2">
          <input value={newName} onChange={(e) => setNewName(e.target.value)} aria-label="Nome do novo cliente" className={input} />
          <button
            type="button"
            disabled={!newName.trim() || busy}
            onClick={() => run(() => onCreate(newName))}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-[#3D8EFF]/50 px-3 text-[12px] font-bold text-[#6EA8FF] hover:bg-[#3D8EFF]/10 disabled:opacity-50"
          >
            <Building2 size={13} /> Criar e vincular
          </button>
        </div>
      </div>
    </Modal>
  )
}
