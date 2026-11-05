'use client'

import { useEffect, useMemo, useState } from 'react'
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

type Tab = 'all' | 'watched' | 'unwatched'

const STATUS_STYLE: Record<MockAdAccount['status'], string> = {
  Ativa: 'border-[#2A3549] bg-[#161C26] text-[#34D399]',
  Pausada: 'border-[#FBBF24]/45 bg-[#FBBF24]/10 text-[#FBBF24]',
  Desativada: 'border-[#2A3549] bg-[#161C26] text-[#B4BFD0]',
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
}: {
  initialAccounts: MockAdAccount[]
  workspaceName: string
}) {
  const [accounts, setAccounts] = useState(initialAccounts)
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

  const toggleWatched = (id: string) => {
    setAccounts((current) => current.map((account) => (account.id === id ? { ...account, watched: !account.watched } : account)))
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
          disabled
          title="Integração com a Meta disponível na próxima fase"
          className="flex h-[46px] cursor-not-allowed items-center gap-2 rounded-lg bg-[#3D8EFF] px-5 text-[14px] font-bold text-[#06101F] opacity-60"
        >
          <RefreshCw size={16} strokeWidth={2.2} />
          Buscar contas da BM
        </button>
      </div>

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
            className="mb-0 h-[42px] w-full rounded-lg border border-[#26314A] bg-[#080D18] pl-9 pr-3 text-[13px] text-[#E8EDF7] outline-none placeholder:text-[#5F6B80] focus:border-[#3D8EFF] focus:ring-2 focus:ring-[#3D8EFF]/20"
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
                {['Conta / ID', 'Status', 'Tipo', 'Saldo', 'Gasto total', 'Última sinc.', 'Acompanhar', 'Cliente', 'Ações'].map((label) => (
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
                    Nenhuma conta encontrada.
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
                        className="text-[#5F6B80] transition-colors hover:text-[#C9D3E3]"
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
                    <p className="mt-1 text-[10px] text-[#5F6B80]">{account.timezone}</p>
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
                      <span title={`Saldo sincronizado ${syncLabel(account.lastSync)}`} className="text-[#5F6B80]">
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
                          className="text-[#5F6B80] hover:text-[#C9D3E3]"
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
                            setAccounts((current) => current.map((item) => (item.id === account.id ? { ...item, clientId: null, clientName: null } : item)))
                            setMenuFor(null)
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

      <p className="mt-3 px-1 text-[11px] text-[#5F6B80]">
        {filtered.length} de {accounts.length} contas · dados fictícios de demonstração
      </p>

      {linkFor && (
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
        <Modal title={detailFor.name ?? detailFor.externalId} description="Detalhes fictícios da conta" onClose={() => setDetailFor(null)}>
          <div className="space-y-2 text-[12px]">
            {[
              ['ID externo', detailFor.externalId],
              ['Status', detailFor.status],
              ['Tipo', detailFor.type],
              ['Saldo', formatBRL(detailFor.balance)],
              ['Gasto total', formatBRL(detailFor.spendTotal)],
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
