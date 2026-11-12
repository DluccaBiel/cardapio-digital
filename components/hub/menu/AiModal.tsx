'use client'

import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { formatBRL } from '@/lib/format'
import type { Goal, Suggestions } from '@/lib/ai/optimize'
import { applyAiSuggestionsAction, suggestWithAiAction } from '@/app/a/[ws]/cardapio/actions'
import { cn, FieldLabel, Modal, TextSelect } from '@/components/hub/ui'
import { Btn, Textarea } from './shared'

const GOAL_OPTIONS: { value: Goal; label: string }[] = [
  { value: 'ticket', label: 'Aumentar ticket médio' },
  { value: 'conversao', label: 'Aumentar conversão' },
  { value: 'margem', label: 'Melhorar margem' },
  { value: 'organizacao', label: 'Organizar e padronizar' },
]

/**
 * IA assistida: gera sugestões → você revisa/desmarca → "Aplicar selecionadas".
 * Produtos alterados entram na fila do iFood (a extensão aplica sozinha);
 * combos nascem pausados.
 */
export function AiModal({ ws, clientId, clientName, onClose, onApplied }: { ws: string; clientId: string; clientName: string; onClose: () => void; onApplied: (msg: string) => void }) {
  const [goal, setGoal] = useState<Goal>('ticket')
  const [notes, setNotes] = useState('')
  const [pct, setPct] = useState('10')
  const [busy, setBusy] = useState<null | 'suggest' | 'apply'>(null)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<Suggestions | null>(null)
  const [offUpdates, setOffUpdates] = useState<Set<string>>(new Set())
  const [offCombos, setOffCombos] = useState<Set<number>>(new Set())

  const suggest = async () => {
    setBusy('suggest')
    setError(null)
    const res = await suggestWithAiAction(ws, { clientId, goal, notes, maxPriceChangePct: Number(pct) || 0 })
    setBusy(null)
    if (!res.ok) return setError(res.error)
    setData(res.data)
    setOffUpdates(new Set())
    setOffCombos(new Set())
  }

  const apply = async () => {
    if (!data) return
    setBusy('apply')
    setError(null)
    const res = await applyAiSuggestionsAction(ws, {
      clientId,
      updates: data.updates.filter((u) => !offUpdates.has(u.item_id)).map((u) => ({ item_id: u.item_id, updated_at: u.updated_at, after: u.after })),
      combos: data.combos
        .filter((_, i) => !offCombos.has(i))
        .map((c) => ({ name: c.name, description: c.description, price: c.price, components: c.components.map((x) => ({ component_id: x.component_id, quantity: x.quantity })) })),
    })
    setBusy(null)
    if (!res.ok) return setError(res.error)
    onApplied(
      `${res.applied} sugestão(ões) aplicada(s) no Undercut${res.failed.length ? ` · ${res.failed.length} com conflito` : ''}. Os produtos entraram na fila do iFood e a extensão aplica no portal.`,
    )
    onClose()
  }

  const selectedCount = data ? data.updates.length - offUpdates.size + data.combos.length - offCombos.size : 0

  return (
    <Modal title="Otimizar com IA" description={clientName} onClose={onClose} width="max-w-3xl">
      {!data ? (
        <div>
          <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
            <label className="block">
              <FieldLabel>Objetivo</FieldLabel>
              <TextSelect value={goal} onChange={(v) => setGoal(v as Goal)} options={GOAL_OPTIONS} ariaLabel="Objetivo" />
            </label>
            <label className="block">
              <FieldLabel>Variação máx. de preço %</FieldLabel>
              <TextSelect
                value={pct}
                onChange={setPct}
                ariaLabel="Variação máxima de preço"
                options={[
                  { value: '0', label: 'Não mexer em preço' },
                  { value: '5', label: 'até 5%' },
                  { value: '10', label: 'até 10%' },
                  { value: '15', label: 'até 15%' },
                  { value: '20', label: 'até 20%' },
                ]}
              />
            </label>
          </div>
          <label className="mt-3 block">
            <FieldLabel>Observações (opcional)</FieldLabel>
            <Textarea value={notes} onChange={setNotes} rows={3} placeholder="Ex.: o carro-chefe é o X-Bacon; não mexer nas bebidas; público família." />
          </label>
          <p className="mt-2 text-[11px] text-[#85817C]">Nada é alterado até você aprovar. Leva de 20 a 60 segundos.</p>
        </div>
      ) : (
        <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
          <p className="rounded-[5px] border border-[#D7141F]/30 bg-[#D7141F]/10 px-3 py-2 text-[13px] leading-relaxed text-[#FFD9DB]">{data.summary}</p>
          {data.updates.length > 0 && (
            <section>
              <FieldLabel>Produtos ({data.updates.length})</FieldLabel>
              <div className="space-y-2">
                {data.updates.map((u) => {
                  const on = !offUpdates.has(u.item_id)
                  return (
                    <label key={u.item_id} className={cn('flex cursor-pointer gap-3 rounded-[5px] border p-3', on ? 'border-[#D7141F]/50 bg-[#1F0D0F]' : 'border-[#222225] bg-[#0D0D0E] opacity-60')}>
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => setOffUpdates((cur) => { const n = new Set(cur); if (n.has(u.item_id)) n.delete(u.item_id); else n.add(u.item_id); return n })}
                        className="mt-1 accent-[#D7141F]"
                      />
                      <span className="min-w-0 flex-1 text-[12px]">
                        <b className="text-[13px] text-[#F7F5F1]">{u.item_name}</b>
                        {u.after.name && <span className="block text-[#CFCBC4]">Nome: <s className="text-[#85817C]">{u.before.name}</s> → {u.after.name}</span>}
                        {u.after.price !== undefined && (
                          <span className="block text-[#CFCBC4]">Preço: <s className="text-[#85817C]">{formatBRL(u.before.price)}</s> → <b>{formatBRL(u.after.price)}</b></span>
                        )}
                        {u.after.description && <span className="mt-1 block text-[#CFCBC4]">Descrição: {u.after.description}</span>}
                        <span className="mt-1 block text-[11px] text-[#8E8A86]">{u.reason}</span>
                      </span>
                    </label>
                  )
                })}
              </div>
            </section>
          )}
          {data.combos.length > 0 && (
            <section>
              <FieldLabel>Combos novos ({data.combos.length}) — nascem pausados</FieldLabel>
              <div className="space-y-2">
                {data.combos.map((c, i) => {
                  const on = !offCombos.has(i)
                  return (
                    <label key={i} className={cn('flex cursor-pointer gap-3 rounded-[5px] border p-3', on ? 'border-[#D7141F]/50 bg-[#1F0D0F]' : 'border-[#222225] bg-[#0D0D0E] opacity-60')}>
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => setOffCombos((cur) => { const n = new Set(cur); if (n.has(i)) n.delete(i); else n.add(i); return n })}
                        className="mt-1 accent-[#D7141F]"
                      />
                      <span className="min-w-0 flex-1 text-[12px] text-[#CFCBC4]">
                        <b className="text-[13px] text-[#F7F5F1]">{c.name}</b> · <s className="text-[#85817C]">{formatBRL(c.full_price)}</s> <b>{formatBRL(c.price)}</b>
                        <span className="block">{c.components.map((x) => `${x.quantity}× ${x.name}`).join(' + ')}</span>
                        <span className="block">{c.description}</span>
                        <span className="mt-1 block text-[11px] text-[#8E8A86]">{c.reason}</span>
                      </span>
                    </label>
                  )
                })}
              </div>
            </section>
          )}
          {data.updates.length + data.combos.length === 0 && <p className="text-[13px] text-[#8E8A86]">A IA não encontrou mudanças que valham a pena com esse objetivo.</p>}
          {data.discarded > 0 && <p className="text-[11px] text-[#85817C]">{data.discarded} sugestão(ões) descartada(s) pela validação (fora do limite de preço ou com itens inexistentes).</p>}
        </div>
      )}
      {error && <p className="mt-3 rounded-[5px] border border-[#FF6A3D]/40 bg-[#FF6A3D]/10 px-3 py-2 text-[12px] text-[#FFB199]">{error}</p>}
      <div className="mt-5 flex justify-end gap-2 border-t border-[#1C1C1F] pt-4">
        {data && (
          <Btn variant="ghost" onClick={() => setData(null)} disabled={busy !== null}>
            Gerar de novo
          </Btn>
        )}
        <Btn variant="ghost" onClick={onClose}>
          Cancelar
        </Btn>
        {!data ? (
          <Btn variant="primary" onClick={suggest} disabled={busy !== null}>
            <Sparkles size={14} /> {busy === 'suggest' ? 'Analisando cardápio…' : 'Gerar sugestões'}
          </Btn>
        ) : (
          <Btn variant="primary" onClick={apply} disabled={busy !== null || selectedCount === 0}>
            {busy === 'apply' ? 'Aplicando…' : `Aplicar selecionadas (${selectedCount})`}
          </Btn>
        )}
      </div>
    </Modal>
  )
}
