'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Layers,
  Pencil,
  Plug,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  UtensilsCrossed,
} from 'lucide-react'
import { formatBRL } from '@/lib/format'
import { comboTotals, STATUS_LABEL, type MenuAddonGroup, type MenuCatalog, type MenuCategory, type MenuClient, type MenuItem, type MenuStatus } from '@/lib/menu/model'
import { cn, TextSelect, Toast } from '@/components/hub/ui'
import * as actions from '@/app/a/[ws]/cardapio/actions'
import { Btn, Empty, InlinePrice, StatusBadge, SyncBadge, useMenuAction, type ActionResult } from './shared'
import { CategoryModal, ClientModal, ComboModal, ConfirmModal, GroupModal, ItemModal } from './MenuModals'
import { AiModal } from './AiModal'

export type ExtensionStatus = { status: string; version: string | null; last_seen_at: string | null } | null

type Tab = 'produtos' | 'combos' | 'complementos' | 'ifood'

type Dialog =
  | { kind: 'client' }
  | { kind: 'ai' }
  | { kind: 'category'; category: MenuCategory | null }
  | { kind: 'item'; item: MenuItem | null }
  | { kind: 'combo'; combo: MenuItem | null }
  | { kind: 'group'; group: MenuAddonGroup | null }
  | { kind: 'confirm'; title: string; message: string; confirmLabel: string; onConfirm: () => Promise<ActionResult> }
  | null

const STATUS_OPTIONS = (Object.keys(STATUS_LABEL) as MenuStatus[]).map((value) => ({ value, label: STATUS_LABEL[value] }))

function useNow(): number | null {
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])
  return now
}

