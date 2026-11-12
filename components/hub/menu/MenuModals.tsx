'use client'

import { Minus, Plus, Search, Sparkles, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { formatBRL } from '@/lib/format'
import {
  comboTotals,
  STATUS_LABEL,
  suggestComboPrice,
  type MenuAddonGroup,
  type MenuCatalog,
  type MenuCategory,
  type MenuItem,
  type MenuStatus,
} from '@/lib/menu/model'
import { FieldLabel, Modal, TextInput, TextSelect, cn } from '@/components/hub/ui'
import { Btn, parsePrice, Textarea, type ActionResult } from './shared'

const STATUS_OPTIONS = (Object.keys(STATUS_LABEL) as MenuStatus[]).map((value) => ({ value, label: STATUS_LABEL[value] }))

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null
  return <p className="mt-3 rounded-[5px] border border-[#FF6A3D]/40 bg-[#FF6A3D]/10 px-3 py-2 text-[12px] text-[#FFB199]">{error}</p>
}

function Footer({ busy, onClose, onSave, label = 'Salvar' }: { busy: boolean; onClose: () => void; onSave: () => void; label?: string }) {
  return (
    <div className="mt-5 flex justify-end gap-2 border-t border-[#1C1C1F] pt-4">
      <Btn variant="ghost" onClick={onClose}>
        Cancelar
      </Btn>
      <Btn variant="primary" disabled={busy} onClick={onSave}>
        {busy ? 'Salvando…' : label}
      </Btn>
    </div>
  )
}

function useSubmit(onClose: () => void) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async (call: () => Promise<ActionResult>) => {
    setBusy(true)
    setError(null)
    const res = await call()
    setBusy(false)
    if (res.ok) onClose()
    else setError(res.error)
  }
  return { busy, error, setError, submit }
}

