'use client'

import { useMemo, useState } from 'react'
import { ChevronDown, Clock, Download, FileText, ImageOff, Images } from 'lucide-react'
import { cn, Modal, TextSelect } from '@/components/hub/ui'
import { Empty } from '@/components/hub/menu/shared'

export type OptimizationReport = {
  id: string
  client_id: string
  client_name: string
  /** Canal de origem (extensão que enviou): iFood, Cardápio Web ou Anota AI. */
  platform: Platform
  version: number
  summary: string
  aborted: boolean
  ok_count: number
  error_count: number
  created_at: string
  approved: { id?: string; kind?: string; item_name?: string; before?: unknown; after?: unknown; reason?: string; source?: string }[]
  results: { action_id?: string; status?: string; message?: string }[]
  evidence: { id: string; name: string; url: string | null; download_url: string | null }[]
}

export type Platform = 'ifood' | 'cardapioweb' | 'anotaai'
const CHANNELS: { id: Platform; label: string; portal: string }[] = [
  { id: 'ifood', label: 'iFood', portal: 'no iFood' },
  { id: 'cardapioweb', label: 'Cardápio Web', portal: 'no Cardápio Web' },
  { id: 'anotaai', label: 'Anota AI', portal: 'no Anota AI' },
]

const OK = new Set(['ok', 'feito', 'done', 'aplicado'])
const ERR = new Set(['erro', 'error', 'failed', 'falhou'])

const FIELD_LABEL: Record<string, string> = { name: 'Nome', description: 'Descrição', price: 'Preço', status: 'Status', sort_order: 'Ordem', category: 'Categoria' }

function when(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
}

function fmt(field: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (field === 'price' && typeof v === 'number') return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 120)
  const s = String(v)
  return s.length > 120 ? `${s.slice(0, 117)}…` : s
}

/** Converte before/after (formato livre vindo da extensão) em linhas "campo: antes → depois". */
function describeChange(before: unknown, after: unknown): { field: string; from: string; to: string }[] {
  const isObj = (x: unknown): x is Record<string, unknown> => Boolean(x) && typeof x === 'object' && !Array.isArray(x)
  if (isObj(after)) {
    const b = isObj(before) ? before : {}
    return Object.keys(after)
      .filter((k) => after[k] !== undefined)
      .slice(0, 6)
      .map((k) => ({ field: FIELD_LABEL[k] ?? k, from: fmt(k, b[k]), to: fmt(k, after[k]) }))
  }
  if (after === undefined && before === undefined) return []
  return [{ field: '', from: fmt('', before), to: fmt('', after) }]
}

function statusBadge(status: string | undefined) {
  const s = (status ?? '').toLowerCase()
  if (OK.has(s)) return <span className="rounded-full bg-[#34D399]/12 px-2 py-0.5 text-[11px] font-semibold text-[#6EE7B7]">Aplicado</span>
  if (ERR.has(s)) return <span className="rounded-full bg-[#FF6A3D]/12 px-2 py-0.5 text-[11px] font-semibold text-[#FFB199]">Erro</span>
  return <span className="rounded-full bg-[#55555C]/25 px-2 py-0.5 text-[11px] font-semibold text-[#B8B3AC]">{status || 'Não executado'}</span>
}

/** Baixa o print: a URL assinada traz `download=<nome>` (Content-Disposition: attachment). */
function DownloadLink({ href, name, compact = false }: { href: string; name: string; compact?: boolean }) {
  return (
    <a
      href={href}
      download={name}
      rel="noopener noreferrer"
      aria-label={`Baixar ${name}`}
      title={`Baixar ${name}`}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-md font-semibold no-underline transition-colors hover:no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D7141F]',
        compact ? 'p-1 text-[#8E8A86] hover:bg-white/[0.06] hover:text-white' : 'bg-[#D7141F] px-3 py-1.5 text-[13px] text-[#FFFFFF] hover:bg-[#F0333D]',
      )}
    >
      <Download size={compact ? 14 : 15} />
      {!compact && 'Baixar'}
    </a>
  )
}