function ago(iso: string | null, now: number | null): string {
  if (now === null) return '…'
  if (!iso) return 'nunca'
  const min = Math.floor((now - new Date(iso).getTime()) / 60_000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `há ${h} h`
  return `há ${Math.floor(h / 24)} dias`
}

export function MenuScreen({
  ws,
  workspaceName,
  canEdit,
  canManageKeys,
  clients,
  catalog,
  extension,
}: {
  ws: string
  workspaceName: string
  canEdit: boolean
  canManageKeys: boolean
  clients: MenuClient[]
  catalog: MenuCatalog | null
  extension: ExtensionStatus
}) {
  const router = useRouter()
  const { run, pending, toast, setToast } = useMenuAction()
  const [tab, setTab] = useState<Tab>('produtos')
  const [dialog, setDialog] = useState<Dialog>(null)
  const close = () => setDialog(null)

  const pendingCount = catalog?.items.filter((i) => i.pending).length ?? 0
  const comboCount = catalog?.items.filter((i) => i.kind === 'combo').length ?? 0
  const productCount = catalog ? catalog.items.length - comboCount : 0

  const TABS: { key: Tab; label: string; count?: number }[] = [
    { key: 'produtos', label: 'Produtos', count: productCount },
    { key: 'combos', label: 'Combos', count: comboCount },
    { key: 'complementos', label: 'Complementos', count: catalog?.groups.length ?? 0 },
    { key: 'ifood', label: 'Sincronização iFood', count: pendingCount },
  ]

  return (
    <div className="mx-auto w-full max-w-[1720px] px-4 pb-10 pt-5 sm:px-6 md:px-[30px] md:pt-[26px]">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-extrabold leading-tight tracking-[-0.03em] text-[#F1F5FC] md:text-[28px]">Cardápio</h1>
          <p className="mt-1 text-[13px] text-[#8A97AC]">
            Produtos, combos e complementos — fonte única que a extensão aplica no iFood · <span className="text-[#C9D3E3]">{workspaceName}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {clients.length > 0 && (
            <div className="w-[240px] max-w-full">
              <TextSelect
                ariaLabel="Cliente"
                className="h-[38px]"
                value={catalog?.client.id ?? ''}
                onChange={(id) => router.push(`/a/${ws}/cardapio?cliente=${id}`)}
                options={clients.map((c) => ({ value: c.id, label: c.name }))}
              />
            </div>
          )}
          {canEdit && catalog && catalog.items.length > 0 && (
            <Btn variant="primary" onClick={() => setDialog({ kind: 'ai' })}>
              <Sparkles size={14} /> Otimizar com IA
            </Btn>
          )}
          {canEdit && (
            <Btn onClick={() => setDialog({ kind: 'client' })}>
              <Plus size={14} /> Cliente
            </Btn>
          )}
          <Btn variant="ghost" onClick={() => router.refresh()} aria-label="Atualizar" title="Atualizar">
            <RefreshCw size={14} className={cn(pending && 'animate-spin')} />
          </Btn>
        </div>
      </div>

      {!catalog ? (
        <div className="mt-6">
          <Empty title="Nenhum cliente com cardápio ainda">
            Crie o primeiro cliente (o restaurante) para começar. Depois, importe o cardápio do iFood pela extensão ou cadastre categorias e produtos aqui.
            {canEdit && (
              <div className="mt-4">
                <Btn variant="primary" onClick={() => setDialog({ kind: 'client' })}>
                  <Plus size={14} /> Criar cliente
                </Btn>
              </div>
            )}
          </Empty>
        </div>
      ) : (
        <>
          {/* Abas */}
          <div className="mt-5 flex gap-1 overflow-x-auto border-b border-[#1A2231]" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={cn(
                  '-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3.5 py-2.5 text-[13px] font-semibold transition-colors',
                  tab === t.key ? 'border-[#3D8EFF] text-white' : 'border-transparent text-[#8A97AC] hover:text-[#D5DDEA]',
                )}
              >
                {t.label}
                <span
                  className={cn(
                    'rounded-full px-1.5 py-px text-[10px] font-bold',
                    t.key === 'ifood' && (t.count ?? 0) > 0 ? 'bg-[#FBBF24]/15 text-[#FBBF24]' : 'bg-[#1A2333] text-[#8A97AC]',
                  )}
                >
                  {t.count}
                </span>
              </button>
            ))}
          </div>

          <div className="mt-5">
            {tab === 'produtos' && <ProductsTab ws={ws} catalog={catalog} canEdit={canEdit} run={run} setDialog={setDialog} />}
            {tab === 'combos' && <CombosTab ws={ws} catalog={catalog} canEdit={canEdit} run={run} setDialog={setDialog} />}
            {tab === 'complementos' && <GroupsTab ws={ws} catalog={catalog} canEdit={canEdit} run={run} setDialog={setDialog} />}
            {tab === 'ifood' && (
              <SyncTab ws={ws} catalog={catalog} canEdit={canEdit} canManageKeys={canManageKeys} extension={extension} run={run} />
            )}
          </div>
        </>
      )}

      {/* Diálogos */}
      {dialog?.kind === 'client' && (
        <ClientModal
          onClose={close}
          onSave={async (input) => {
            const res = await run(() => actions.createClientAction(ws, input), 'Cliente criado.')
            if (res.ok && res.id) router.push(`/a/${ws}/cardapio?cliente=${res.id}`)
            return res
          }}
        />
      )}
      {dialog?.kind === 'category' && catalog && (
        <CategoryModal
          category={dialog.category}
          onClose={close}
          onSave={(input) => run(() => actions.saveCategoryAction(ws, { ...input, client_id: catalog.client.id }), 'Categoria salva.')}
        />
      )}
      {dialog?.kind === 'item' && catalog && (
        <ItemModal
          item={dialog.item}
          catalog={catalog}
          defaultCategoryId={null}
          onClose={close}
          onSave={(input) => run(() => actions.saveItemAction(ws, input), dialog.item ? 'Produto atualizado.' : 'Produto criado.')}
        />
      )}
      {dialog?.kind === 'combo' && catalog && (
        <ComboModal
          combo={dialog.combo}
          catalog={catalog}
          onClose={close}
          onSave={(input) => run(() => actions.saveComboAction(ws, input), dialog.combo ? 'Combo atualizado.' : 'Combo criado (pendente para o iFood).')}
        />
      )}
      {dialog?.kind === 'group' && catalog && (
        <GroupModal
          group={dialog.group}
          clientId={catalog.client.id}
          onClose={close}
          onSave={(input) => run(() => actions.saveGroupAction(ws, input), 'Grupo salvo.')}
        />
      )}
      {dialog?.kind === 'ai' && catalog && (
        <AiModal
          ws={ws}
          clientId={catalog.client.id}
          clientName={catalog.client.name}
          onClose={close}
          onApplied={(msg) => {
            setToast(msg)
            router.refresh()
          }}
        />
      )}
      {dialog?.kind === 'confirm' && (
        <ConfirmModal title={dialog.title} message={dialog.message} confirmLabel={dialog.confirmLabel} onClose={close} onConfirm={dialog.onConfirm} />
      )}
      <Toast message={toast} />
    </div>
  )
}

