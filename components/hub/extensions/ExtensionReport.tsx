'use client'

import { useMemo, useState } from 'react'
import { ChevronDown, Download, FileText, ImageOff, Images } from 'lucide-react'
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
  if (OK.has(s)) return <span className="rounded bg-[#34D399]/12 px-1.5 py-px text-[11px] font-semibold text-[#6EE7B7]">Aplicado</span>
  if (ERR.has(s)) return <span className="rounded bg-[#F87171]/12 px-1.5 py-px text-[11px] font-semibold text-[#FCA5A5]">Erro</span>
  return <span className="rounded bg-[#4B5870]/25 px-1.5 py-px text-[11px] font-semibold text-[#B4BFD0]">{status || 'Não executado'}</span>
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
        'inline-flex shrink-0 items-center gap-1.5 rounded-md font-semibold no-underline transition-colors hover:no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3D8EFF]',
        compact ? 'p-1 text-[#8A97AC] hover:bg-white/[0.06] hover:text-white' : 'bg-[#3D8EFF] px-3 py-1.5 text-[13px] text-[#06101F] hover:bg-[#6EA8FF]',
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
    <section className="mt-6" aria-labelledby="ext-report-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="ext-report-title" className="flex items-center gap-2 text-[16px] font-bold text-[#F1F5FC]">
          <FileText size={16} className="text-[#6EA8FF]" /> Relatório das extensões
        </h2>
        {clients.length > 1 && (
          <div className="w-[220px]">
            <TextSelect value={clientFilter} onChange={setClientFilter} ariaLabel="Filtrar por cliente" options={[{ value: '', label: 'Todos os clientes' }, ...clients]} />
          </div>
        )}
      </div>

      <div role="tablist" aria-label="Canal" className="mt-3 flex gap-1 border-b border-[#1A2231]">
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
              '-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-[13px] font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#3D8EFF]',
              tab === c.id ? 'border-[#3D8EFF] text-[#F1F5FC]' : 'border-transparent text-[#8A97AC] hover:text-[#C9D3E3]',
            )}
          >
            {c.label}
            <span className={cn('rounded px-1.5 py-px text-[11px]', tab === c.id ? 'bg-[#3D8EFF]/15 text-[#9CC3FF]' : 'bg-white/[0.05] text-[#7C8AA1]')}>{counts[c.id]}</span>
          </button>
        ))}
      </div>

      <div role="tabpanel" id="ext-report-panel" aria-labelledby={`ext-report-tab-${tab}`}>
      {unavailable ? (
        <div className="mt-3">
          <Empty title="Relatório ainda indisponível">O banco ainda não tem as tabelas de histórico (migration 0005). Assim que forem aplicadas, as otimizações e os prints enviados pela extensão aparecem aqui.</Empty>
        </div>
      ) : list.length === 0 ? (
        <div className="mt-3">
          <Empty title={`Nenhuma otimização do ${channel.label} ainda`}>
            Quando a extensão {channel.label} aplicar um plano aprovado {channel.portal}, o resultado de cada alteração e os prints aparecem aqui.
          </Empty>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          {list.map((r) => {
            const expanded = open === r.id
            const resultBy = new Map(r.results.map((x) => [x.action_id, x]))
            const total = r.approved.length || r.results.length
            return (
              <article key={r.id} className="overflow-hidden rounded-xl border border-[#1E2738] bg-[#0D1320]">
                <button
                  type="button"
                  onClick={() => setOpen(expanded ? null : r.id)}
                  aria-expanded={expanded}
                  className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left hover:bg-white/[0.02] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#3D8EFF]"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-bold text-[#F1F5FC]">{r.client_name}</span>
                    <span className="block text-[11px] text-[#7C8AA1]">
                      {when(r.created_at)} · plano v{r.version} · {total} alteraç{total === 1 ? 'ão' : 'ões'} · {r.evidence.length} print{r.evidence.length === 1 ? '' : 's'}
                    </span>
                  </span>
                  <span className="flex items-center gap-1.5 text-[11px] font-semibold">
                    <span className="rounded bg-[#34D399]/12 px-1.5 py-px text-[#6EE7B7]">{r.ok_count} aplicada{r.ok_count === 1 ? '' : 's'}</span>
                    {r.error_count > 0 && <span className="rounded bg-[#F87171]/12 px-1.5 py-px text-[#FCA5A5]">{r.error_count} com erro</span>}
                    {r.aborted && <span className="rounded bg-[#FBBF24]/12 px-1.5 py-px text-[#FCD34D]">Interrompida</span>}
                  </span>
                  <ChevronDown size={16} className={cn('shrink-0 text-[#7F8CA3] transition-transform', expanded && 'rotate-180')} />
                </button>

                {expanded && (
                  <div className="border-t border-[#1A2231] px-4 py-3">
                    {r.summary && <p className="text-[13px] leading-relaxed text-[#C9D3E3]">{r.summary}</p>}

                    {r.approved.length > 0 && (
                      <div className="mt-3 overflow-x-auto rounded-lg border border-[#1A2231]">
                        <table className="w-full min-w-[640px] border-collapse text-left text-[12px]">
                          <thead>
                            <tr className="border-b border-[#1A2231] bg-[#0B111D] text-[10px] font-bold uppercase tracking-[0.1em] text-[#8A97AC]">
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
                                <tr key={a.id ?? i} className="border-b border-[#141B28] align-top last:border-b-0">
                                  <td className="px-3 py-2">
                                    <span className="block font-semibold text-[#E8EDF7]">{a.item_name || '—'}</span>
                                    {a.kind && <span className="text-[10px] uppercase tracking-wider text-[#7C8AA1]">{a.kind}</span>}
                                  </td>
                                  <td className="px-3 py-2 text-[#B4BFD0]">
                                    {lines.map((l, j) => (
                                      <span key={j} className="block">
                                        {l.field && <span className="text-[#7C8AA1]">{l.field}: </span>}
                                        <span className="text-[#8A97AC] line-through decoration-[#4B5870]">{l.from}</span> <span className="text-[#7C8AA1]">→</span>{' '}
                                        <span className="text-[#E8EDF7]">{l.to}</span>
                                      </span>
                                    ))}
                                    {a.reason && <span className="mt-0.5 block text-[11px] italic text-[#7C8AA1]">{a.reason}</span>}
                                  </td>
                                  <td className="px-3 py-2">
                                    {statusBadge(res?.status)}
                                    {res?.message && <span className="mt-0.5 block text-[11px] text-[#8A97AC]">{res.message}</span>}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}

                    <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                      <h3 className="flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-[0.08em] text-[#8A97AC]">
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
                          className="inline-flex items-center gap-1.5 rounded-md border border-[#26314A] px-2.5 py-1 text-[12px] font-semibold text-[#C9D3E3] transition-colors hover:border-[#3D8EFF] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3D8EFF] disabled:opacity-60"
                        >
                          <Download size={14} /> {busyAll === r.id ? 'Baixando…' : `Baixar todos (${r.evidence.filter((e) => e.download_url).length})`}
                        </button>
                      )}
                    </div>
                    {r.evidence.length === 0 ? (
                      <p className="mt-1 text-[12px] text-[#7C8AA1]">Nenhum print nesta execução.</p>
                    ) : (
                      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                        {r.evidence.map((e) =>
                          e.url ? (
                            <div key={e.id} className="overflow-hidden rounded-lg border border-[#1E2738] bg-[#080D18]">
                              <button
                                type="button"
                                onClick={() => setViewing({ name: e.name, url: e.url!, download: e.download_url })}
                                aria-label={`Ampliar ${e.name}`}
                                className="group block w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#3D8EFF]"
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={e.url} alt={e.name} loading="lazy" className="aspect-video w-full object-cover object-top transition-opacity group-hover:opacity-85" />
                              </button>
                              <div className="flex items-center gap-1 px-2 py-1">
                                <span className="min-w-0 flex-1 truncate text-[11px] text-[#B4BFD0]">{e.name}</span>
                                {e.download_url && <DownloadLink href={e.download_url} name={e.name} compact />}
                              </div>
                            </div>
                          ) : (
                            <div key={e.id} className="flex aspect-video flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-[#26314A] text-[11px] text-[#7C8AA1]">
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
          <p className="text-[11px] text-[#7C8AA1]">Os links dos prints expiram em 10 min — use “Sincronizar” para renovar.</p>
        </div>
      )}
      </div>

      {viewing && (
        <Modal title={viewing.name} onClose={() => setViewing(null)} width="max-w-5xl">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={viewing.url} alt={viewing.name} className="max-h-[70vh] w-full rounded-lg object-contain" />
          {viewing.download && (
            <div className="mt-4 flex justify-end border-t border-[#1A2231] pt-3">
              <DownloadLink href={viewing.download} name={viewing.name} />
            </div>
          )}
        </Modal>
      )}
    </section>
  )
}