// ---------------------------------------------------------------------------
// Cliente
// ---------------------------------------------------------------------------
export function ClientModal({ onClose, onSave }: { onClose: () => void; onSave: (input: { name: string; ifood_merchant_id: string }) => Promise<ActionResult> }) {
  const [name, setName] = useState('')
  const [merchant, setMerchant] = useState('')
  const { busy, error, submit } = useSubmit(onClose)
  return (
    <Modal title="Novo cliente" description="Restaurante cujo cardápio você vai gerenciar." onClose={onClose}>
      <label className="block">
        <FieldLabel>Nome do restaurante</FieldLabel>
        <TextInput value={name} onChange={setName} autoFocus placeholder="Ex.: Hamburgueria Astro" />
      </label>
      <label className="mt-3 block">
        <FieldLabel>ID da loja no iFood (opcional)</FieldLabel>
        <TextInput value={merchant} onChange={setMerchant} placeholder="Preenchido automaticamente na 1ª importação" />
      </label>
      <ErrorLine error={error} />
      <Footer busy={busy} onClose={onClose} onSave={() => submit(() => onSave({ name, ifood_merchant_id: merchant }))} label="Criar cliente" />
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Categoria
// ---------------------------------------------------------------------------
export function CategoryModal({
  category,
  onClose,
  onSave,
}: {
  category: MenuCategory | null
  onClose: () => void
  onSave: (input: { id?: string; expected?: string; name: string; description: string; status: MenuStatus }) => Promise<ActionResult>
}) {
  const [name, setName] = useState(category?.name ?? '')
  const [description, setDescription] = useState(category?.description ?? '')
  const [status, setStatus] = useState<MenuStatus>(category?.status ?? 'active')
  const { busy, error, submit } = useSubmit(onClose)
  return (
    <Modal title={category ? 'Editar categoria' : 'Nova categoria'} onClose={onClose}>
      <label className="block">
        <FieldLabel>Nome</FieldLabel>
        <TextInput value={name} onChange={setName} autoFocus placeholder="Ex.: Lanches" />
      </label>
      <label className="mt-3 block">
        <FieldLabel>Descrição (opcional)</FieldLabel>
        <Textarea value={description} onChange={setDescription} rows={2} />
      </label>
      <label className="mt-3 block">
        <FieldLabel>Status</FieldLabel>
        <TextSelect value={status} onChange={(v) => setStatus(v as MenuStatus)} options={STATUS_OPTIONS} ariaLabel="Status" />
      </label>
      <ErrorLine error={error} />
      <Footer
        busy={busy}
        onClose={onClose}
        onSave={() => submit(() => onSave({ id: category?.id, expected: category?.updated_at, name, description, status }))}
      />
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Produto
// ---------------------------------------------------------------------------
export function ItemModal({
  item,
  catalog,
  defaultCategoryId,
  onClose,
  onSave,
}: {
  item: MenuItem | null
  catalog: MenuCatalog
  defaultCategoryId: string | null
  onClose: () => void
  onSave: (input: Record<string, unknown>) => Promise<ActionResult>
}) {
  const categories = catalog.categories
  const [name, setName] = useState(item?.name ?? '')
  const [description, setDescription] = useState(item?.description ?? '')
  const [price, setPrice] = useState(item ? item.price.toFixed(2).replace('.', ',') : '')
  const [sku, setSku] = useState(item?.sku ?? '')
  const [categoryId, setCategoryId] = useState(item?.category_id ?? defaultCategoryId ?? categories[0]?.id ?? '')
  const [status, setStatus] = useState<MenuStatus>(item?.status ?? 'active')
  const [groupIds, setGroupIds] = useState<string[]>(item?.group_ids ?? [])
  const { busy, error, setError, submit } = useSubmit(onClose)

  const save = () => {
    const parsed = parsePrice(price)
    if (parsed === null) return setError('Informe um preço válido (ex.: 32,90).')
    if (!categoryId) return setError('Crie uma categoria antes de adicionar produtos.')
    submit(() =>
      onSave({
        id: item?.id,
        expected: item?.updated_at,
        client_id: catalog.client.id,
        category_id: categoryId,
        name,
        description,
        price: parsed,
        status,
        sku,
        group_ids: groupIds,
      }),
    )
  }

  return (
    <Modal title={item ? 'Editar produto' : 'Novo produto'} description={catalog.client.name} onClose={onClose} width="max-w-2xl">
      <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
        <label className="block">
          <FieldLabel>Nome</FieldLabel>
          <TextInput value={name} onChange={setName} autoFocus placeholder="Ex.: X-Burger Clássico" />
        </label>
        <label className="block">
          <FieldLabel>Preço (R$)</FieldLabel>
          <TextInput value={price} onChange={setPrice} placeholder="0,00" className="text-right font-mono" />
        </label>
      </div>
      <label className="mt-3 block">
        <FieldLabel>Descrição</FieldLabel>
        <Textarea value={description} onChange={setDescription} placeholder="Ingredientes, tamanho, serve quantas pessoas…" />
        <span className="mt-1 block text-right text-[10px] text-[#85817C]">{description.length}/1000</span>
      </label>
      <div className="mt-1 grid gap-3 sm:grid-cols-3">
        <label className="block">
          <FieldLabel>Categoria</FieldLabel>
          <TextSelect value={categoryId} onChange={setCategoryId} options={categories.map((c) => ({ value: c.id, label: c.name }))} ariaLabel="Categoria" />
        </label>
        <label className="block">
          <FieldLabel>Status</FieldLabel>
          <TextSelect value={status} onChange={(v) => setStatus(v as MenuStatus)} options={STATUS_OPTIONS} ariaLabel="Status" />
        </label>
        <label className="block">
          <FieldLabel>Código / SKU</FieldLabel>
          <TextInput value={sku} onChange={setSku} placeholder="Opcional" />
        </label>
      </div>

      <div className="mt-4">
        <FieldLabel>Grupos de complementos</FieldLabel>
        {catalog.groups.length === 0 ? (
          <p className="text-[12px] text-[#85817C]">Nenhum grupo criado. Crie na aba Complementos.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {catalog.groups.map((g) => {
              const on = groupIds.includes(g.id)
              return (
                <button
                  key={g.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setGroupIds((cur) => (on ? cur.filter((x) => x !== g.id) : [...cur, g.id]))}
                  className={cn(
                    'rounded-full border px-3 py-1 text-[12px] transition-colors',
                    on ? 'border-[#D7141F] bg-[#D7141F]/15 text-white' : 'border-[#2A2A2E] bg-[#0B0B0C] text-[#B8B3AC] hover:border-[#D7141F]/50',
                  )}
                >
                  {g.name} <span className="text-[#85817C]">· {g.min_qty}–{g.max_qty}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>
      {item?.ifood_id && (
        <p className="mt-4 text-[11px] text-[#85817C]">
          Vinculado ao iFood (<span className="font-mono">{item.ifood_id}</span>). Ao salvar, o produto entra na fila de pendências para aplicar no iFood.
        </p>
      )}
      <ErrorLine error={error} />
      <Footer busy={busy} onClose={onClose} onSave={save} />
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Combo
// ---------------------------------------------------------------------------
export function ComboModal({
  combo,
  catalog,
  onClose,
  onSave,
}: {
  combo: MenuItem | null
  catalog: MenuCatalog
  onClose: () => void
  onSave: (input: Record<string, unknown>) => Promise<ActionResult>
}) {
  const products = useMemo(() => catalog.items.filter((i) => i.kind === 'item'), [catalog.items])
  const byId = useMemo(() => new Map(catalog.items.map((i) => [i.id, i])), [catalog.items])
  const catName = useMemo(() => new Map(catalog.categories.map((c) => [c.id, c.name])), [catalog.categories])

  const [name, setName] = useState(combo?.name ?? '')
  const [description, setDescription] = useState(combo?.description ?? '')
  const [components, setComponents] = useState<{ component_id: string; quantity: number }[]>(
    combo?.components.map((c) => ({ component_id: c.component_id, quantity: c.quantity })) ?? [],
  )
  const [discount, setDiscount] = useState('10')
  const [price, setPrice] = useState(combo ? combo.price.toFixed(2).replace('.', ',') : '')
  const [status, setStatus] = useState<MenuStatus>(combo?.status ?? 'inactive')
  const [categoryId, setCategoryId] = useState(combo?.category_id ?? '')
  const [query, setQuery] = useState('')
  const { busy, error, setError, submit } = useSubmit(onClose)

  const parsedPrice = parsePrice(price)
  const totals = comboTotals({ price: parsedPrice ?? 0, components: components.map((c, i) => ({ ...c, sort_order: i })) }, byId)

  const results = useMemo(() => {
    const term = query.trim().toLowerCase()
    return products
      .filter((p) => !components.some((c) => c.component_id === p.id))
      .filter((p) => !term || p.name.toLowerCase().includes(term) || (catName.get(p.category_id) ?? '').toLowerCase().includes(term))
      .slice(0, 8)
  }, [products, components, query, catName])

  const setQty = (id: string, delta: number) =>
    setComponents((cur) =>
      cur.map((c) => (c.component_id === id ? { ...c, quantity: Math.min(20, Math.max(1, c.quantity + delta)) } : c)),
    )

  const autoDescription = () => {
    const parts = components.map((c) => `${c.quantity > 1 ? `${c.quantity}x ` : ''}${byId.get(c.component_id)?.name ?? ''}`)
    setDescription(parts.join(' + '))
  }

  const applySuggested = () => {
    const pct = Number(discount.replace(',', '.'))
    if (!Number.isFinite(pct)) return
    setPrice(suggestComboPrice(totals.full, pct).toFixed(2).replace('.', ','))
  }

  const save = () => {
    if (components.length < 2) return setError('Adicione pelo menos 2 produtos ao combo.')
    if (parsedPrice === null) return setError('Informe o preço do combo.')
    submit(() =>
      onSave({
        id: combo?.id,
        expected: combo?.updated_at,
        client_id: catalog.client.id,
        category_id: categoryId || null,
        name,
        description,
        price: parsedPrice,
        status,
        components,
      }),
    )
  }

  return (
    <Modal title={combo ? 'Editar combo' : 'Novo combo'} description={catalog.client.name} onClose={onClose} width="max-w-3xl">
      <div className="grid gap-5 md:grid-cols-[1.1fr_1fr]">
        <div>
          <FieldLabel>Produtos do combo</FieldLabel>
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#85817C]" />
            <TextInput value={query} onChange={setQuery} placeholder="Buscar produto para adicionar…" className="pl-9" />
          </div>
          <div className="mt-2 max-h-[180px] overflow-y-auto rounded-[5px] border border-[#1C1C1F]">
            {results.length === 0 ? (
              <p className="px-3 py-3 text-[12px] text-[#85817C]">{products.length === 0 ? 'Cadastre produtos primeiro.' : 'Nenhum produto encontrado.'}</p>
            ) : (
              results.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setComponents((cur) => [...cur, { component_id: p.id, quantity: 1 }])
                    setQuery('')
                  }}
                  className="flex w-full items-center justify-between gap-3 border-b border-[#18181B] px-3 py-2 text-left last:border-b-0 hover:bg-[#D7141F]/10"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] text-[#ECE9E3]">{p.name}</span>
                    <span className="block text-[11px] text-[#85817C]">{catName.get(p.category_id)}</span>
                  </span>
                  <span className="flex items-center gap-2 font-mono text-[12px] text-[#B8B3AC]">
                    {formatBRL(p.price)} <Plus size={14} className="text-[#D7141F]" />
                  </span>
                </button>
              ))
            )}
          </div>

          <div className="mt-3 space-y-1.5">
            {components.length === 0 && <p className="text-[12px] text-[#85817C]">Nenhum produto adicionado ainda.</p>}
            {components.map((c) => {
              const p = byId.get(c.component_id)
              return (
                <div key={c.component_id} className="flex items-center gap-2 rounded-[5px] border border-[#222225] bg-[#0D0D0E] px-2.5 py-2">
                  <div className="flex items-center rounded-md border border-[#2A2A2E]">
                    <button type="button" aria-label="Diminuir" onClick={() => setQty(c.component_id, -1)} className="p-1 text-[#B8B3AC] hover:text-white">
                      <Minus size={12} />
                    </button>
                    <span className="w-6 text-center font-mono text-[12px] text-white">{c.quantity}</span>
                    <button type="button" aria-label="Aumentar" onClick={() => setQty(c.component_id, 1)} className="p-1 text-[#B8B3AC] hover:text-white">
                      <Plus size={12} />
                    </button>
                  </div>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-[#ECE9E3]">{p?.name ?? 'Produto removido'}</span>
                  <span className="font-mono text-[12px] text-[#8E8A86]">{formatBRL((p?.price ?? 0) * c.quantity)}</span>
                  <button
                    type="button"
                    aria-label="Remover do combo"
                    onClick={() => setComponents((cur) => cur.filter((x) => x.component_id !== c.component_id))}
                    className="rounded p-1 text-[#86827D] hover:bg-white/[0.05] hover:text-[#FFB199]"
                  >
                    <X size={14} />
                  </button>
                </div>
              )
            })}
          </div>
        </div>

        <div>
          <label className="block">
            <FieldLabel>Nome do combo</FieldLabel>
            <TextInput value={name} onChange={setName} placeholder="Ex.: Combo Clássico" />
          </label>
          <div className="mt-3">
            <div className="flex items-center justify-between">
              <FieldLabel>Descrição</FieldLabel>
              <button type="button" onClick={autoDescription} disabled={components.length === 0} className="mb-1.5 text-[11px] font-semibold text-[#F0333D] hover:text-white disabled:opacity-40">
                Gerar dos itens
              </button>
            </div>
            <Textarea value={description} onChange={setDescription} rows={2} placeholder="Descrição do combo" />
          </div>

          <div className="mt-3 rounded-[6px] border border-[#222225] bg-[#0D0D0E] p-3">
            <div className="flex justify-between text-[12px] text-[#8E8A86]">
              <span>Preço cheio dos itens</span>
              <span className="font-mono text-[#ECE9E3]">{formatBRL(totals.full)}</span>
            </div>
            <div className="mt-2 flex items-end gap-2">
              <label className="block w-24">
                <FieldLabel>Desconto %</FieldLabel>
                <TextInput value={discount} onChange={setDiscount} className="h-9 text-right font-mono" />
              </label>
              <Btn size="sm" onClick={applySuggested} disabled={totals.full <= 0} className="mb-0.5">
                <Sparkles size={13} /> Sugerir preço
              </Btn>
            </div>
            <label className="mt-2 block">
              <FieldLabel>Preço do combo (R$)</FieldLabel>
              <TextInput value={price} onChange={setPrice} placeholder="0,00" className="text-right font-mono text-[15px]" />
            </label>
            {parsedPrice !== null && totals.full > 0 && (
              <p className={cn('mt-2 text-[12px]', totals.savings > 0 ? 'text-[#34D399]' : 'text-[#FBBF24]')}>
                {totals.savings > 0
                  ? `Cliente economiza ${formatBRL(totals.savings)} (${totals.discountPercent.toLocaleString('pt-BR')}%)`
                  : 'Atenção: o combo não está mais barato que os itens separados.'}
              </p>
            )}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="block">
              <FieldLabel>Status</FieldLabel>
              <TextSelect value={status} onChange={(v) => setStatus(v as MenuStatus)} options={STATUS_OPTIONS} ariaLabel="Status" />
            </label>
            <label className="block">
              <FieldLabel>Categoria</FieldLabel>
              <TextSelect
                value={categoryId}
                onChange={setCategoryId}
                ariaLabel="Categoria"
                options={[{ value: '', label: '“Combos” (automática)' }, ...catalog.categories.map((c) => ({ value: c.id, label: c.name }))]}
              />
            </label>
          </div>
          {!combo && <p className="mt-2 text-[11px] text-[#85817C]">Combos novos nascem pausados por padrão: revise e ative quando estiver pronto.</p>}
        </div>
      </div>
      <ErrorLine error={error} />
      <Footer busy={busy} onClose={onClose} onSave={save} label={combo ? 'Salvar combo' : 'Criar combo'} />
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Grupo de complementos
// ---------------------------------------------------------------------------
export function GroupModal({
  group,
  clientId,
  onClose,
  onSave,
}: {
  group: MenuAddonGroup | null
  clientId: string
  onClose: () => void
  onSave: (input: Record<string, unknown>) => Promise<ActionResult>
}) {
  const [name, setName] = useState(group?.name ?? '')
  const [min, setMin] = useState(String(group?.min_qty ?? 0))
  const [max, setMax] = useState(String(group?.max_qty ?? 1))
  const [status, setStatus] = useState<MenuStatus>(group?.status ?? 'active')
  const { busy, error, setError, submit } = useSubmit(onClose)
  const save = () => {
    const min_qty = Number.parseInt(min, 10)
    const max_qty = Number.parseInt(max, 10)
    if (!Number.isFinite(min_qty) || !Number.isFinite(max_qty)) return setError('Mínimo e máximo precisam ser números.')
    submit(() => onSave({ id: group?.id, expected: group?.updated_at, client_id: clientId, name, min_qty, max_qty, status }))
  }
  return (
    <Modal title={group ? 'Editar grupo' : 'Novo grupo de complementos'} description="Ex.: “Escolha o ponto”, “Adicionais”, “Bebida do combo”." onClose={onClose}>
      <label className="block">
        <FieldLabel>Nome do grupo</FieldLabel>
        <TextInput value={name} onChange={setName} autoFocus />
      </label>
      <div className="mt-3 grid grid-cols-3 gap-3">
        <label className="block">
          <FieldLabel>Mínimo</FieldLabel>
          <TextInput value={min} onChange={setMin} type="number" />
        </label>
        <label className="block">
          <FieldLabel>Máximo</FieldLabel>
          <TextInput value={max} onChange={setMax} type="number" />
        </label>
        <label className="block">
          <FieldLabel>Status</FieldLabel>
          <TextSelect value={status} onChange={(v) => setStatus(v as MenuStatus)} options={STATUS_OPTIONS} ariaLabel="Status" />
        </label>
      </div>
      <p className="mt-2 text-[11px] text-[#85817C]">Mínimo 1 = obrigatório. Máximo = quantas opções o cliente pode escolher.</p>
      <ErrorLine error={error} />
      <Footer busy={busy} onClose={onClose} onSave={save} />
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Confirmação
// ---------------------------------------------------------------------------
export function ConfirmModal({
  title,
  message,
  confirmLabel,
  onClose,
  onConfirm,
}: {
  title: string
  message: string
  confirmLabel: string
  onClose: () => void
  onConfirm: () => Promise<ActionResult>
}) {
  const { busy, error, submit } = useSubmit(onClose)
  return (
    <Modal title={title} onClose={onClose}>
      <p className="text-[13px] leading-relaxed text-[#CFCBC4]">{message}</p>
      <ErrorLine error={error} />
      <div className="mt-5 flex justify-end gap-2 border-t border-[#1C1C1F] pt-4">
        <Btn variant="ghost" onClick={onClose}>
          Cancelar
        </Btn>
        <Btn variant="danger" disabled={busy} onClick={() => submit(onConfirm)}>
          {busy ? 'Aguarde…' : confirmLabel}
        </Btn>
      </div>
    </Modal>
  )
}