/**
 * Baixa todos os prints de uma execução, um após o outro (cada URL assinada já
 * responde como anexo). O Chrome pode pedir 1× permissão para "vários downloads".
 */
async function downloadAll(files: { name: string; download_url: string | null }[]) {
  for (const f of files) {
    if (!f.download_url) continue
    const a = document.createElement('a')
    a.href = f.download_url
    a.download = f.name
    a.rel = 'noopener noreferrer'
    document.body.appendChild(a)
    a.click()
    a.remove()
    await new Promise((r) => setTimeout(r, 400))
  }
}

export function ExtensionReport({ reports, unavailable }: { reports: OptimizationReport[]; unavailable: boolean }) {
  const counts = useMemo(() => {
    const c: Record<Platform, number> = { ifood: 0, cardapioweb: 0, anotaai: 0 }
    for (const r of reports) c[r.platform] += 1
    return c
  }, [reports])
  // Abre na aba do envio mais recente
  const [tab, setTab] = useState<Platform>(reports[0]?.platform ?? 'ifood')
  const [clientFilter, setClientFilter] = useState('')
  const [open, setOpen] = useState<string | null>(reports[0]?.id ?? null)
  const [viewing, setViewing] = useState<{ name: string; url: string; download: string | null } | null>(null)
  const [busyAll, setBusyAll] = useState<string | null>(null)

  const inTab = useMemo(() => reports.filter((r) => r.platform === tab), [reports, tab])
  const channel = CHANNELS.find((c) => c.id === tab)!
  const clients = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of inTab) m.set(r.client_id, r.client_name)
    return Array.from(m, ([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'))
  }, [inTab])
  const list = clientFilter ? inTab.filter((r) => r.client_id === clientFilter) : inTab
  const switchTab = (p: Platform) => {
    setTab(p)
    setClientFilter('')
    setOpen(reports.find((r) => r.platform === p)?.id ?? null)
  }

  return (
    <section className="uc-neon relative mt-6 overflow-hidden rounded-3xl border border-[#D7141F]/25 bg-gradient-to-b from-[#1A0A0C]/85 via-[#0E0E10] to-[#0B0B0C] p-4 sm:p-5" aria-labelledby="ext-report-title">
      <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-[#D7141F]/15 blur-3xl" aria-hidden="true" />
      <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-[#F0333D]/70 to-transparent" aria-hidden="true" />
      <div className="relative flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="ext-report-title" className="flex items-center gap-2 text-[16px] font-bold text-[#F7F5F1]">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-[#D7141F]/35 bg-[#D7141F]/15 text-[#F0333D] shadow-[0_0_20px_-6px_rgba(215,20,31,0.9)]">
              <FileText size={16} />
            </span>
            Relatório das extensões
          </h2>
          <p className="mt-1 text-[12px] text-[#8E8A86]">Planos aprovados, resultado por alteração e prints enviados por cada canal.</p>
        </div>
        {clients.length > 1 && (
          <div className="w-[220px]">
            <TextSelect value={clientFilter} onChange={setClientFilter} ariaLabel="Filtrar por cliente" options={[{ value: '', label: 'Todos os clientes' }, ...clients]} />
          </div>
        )}
      </div>

      <div role="tablist" aria-label="Canal" className="relative mt-4 flex flex-wrap gap-1.5">
        {CHANNELS.map((c) => (
          <button
            key={c.id}
            type="button"
            role="tab"
            id={`ext-report-tab-${c.id}`}
            aria-selected={tab === c.id}
            aria-controls="ext-report-panel"
            onClick={() => switchTab(c.id)}
            className={cn(
              'inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-[12px] font-semibold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D7141F]',
              tab === c.id
                ? 'border-[#D7141F]/60 bg-[#D7141F]/15 text-[#F7F5F1] shadow-[0_0_22px_-8px_rgba(215,20,31,0.8)]'
                : 'border-white/[0.08] bg-white/[0.02] text-[#9F9A94] hover:border-white/20 hover:text-white',
            )}
          >
            {c.label}
            <span className={cn('rounded-full px-1.5 py-px text-[10px]', tab === c.id ? 'bg-[#D7141F]/25 text-[#FF8A90]' : 'bg-white/[0.06] text-[#85817C]')}>{counts[c.id]}</span>
          </button>
        ))}
      </div>

      <div role="tabpanel" id="ext-report-panel" aria-labelledby={`ext-report-tab-${tab}`}> 
      {unavailable ? (
        <div className="mt-4">
          <Empty title="Relatório ainda indisponível">O banco ainda não tem as tabelas de histórico (migration 0005). Assim que forem aplicadas, as otimizações e os prints enviados pela extensão aparecem aqui.</Empty>
        </div>
      ) : list.length === 0 ? (
        <div className="mt-4">
          <Empty title={`Nenhuma otimização do ${channel.label} ainda`}>
            Quando a extensão {channel.label} aplicar um plano aprovado {channel.portal}, o resultado de cada alteração e os prints aparecem aqui.
          </Empty>
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          {list.map((r) => {
            const expanded = open === r.id
            const resultBy = new Map(r.results.map((x) => [x.action_id, x]))
            const total = r.approved.length || r.results.length
            return (
              <article key={r.id} className="overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.02] transition-colors hover:border-[#D7141F]/35">
                <button
                  type="button"
                  onClick={() => setOpen(expanded ? null : r.id)}
                  aria-expanded={expanded}
                  className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left hover:bg-white/[0.02] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#D7141F]"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-bold text-[#F7F5F1]">{r.client_name}</span>
                    <span className="block text-[11px] text-[#85817C]">
                      {when(r.created_at)} · plano v{r.version} · {total} alteraç{total === 1 ? 'ão' : 'ões'} · {r.evidence.length} print{r.evidence.length === 1 ? '' : 's'}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold">
                    <span className="rounded-full bg-[#34D399]/12 px-2 py-0.5 text-[#6EE7B7]">{r.ok_count} aplicada{r.ok_count === 1 ? '' : 's'}</span>
                    {r.error_count > 0 && <span className="rounded-full bg-[#FF6A3D]/12 px-2 py-0.5 text-[#FFB199]">{r.error_count} com erro</span>}
                    {r.aborted && <span className="rounded-full bg-[#FBBF24]/12 px-2 py-0.5 text-[#FCD34D]">Interrompida</span>}
                  </span>
                  <ChevronDown size={16} className={cn('shrink-0 text-[#86827D] transition-transform', expanded && 'rotate-180')} />
                </button>

                {expanded && (
                  <div className="border-t border-[#1C1C1F] px-4 py-3">
                    {r.summary && <p className="text-[13px] leading-relaxed text-[#CFCBC4]">{r.summary}</p>}

                    {r.approved.length > 0 && (
                      <div className="mt-3 overflow-x-auto rounded-xl border border-white/[0.07]">
                        <table className="w-full min-w-[640px] border-collapse text-left text-[12px]">
                          <thead>
                            <tr className="border-b border-[#1C1C1F] bg-[#0E0E10] text-[10px] font-bold font-mono uppercase tracking-[0.1em] text-[#8E8A86]">
                              <th className="px-3 py-2">Produto</th>
                              <th className="px-3 py-2">Alteração</th>
                              <th className="px-3 py-2">Resultado</th>
                            </tr>
                          </thead>
                          <tbody>
                            {r.approved.map((a, i) => {
                              const res = a.id ? resultBy.get(a.id) : undefined
                              const lines = describeChange(a.before, a.after)
                              return (
                                <tr key={a.id ?? i} className="border-b border-[#18181B] align-top last:border-b-0">
                                  <td className="px-3 py-2">
                                    <span className="block font-semibold text-[#ECE9E3]">{a.item_name || '—'}</span>
                                    {a.kind && <span className="text-[10px] font-mono uppercase tracking-wider text-[#85817C]">{a.kind}</span>}
                                  </td>
                                  <td className="px-3 py-2 text-[#B8B3AC]">
                                    {lines.map((l, j) => (
                                      <span key={j} className="block">
                                        {l.field && <span className="text-[#85817C]">{l.field}: </span>}
                                        <span className="text-[#8E8A86] line-through decoration-[#55555C]">{l.from}</span> <span className="text-[#85817C]">→</span>{' '}
                                        <span className="text-[#ECE9E3]">{l.to}</span>
                                      </span>
                                    ))}
                                    {a.reason && <span className="mt-0.5 block text-[11px] italic text-[#85817C]">{a.reason}</span>}
                                  </td>
                                  <td className="px-3 py-2">
                                    {statusBadge(res?.status)}
                                    {res?.message && <span className="mt-0.5 block text-[11px] text-[#8E8A86]">{res.message}</span>}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}

                    <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                      <h3 className="flex items-center gap-1.5 text-[12px] font-bold font-mono uppercase tracking-[0.08em] text-[#8E8A86]">
                        <Images size={14} /> Prints enviados pela extensão {channel.label}
                      </h3>
                      {r.evidence.some((e) => e.download_url) && (
                        <button
                          type="button"
                          disabled={busyAll === r.id}
                          onClick={async () => {
                            setBusyAll(r.id)
                            await downloadAll(r.evidence)
                            setBusyAll(null)
                          }}
                          className="inline-flex items-center gap-1.5 rounded-md border border-[#2A2A2E] px-2.5 py-1 text-[12px] font-semibold text-[#CFCBC4] transition-colors hover:border-[#D7141F] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D7141F] disabled:opacity-60"
                        >
                          <Download size={14} /> {busyAll === r.id ? 'Baixando…' : `Baixar todos (${r.evidence.filter((e) => e.download_url).length})`}
                        </button>
                      )}
                    </div>
                    {r.evidence.length === 0 ? (
                      <p className="mt-1 text-[12px] text-[#85817C]">Nenhum print nesta execução.</p>
                    ) : (
                      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                        {r.evidence.map((e) =>
                          e.url ? (
                            <div key={e.id} className="overflow-hidden rounded-xl border border-white/[0.08] bg-black/25">
                              <button
                                type="button"
                                onClick={() => setViewing({ name: e.name, url: e.url!, download: e.download_url })}
                                aria-label={`Ampliar ${e.name}`}
                                className="group block w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#D7141F]"
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={e.url} alt={e.name} loading="lazy" className="aspect-video w-full object-cover object-top transition-opacity group-hover:opacity-85" />
                              </button>
                              <div className="flex items-center gap-1 px-2 py-1">
                                <span className="min-w-0 flex-1 truncate text-[11px] text-[#B8B3AC]">{e.name}</span>
                                {e.download_url && <DownloadLink href={e.download_url} name={e.name} compact />}
                              </div>
                            </div>
                          ) : (
                            <div key={e.id} className="flex aspect-video flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-white/10 text-[11px] text-[#85817C]">
                              <ImageOff size={16} /> {e.name}
                            </div>
                          ),
                        )}
                      </div>
                    )}
                  </div>
                )}
              </article>
            )
          })}
          <p className="flex items-center gap-1.5 rounded-xl border border-white/[0.06] bg-black/20 px-3 py-2 text-[11px] text-[#85817C]">
            <Clock size={12} /> Os links dos prints expiram em 10 min — use “Sincronizar” para renovar.
          </p>
        </div>
      )}
      </div>

      {viewing && (
        <Modal title={viewing.name} onClose={() => setViewing(null)} width="max-w-5xl">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={viewing.url} alt={viewing.name} className="max-h-[70vh] w-full rounded-xl object-contain" />
          {viewing.download && (
            <div className="mt-4 flex justify-end border-t border-[#1C1C1F] pt-3">
              <DownloadLink href={viewing.download} name={viewing.name} />
            </div>
          )}
        </Modal>
      )}
    </section>
  )
}
