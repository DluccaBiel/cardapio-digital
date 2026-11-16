'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, Copy, MessageCircle } from 'lucide-react'
import type { ProspectClient } from '../../../lib/db/prospects'
import { Toast } from '../ui'
import { MissingColumnsNotice, NICHE_LABEL, PageHeader, Segmented, waNumber, type NicheFilter } from './shared'

type Mode = 'individual' | 'todos'

/**
 * Disparos assistidos: gera links wa.me com a mensagem pronta.
 * Nada é enviado automaticamente — o usuário abre cada conversa e confirma o envio.
 */
export function DisparosScreen({ clients, missingColumns }: { clients: ProspectClient[]; missingColumns: boolean }) {
  const [mode, setMode] = useState<Mode>('individual')
  const [niche, setNiche] = useState<NicheFilter>('all')
  const [selectedId, setSelectedId] = useState('')
  const [message, setMessage] = useState('')
  const [toast, setToast] = useState<string | null>(null)

  const pool = useMemo(() => clients.filter((c) => c.status !== 'encerrado' && (niche === 'all' || c.niche === niche)), [clients, niche])
  const withPhone = useMemo(() => pool.filter((c) => waNumber(c.whatsapp || c.phone)), [pool])

  const links = useMemo(() => {
    const text = message.trim()
    if (!text) return []
    const targets = mode === 'todos' ? withPhone : withPhone.filter((c) => c.id === selectedId)
    return targets.map((c) => {
      const personalized = text.replace(/\{nome\}/gi, c.name)
      return { client: c, url: `https://wa.me/${waNumber(c.whatsapp || c.phone)}?text=${encodeURIComponent(personalized)}` }
    })
  }, [message, mode, withPhone, selectedId])

  function flash(text: string) {
    setToast(text)
    window.setTimeout(() => setToast(null), 3000)
  }

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(links.map((l) => `${l.client.name}: ${l.url}`).join('\n'))
      flash(`${links.length} link(s) copiado(s).`)
    } catch {
      flash('Não foi possível copiar (permissão do navegador).')
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 pb-10 pt-5 sm:px-6 md:px-[30px] md:pt-[26px]">
      <PageHeader
        title="Disparos WhatsApp"
        description="Gere links wa.me com a mensagem pronta para cada cliente. O envio é sempre manual."
        actions={
          <Segmented
            ariaLabel="Modo de disparo"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'individual', label: 'Individual' },
              { value: 'todos', label: `Todos (${withPhone.length})` },
            ]}
          />
        }
      />

      {missingColumns && <MissingColumnsNotice />}

      <div className="mb-6 flex gap-3 rounded-[6px] border border-[#D7141F]/40 bg-[#1F0D0F]/60 p-4">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-[#F0333D]" />
        <div className="text-[12px] leading-relaxed text-[#FFB199]">
          <p className="font-bold text-[#F0333D]">Sem API oficial do WhatsApp Business</p>
          Os links abrem o WhatsApp com o texto preenchido; você confirma cada envio. Envios em massa podem violar os termos do WhatsApp e
          exigem consentimento (LGPD). Clientes encerrados ficam de fora.
        </div>
      </div>

      <div className="mb-6 grid gap-4 rounded-[6px] border border-[#222225] bg-[#111113] p-4 md:grid-cols-[1fr_280px]">
        <label className="block">
          <span className="mb-1.5 block font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-[#8E8A86]">Mensagem · use {'{nome}'} para personalizar</span>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Olá, {nome}! Tudo bem?"
            rows={4}
            maxLength={1000}
            className="w-full rounded-[5px] border border-[#2A2A2E] bg-[#0B0B0C] p-3 text-[13px] text-[#ECE9E3] outline-none placeholder:text-[#85817C] focus:border-[#D7141F]"
          />
        </label>
        <div className="space-y-3">
          <div>
            <span className="mb-1.5 block font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-[#8E8A86]">Nicho</span>
            <Segmented
              ariaLabel="Nicho"
              value={niche}
              onChange={setNiche}
              options={[
                { value: 'all', label: 'Todos' },
                { value: 'food', label: 'Food' },
                { value: 'health', label: 'Saúde' },
              ]}
            />
          </div>
          {mode === 'individual' && (
            <label className="block">
              <span className="mb-1.5 block font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-[#8E8A86]">Cliente</span>
              <select
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
                aria-label="Selecionar cliente"
                className="h-[36px] w-full cursor-pointer rounded-[5px] border border-[#2A2A2E] bg-[#0B0B0C] px-3 text-[13px] text-[#ECE9E3] outline-none focus:border-[#D7141F]"
              >
                <option value="">— Selecione —</option>
                {withPhone.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.niche ? ` · ${NICHE_LABEL[c.niche]}` : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
          <p className="font-mono text-[11px] text-[#85817C]">
            {withPhone.length} de {pool.length} cliente(s) com telefone válido
          </p>
        </div>
      </div>

      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="uc-title text-[18px] text-[#F7F5F1]">{links.length} link(s) prontos</h2>
        <button
          type="button"
          onClick={copyAll}
          disabled={links.length === 0}
          className="inline-flex items-center gap-1.5 rounded-[5px] border border-[#2A2A2E] px-3 py-1.5 text-[12px] font-semibold text-[#CFCBC4] hover:border-[#D7141F] hover:text-white disabled:opacity-40"
        >
          <Copy size={13} /> Copiar todos
        </button>
      </div>

      <div className="overflow-x-auto rounded-[6px] border border-[#222225]">
        <table className="w-full min-w-[560px] border-collapse text-left">
          <thead>
            <tr className="border-b border-[#1C1C1F] bg-[#0E0E10] font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-[#8E8A86]">
              <th className="px-3 py-2.5">Cliente</th>
              <th className="px-3 py-2.5">Telefone</th>
              <th className="px-3 py-2.5 text-right">WhatsApp</th>
            </tr>
          </thead>
          <tbody>
            {links.map((l) => (
              <tr key={l.client.id} className="border-b border-[#18181B] bg-[#111113] text-[12px] last:border-b-0 hover:bg-[#131315]">
                <td className="px-3 py-2.5 font-semibold text-[#ECE9E3]">{l.client.name}</td>
                <td className="px-3 py-2.5 font-mono text-[#CFCBC4]">{l.client.whatsapp || l.client.phone}</td>
                <td className="px-3 py-2.5 text-right">
                  <a href={l.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-[#4ADE80] hover:text-white">
                    <MessageCircle size={13} /> Abrir conversa
                  </a>
                </td>
              </tr>
            ))}
            {links.length === 0 && (
              <tr>
                <td colSpan={3} className="bg-[#111113] px-3 py-10 text-center text-[12px] text-[#85817C]">
                  {!message.trim()
                    ? 'Escreva a mensagem para gerar os links.'
                    : mode === 'individual'
                      ? 'Selecione um cliente.'
                      : 'Nenhum cliente com telefone válido neste filtro.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Toast message={toast} />
    </div>
  )
}