type TabProps = {
  ws: string
  catalog: MenuCatalog
  canEdit: boolean
  run: ReturnType<typeof useMenuAction>['run']
  setDialog: (d: Dialog) => void
}

// ---------------------------------------------------------------------------
// Produtos
// ---------------------------------------------------------------------------
function ProductsTab({ ws, catalog, canEdit, run, setDialog }: TabProps) {
  const [categoryId, setCategoryId] = useState<string>('all')
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | MenuStatus | 'pending'>('all')

  const catName = useMemo(() => new Map(catalog.categories.map((c) => [c.id, c.name])), [catalog.categories])
  const products = catalog.items.filter((i) => i.kind === 'item')
  const countByCat = useMemo(() => {
    const m = new Map<string, number>()
    for (const i of catalog.items) m.set(i.category_id, (m.get(i.category_id) ?? 0) + 1)
    return m
  }, [catalog.items])

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase()
    return products.filter((i) => {
      if (categoryId !== 'all' && i.category_id !== categoryId) return false
      if (statusFilter === 'pending' && !i.pending) return false
      if (statusFilter !== 'all' && statusFilter !== 'pending' && i.status !== statusFilter) return false
      if (term && !`${i.name} ${i.description ?? ''} ${i.sku ?? ''}`.toLowerCase().includes(term)) return false
      return true
    })
  }, [products, categoryId, query, statusFilter])

  const patch = (item: MenuItem, body: Record<string, unknown>, msg: string) =>
    run(() => actions.patchItemAction(ws, item.id, item.updated_at, body), msg)

  return (
    <div className="grid gap-5 lg:grid-cols-[250px_1fr]">
      {/* Categorias */}
      <aside className="rounded-xl border border-[#1E2738] bg-[#0D1320] p-2 lg:self-start">
        <div className="flex items-center justify-between px-2 pb-2 pt-1">
          <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#8A97AC]">Categorias</span>
          {canEdit && (
            <button
              type="button"
              onClick={() => setDialog({ kind: 'category', category: null })}
              className="rounded-md p-1 text-[#6EA8FF] hover:bg-[#3D8EFF]/10"
              aria-label="Nova categoria"
              title="Nova categoria"
            >
              <Plus size={15} />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => setCategoryId('all')}
          className={cn(
            'flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-[13px]',
            categoryId === 'all' ? 'bg-[#3D8EFF]/12 text-white' : 'text-[#B4BFD0] hover:bg-white/[0.03]',
          )}
        >
          Todas <span className="text-[11px] text-[#7C8AA1]">{products.length}</span>
        </button>
        {catalog.categories.map((c, index) => (
          <div
            key={c.id}
            className={cn(
              'group flex items-center gap-1 rounded-lg pr-1',
              categoryId === c.id ? 'bg-[#3D8EFF]/12' : 'hover:bg-white/[0.03]',
            )}
          >
            <button
              type="button"
              onClick={() => setCategoryId(c.id)}
              className={cn('flex min-w-0 flex-1 items-center justify-between gap-2 px-2.5 py-2 text-left text-[13px]', categoryId === c.id ? 'text-white' : 'text-[#B4BFD0]')}
            >
              <span className={cn('truncate', c.status !== 'active' && 'text-[#7C8AA1] line-through decoration-[#7C8AA1]/40')}>{c.name}</span>
              <span className="text-[11px] text-[#7C8AA1]">{countByCat.get(c.id) ?? 0}</span>
            </button>
            {canEdit && (
              <span className="hidden shrink-0 items-center group-focus-within:flex group-hover:flex">
                <IconBtn label="Subir" disabled={index === 0} onClick={() => run(() => actions.moveCategoryAction(ws, catalog.client.id, c.id, 'up'), 'Ordem atualizada.')}>
                  <ArrowUp size={12} />
                </IconBtn>
                <IconBtn
                  label="Descer"
                  disabled={index === catalog.categories.length - 1}
                  onClick={() => run(() => actions.moveCategoryAction(ws, catalog.client.id, c.id, 'down'), 'Ordem atualizada.')}
                >
                  <ArrowDown size={12} />
                </IconBtn>
                <IconBtn label="Editar" onClick={() => setDialog({ kind: 'category', category: c })}>
                  <Pencil size={12} />
                </IconBtn>
                <IconBtn
                  label="Excluir"
                  onClick={() =>
                    setDialog({
                      kind: 'confirm',
                      title: 'Excluir categoria',
                      message: `Excluir “${c.name}”? Só é possível se ela estiver vazia.`,
                      confirmLabel: 'Excluir',
                      onConfirm: () => run(() => actions.deleteCategoryAction(ws, c.id, c.updated_at), 'Categoria excluída.'),
                    })
                  }
                >
                  <Trash2 size={12} />
                </IconBtn>
              </span>
            )}
          </div>
        ))}
        {catalog.categories.length === 0 && <p className="px-2.5 py-2 text-[12px] text-[#7C8AA1]">Nenhuma categoria. Crie uma ou importe do iFood.</p>}
      </aside>

      {/* Tabela */}
      <section className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#7C8AA1]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por nome, descrição ou código…"
              aria-label="Buscar produtos"
              className="mb-0 h-[38px] w-full rounded-lg border border-[#26314A] bg-[#080D18] pl-9 pr-3 text-[13px] text-[#E8EDF7] outline-none placeholder:text-[#7C8AA1] focus:border-[#3D8EFF]"
            />
          </div>
          <div className="w-[180px]">
            <TextSelect
              ariaLabel="Filtrar status"
              className="h-[38px]"
              value={statusFilter}
              onChange={(v) => setStatusFilter(v as typeof statusFilter)}
              options={[{ value: 'all', label: 'Todos os status' }, ...STATUS_OPTIONS, { value: 'pending', label: 'Pendentes iFood' }]}
            />
          </div>
          {canEdit && (
            <Btn variant="primary" onClick={() => setDialog({ kind: 'item', item: null })} disabled={catalog.categories.length === 0}>
              <Plus size={14} /> Produto
            </Btn>
          )}
        </div>

        <div className="mt-3 overflow-x-auto rounded-xl border border-[#1E2738]">
          <table className="w-full min-w-[760px] border-collapse text-left">
            <thead>
              <tr className="border-b border-[#1A2231] bg-[#0B111D] text-[10px] font-bold uppercase tracking-[0.1em] text-[#8A97AC]">
                <th className="px-3 py-2.5">Produto</th>
                <th className="px-3 py-2.5">Categoria</th>
                <th className="px-3 py-2.5 text-right">Preço</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5">iFood</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => (
                <tr key={item.id} className="border-b border-[#141B28] bg-[#0D1320] last:border-b-0 hover:bg-[#101827]">
                  <td className="max-w-[380px] px-3 py-2.5">
                    <button type="button" onClick={() => canEdit && setDialog({ kind: 'item', item })} className="block max-w-full text-left">
                      <span className="block truncate text-[13px] font-semibold text-[#E8EDF7]">{item.name}</span>
                      <span className="block truncate text-[11px] text-[#7C8AA1]">
                        {item.sku && <span className="mr-1.5 whitespace-nowrap font-mono">{item.sku}</span>}
                        {item.description || <em className="not-italic text-[#FBBF24]/80">sem descrição</em>}
                      </span>
                    </button>
                  </td>
                  <td className="px-3 py-2.5 text-[12px] text-[#B4BFD0]">{catName.get(item.category_id)}</td>
                  <td className="px-3 py-2.5 text-right">
                    <InlinePrice value={item.price} disabled={!canEdit} onSave={(price) => patch(item, { price }, 'Preço atualizado.')} />
                  </td>
                  <td className="px-3 py-2.5">
                    {canEdit ? (
                      <select
                        aria-label={`Status de ${item.name}`}
                        value={item.status}
                        onChange={(e) => patch(item, { status: e.target.value }, 'Status atualizado.')}
                        className="mb-0 h-8 cursor-pointer rounded-md border border-[#26314A] bg-[#080D18] px-2 text-[12px] text-[#E8EDF7] outline-none focus:border-[#3D8EFF]"
                      >
                        {STATUS_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <StatusBadge status={item.status} />
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <SyncBadge item={item} />
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {canEdit && (
                      <span className="inline-flex">
                        <IconBtn label="Editar" onClick={() => setDialog({ kind: 'item', item })}>
                          <Pencil size={14} />
                        </IconBtn>
                        <IconBtn
                          label="Excluir"
                          onClick={() =>
                            setDialog({
                              kind: 'confirm',
                              title: 'Excluir produto',
                              message: `Excluir “${item.name}” do Orvia? Isso NÃO remove do iFood — pause por lá se precisar.`,
                              confirmLabel: 'Excluir',
                              onConfirm: () => run(() => actions.deleteItemAction(ws, item.id, item.updated_at), 'Produto excluído.'),
                            })
                          }
                        >
                          <Trash2 size={14} />
                        </IconBtn>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={6} className="bg-[#0D1320] px-3 py-10 text-center text-[13px] text-[#7C8AA1]">
                    {products.length === 0 ? 'Nenhum produto ainda — importe do iFood pela extensão ou clique em “Produto”.' : 'Nenhum produto com esses filtros.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-[#7C8AA1]">Dica: clique no preço para editar direto na tabela. Toda alteração entra na fila “Sincronização iFood”.</p>
      </section>
    </div>
  )
}

function IconBtn({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="rounded-md p-1.5 text-[#7F8CA3] hover:bg-white/[0.06] hover:text-white disabled:opacity-30"
    >
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Combos
// ---------------------------------------------------------------------------
function CombosTab({ ws, catalog, canEdit, run, setDialog }: TabProps) {
  const byId = useMemo(() => new Map(catalog.items.map((i) => [i.id, i])), [catalog.items])
  const combos = catalog.items.filter((i) => i.kind === 'combo')
  const productCount = catalog.items.length - combos.length

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-[13px] text-[#8A97AC]">
          Monte combos com produtos do cardápio, veja a economia para o cliente e deixe pausado até revisar. A extensão mostra o passo a passo para criar no iFood.
        </p>
        {canEdit && (
          <Btn variant="primary" onClick={() => setDialog({ kind: 'combo', combo: null })} disabled={productCount < 2}>
            <Plus size={14} /> Novo combo
          </Btn>
        )}
      </div>

      {combos.length === 0 ? (
        <div className="mt-4">
          <Empty title="Nenhum combo ainda">
            {productCount < 2 ? 'Cadastre ou importe pelo menos 2 produtos para montar um combo.' : 'Crie o primeiro: escolha os itens, defina o desconto e o Orvia sugere o preço.'}
          </Empty>
        </div>
      ) : (
        <div className="mt-4 grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {combos.map((combo) => {
            const t = comboTotals(combo, byId)
            return (
              <article key={combo.id} className="flex flex-col rounded-xl border border-[#1E2738] bg-[#0D1320] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-[15px] font-bold text-[#F1F5FC]">{combo.name}</h3>
                    {combo.description && <p className="mt-0.5 line-clamp-2 text-[12px] text-[#8A97AC]">{combo.description}</p>}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <StatusBadge status={combo.status} />
                    <SyncBadge item={combo} />
                  </div>
                </div>
                <ul className="mt-3 space-y-1">
                  {combo.components.map((c) => {
                    const p = byId.get(c.component_id)
                    return (
                      <li key={c.component_id} className="flex justify-between gap-3 text-[12px]">
                        <span className="truncate text-[#C9D3E3]">
                          <span className="font-mono text-[#6EA8FF]">{c.quantity}×</span> {p?.name ?? 'Produto removido'}
                        </span>
                        <span className="font-mono text-[#7C8AA1]">{formatBRL((p?.price ?? 0) * c.quantity)}</span>
                      </li>
                    )
                  })}
                </ul>
                <div className="mt-auto pt-3">
                  <div className="flex items-end justify-between border-t border-[#1A2231] pt-3">
                    <div>
                      <span className="block text-[11px] text-[#7C8AA1] line-through">{formatBRL(t.full)}</span>
                      <span className="font-mono text-[18px] font-bold text-white">{formatBRL(combo.price)}</span>
                    </div>
                    <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-bold', t.savings > 0 ? 'bg-[#34D399]/10 text-[#34D399]' : 'bg-[#FBBF24]/10 text-[#FBBF24]')}>
                      {t.savings > 0 ? `−${t.discountPercent.toLocaleString('pt-BR')}%` : 'sem desconto'}
                    </span>
                  </div>
                  {canEdit && (
                    <div className="mt-3 flex gap-2">
                      <Btn size="sm" onClick={() => setDialog({ kind: 'combo', combo })} className="flex-1">
                        <Pencil size={13} /> Editar
                      </Btn>
                      {combo.status !== 'active' ? (
                        <Btn size="sm" onClick={() => run(() => actions.patchItemAction(ws, combo.id, combo.updated_at, { status: 'active' }), 'Combo ativado.')} className="flex-1">
                          Ativar
                        </Btn>
                      ) : (
                        <Btn size="sm" onClick={() => run(() => actions.patchItemAction(ws, combo.id, combo.updated_at, { status: 'inactive' }), 'Combo pausado.')} className="flex-1">
                          Pausar
                        </Btn>
                      )}
                      <Btn
                        size="sm"
                        variant="ghost"
                        aria-label="Excluir combo"
                        onClick={() =>
                          setDialog({
                            kind: 'confirm',
                            title: 'Excluir combo',
                            message: `Excluir “${combo.name}” do Orvia? Se já existir no iFood, pause por lá.`,
                            confirmLabel: 'Excluir',
                            onConfirm: () => run(() => actions.deleteItemAction(ws, combo.id, combo.updated_at), 'Combo excluído.'),
                          })
                        }
                      >
                        <Trash2 size={13} />
                      </Btn>
                    </div>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Complementos
// ---------------------------------------------------------------------------
function GroupsTab({ ws, catalog, canEdit, run, setDialog }: TabProps) {
  const linked = useMemo(() => {
    const m = new Map<string, number>()
    for (const i of catalog.items) for (const g of i.group_ids) m.set(g, (m.get(g) ?? 0) + 1)
    return m
  }, [catalog.items])

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-[13px] text-[#8A97AC]">Grupos de opções (ponto da carne, adicionais, escolha da bebida). Vincule aos produtos no cadastro de cada produto.</p>
        {canEdit && (
          <Btn variant="primary" onClick={() => setDialog({ kind: 'group', group: null })}>
            <Plus size={14} /> Grupo
          </Btn>
        )}
      </div>
      {catalog.groups.length === 0 ? (
        <div className="mt-4">
          <Empty title="Nenhum grupo de complementos" />
        </div>
      ) : (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {catalog.groups.map((g) => (
            <GroupCard key={g.id} ws={ws} group={g} linked={linked.get(g.id) ?? 0} canEdit={canEdit} run={run} setDialog={setDialog} />
          ))}
        </div>
      )}
    </div>
  )
}

function GroupCard({
  ws,
  group,
  linked,
  canEdit,
  run,
  setDialog,
}: {
  ws: string
  group: MenuAddonGroup
  linked: number
  canEdit: boolean
  run: TabProps['run']
  setDialog: TabProps['setDialog']
}) {
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')

  const add = async () => {
    const delta = Number((price || '0').replace(/\./g, '').replace(',', '.'))
    if (!name.trim() || !Number.isFinite(delta)) return
    const res = await run(() => actions.saveSubitemAction(ws, { group_id: group.id, name, price_delta: delta, status: 'active' }), 'Opção adicionada.')
    if (res.ok) {
      setName('')
      setPrice('')
    }
  }

  return (
    <article className="rounded-xl border border-[#1E2738] bg-[#0D1320]">
      <header className="flex items-start justify-between gap-3 border-b border-[#1A2231] px-4 py-3">
        <div>
          <h3 className="flex items-center gap-2 text-[14px] font-bold text-[#F1F5FC]">
            <Layers size={14} className="text-[#6EA8FF]" /> {group.name}
          </h3>
          <p className="mt-0.5 text-[11px] text-[#7C8AA1]">
            {group.min_qty > 0 ? 'Obrigatório' : 'Opcional'} · escolhe de {group.min_qty} a {group.max_qty} · em {linked} produto(s)
          </p>
        </div>
        <div className="flex items-center gap-1">
          <StatusBadge status={group.status} />
          {canEdit && (
            <>
              <IconBtn label="Editar grupo" onClick={() => setDialog({ kind: 'group', group })}>
                <Pencil size={13} />
              </IconBtn>
              <IconBtn
                label="Excluir grupo"
                onClick={() =>
                  setDialog({
                    kind: 'confirm',
                    title: 'Excluir grupo',
                    message: `Excluir “${group.name}” e suas ${group.subitems.length} opções? Os produtos perdem o vínculo.`,
                    confirmLabel: 'Excluir',
                    onConfirm: () => run(() => actions.deleteGroupAction(ws, group.id, group.updated_at), 'Grupo excluído.'),
                  })
                }
              >
                <Trash2 size={13} />
              </IconBtn>
            </>
          )}
        </div>
      </header>
      <ul>
        {group.subitems.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-3 border-b border-[#141B28] px-4 py-2 text-[13px] last:border-b-0">
            <span className={cn('truncate', s.status === 'active' ? 'text-[#E8EDF7]' : 'text-[#7C8AA1] line-through')}>{s.name}</span>
            <span className="flex items-center gap-2">
              <span className="font-mono text-[12px] text-[#B4BFD0]">{s.price_delta > 0 ? `+ ${formatBRL(s.price_delta)}` : 'grátis'}</span>
              {canEdit && (
                <>
                  <IconBtn
                    label={s.status === 'active' ? 'Pausar opção' : 'Ativar opção'}
                    onClick={() =>
                      run(
                        () =>
                          actions.saveSubitemAction(ws, {
                            id: s.id,
                            expected: s.updated_at,
                            group_id: group.id,
                            name: s.name,
                            price_delta: s.price_delta,
                            status: s.status === 'active' ? 'inactive' : 'active',
                          }),
                        'Opção atualizada.',
                      )
                    }
                  >
                    <CheckCircle2 size={13} className={s.status === 'active' ? 'text-[#34D399]' : ''} />
                  </IconBtn>
                  <IconBtn label="Excluir opção" onClick={() => run(() => actions.deleteSubitemAction(ws, s.id, s.updated_at), 'Opção removida.')}>
                    <Trash2 size={13} />
                  </IconBtn>
                </>
              )}
            </span>
          </li>
        ))}
        {group.subitems.length === 0 && <li className="px-4 py-3 text-[12px] text-[#7C8AA1]">Sem opções ainda.</li>}
      </ul>
      {canEdit && (
        <div className="flex gap-2 border-t border-[#1A2231] px-3 py-2.5">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            placeholder="Nova opção (ex.: Bacon extra)"
            aria-label="Nome da nova opção"
            className="mb-0 h-8 min-w-0 flex-1 rounded-md border border-[#26314A] bg-[#080D18] px-2.5 text-[12px] text-[#E8EDF7] outline-none placeholder:text-[#7C8AA1] focus:border-[#3D8EFF]"
          />
          <input
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            placeholder="+ R$ 0,00"
            aria-label="Preço adicional"
            inputMode="decimal"
            className="mb-0 h-8 w-24 rounded-md border border-[#26314A] bg-[#080D18] px-2.5 text-right font-mono text-[12px] text-[#E8EDF7] outline-none placeholder:text-[#7C8AA1] focus:border-[#3D8EFF]"
          />
          <Btn size="sm" onClick={add} disabled={!name.trim()}>
            <Plus size={13} />
          </Btn>
        </div>
      )}
    </article>
  )
}

// ---------------------------------------------------------------------------
// Sincronização iFood
// ---------------------------------------------------------------------------
function SyncTab({
  ws,
  catalog,
  canEdit,
  canManageKeys,
  extension,
  run,
}: {
  ws: string
  catalog: MenuCatalog
  canEdit: boolean
  canManageKeys: boolean
  extension: ExtensionStatus
  run: TabProps['run']
}) {
  const pending = catalog.items.filter((i) => i.pending)
  const created = pending.filter((i) => !i.ifood_id)
  const changed = pending.filter((i) => i.ifood_id)
  const catName = new Map(catalog.categories.map((c) => [c.id, c.name]))
  const now = useNow()
  const online = Boolean(now && extension?.last_seen_at && now - new Date(extension.last_seen_at).getTime() < 10 * 60_000)

  return (
    <div className="grid gap-5 xl:grid-cols-[360px_1fr]">
      <aside className="space-y-3 xl:self-start">
        <div className="rounded-xl border border-[#1E2738] bg-[#0D1320] p-4">
          <div className="flex items-center gap-2">
            <Plug size={16} className="text-[#6EA8FF]" />
            <h3 className="text-[14px] font-bold text-[#F1F5FC]">Extensão Orvia · iFood</h3>
          </div>
          {extension ? (
            <p className="mt-2 text-[12px] text-[#B4BFD0]">
              <span className={cn('mr-1.5 inline-block h-2 w-2 rounded-full', online ? 'bg-[#34D399]' : 'bg-[#7C8AA1]')} />
              {online ? 'Conectada' : 'Instalada'} · versão {extension.version ?? '—'} · visto {ago(extension.last_seen_at, now)}
            </p>
          ) : (
            <p className="mt-2 text-[12px] text-[#8A97AC]">{canManageKeys ? 'Ainda não conectada a este workspace.' : 'Status visível para dono/coordenador.'}</p>
          )}
          {canManageKeys && (
            <Link href={`/a/${ws}/extensoes`} className="mt-3 inline-flex text-[12px] font-semibold text-[#6EA8FF] hover:text-white">
              Gerenciar chave da extensão →
            </Link>
          )}
        </div>

        <div className="rounded-xl border border-[#1E2738] bg-[#0D1320] p-4 text-[12px] leading-relaxed text-[#B4BFD0]">
          <h3 className="text-[13px] font-bold text-[#F1F5FC]">Como funciona</h3>
          <ol className="mt-2 list-decimal space-y-1.5 pl-4">
            <li>No Portal do Parceiro iFood, abra o cardápio da loja e clique no botão azul da Orvia.</li>
            <li>
              <b className="text-white">Enviar para o Orvia</b>: a extensão importa categorias, produtos e complementos para <b className="text-white">{catalog.client.name}</b>.
            </li>
            <li>Edite aqui (preços, descrições, combos). Cada mudança entra nesta fila.</li>
            <li>Na extensão, aba <b className="text-white">Pendências</b>: ela mostra antes → depois e você aplica no iFood. Ao confirmar, sai da fila.</li>
          </ol>
          <p className="mt-3 text-[11px] text-[#7C8AA1]">
            Loja iFood vinculada: <span className="font-mono text-[#C9D3E3]">{catalog.client.ifood_merchant_id ?? 'definida na 1ª importação'}</span>
          </p>
        </div>
      </aside>

      <section className="min-w-0">
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Pendentes" value={pending.length} tone={pending.length ? 'warn' : 'ok'} />
          <Stat label="Criar no iFood" value={created.length} />
          <Stat label="Alterar no iFood" value={changed.length} />
        </div>

        <div className="mt-4 overflow-x-auto rounded-xl border border-[#1E2738]">
          <table className="w-full min-w-[640px] border-collapse text-left">
            <thead>
              <tr className="border-b border-[#1A2231] bg-[#0B111D] text-[10px] font-bold uppercase tracking-[0.1em] text-[#8A97AC]">
                <th className="px-3 py-2.5">Produto</th>
                <th className="px-3 py-2.5">O que fazer</th>
                <th className="px-3 py-2.5 text-right">Preço</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5">Alterado</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {pending.map((item) => (
                <tr key={item.id} className="border-b border-[#141B28] bg-[#0D1320] last:border-b-0">
                  <td className="px-3 py-2.5">
                    <span className="flex items-center gap-1.5 text-[13px] font-semibold text-[#E8EDF7]">
                      {item.kind === 'combo' && <UtensilsCrossed size={12} className="text-[#C4B5FD]" />}
                      {item.name}
                    </span>
                    <span className="text-[11px] text-[#7C8AA1]">{catName.get(item.category_id)}</span>
                  </td>
                  <td className="px-3 py-2.5 text-[12px] text-[#C9D3E3]">{item.ifood_id ? 'Atualizar no iFood' : item.kind === 'combo' ? 'Criar combo no iFood' : 'Criar produto no iFood'}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-[13px] text-[#E8EDF7]">{formatBRL(item.price)}</td>
                  <td className="px-3 py-2.5">
                    <StatusBadge status={item.status} />
                  </td>
                  <td className="px-3 py-2.5 text-[12px] text-[#8A97AC]">{ago(item.updated_at, now)}</td>
                  <td className="px-3 py-2.5 text-right">
                    {canEdit && (
                      <Btn
                        size="sm"
                        title="Use quando você já aplicou manualmente no iFood"
                        onClick={() => run(() => actions.markSyncedAction(ws, item.id, item.updated_at), 'Marcado como aplicado no iFood.')}
                      >
                        <CheckCircle2 size={13} /> Já apliquei
                      </Btn>
                    )}
                  </td>
                </tr>
              ))}
              {pending.length === 0 && (
                <tr>
                  <td colSpan={6} className="bg-[#0D1320] px-3 py-10 text-center text-[13px] text-[#34D399]">
                    Tudo em dia: o Orvia e o iFood estão iguais para este cliente.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'warn' | 'ok' }) {
  return (
    <div className="rounded-xl border border-[#1E2738] bg-[#0D1320] px-4 py-3">
      <span className="block text-[10px] font-bold uppercase tracking-[0.12em] text-[#8A97AC]">{label}</span>
      <span className={cn('mt-1 block font-mono text-[22px] font-bold', tone === 'warn' ? 'text-[#FBBF24]' : tone === 'ok' ? 'text-[#34D399]' : 'text-white')}>{value}</span>
    </div>
  )
}
