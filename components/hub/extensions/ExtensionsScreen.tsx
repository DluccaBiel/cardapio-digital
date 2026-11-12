'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Activity,
  ArrowRight,
  Check,
  Copy,
  Download,
  Eye,
  EyeOff,
  KeyRound,
  Link2,
  Loader2,
  Package,
  Plug,
  Plus,
  Radio,
  RefreshCw,
  ShieldCheck,
  Trash2,
  WifiOff,
  Zap,
} from 'lucide-react'
import { cn, FieldLabel, Modal, TextInput, TextSelect, Toast } from '@/components/hub/ui'
import { Btn, Empty } from '@/components/hub/menu/shared'
import { brand } from '@undercut/brand'
import { SYNC_EVENT } from '@/components/hub/Header'
import { ExtensionReport, type OptimizationReport } from '@/components/hub/extensions/ExtensionReport'
import { ExtensionHub } from '@/components/hub/extensions/ExtensionHub'
import { IntegrationsSection } from '@/components/hub/extensions/IntegrationsSection'
import { ResearchPanel } from '@/components/hub/extensions/ResearchPanel'
import { PARTNERS, partnerOf } from '@/lib/extensions/partners'
import {
  checkExtensionsAction,
  createApiKeyAction,
  deleteApiKeysAction,
  pairExtensionAction,
  revokeApiKeyAction,
  revokeApiKeysAction,
  type ExtensionLiveStatus,
} from '@/app/a/[ws]/extensoes/actions'

export type { OptimizationReport }

type Extension = { id: string; slug: string; name: string; description: string | null; homepage_url?: string | null }
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
type InstallKey = { name: string; revoked_at?: string | null; expires_at?: string | null }
type Install = { extension_id: string; version: string | null; status: string; last_seen_at: string | null; api_keys?: InstallKey | InstallKey[] | null }

function installKey(i: Install): InstallKey | null {
  return (Array.isArray(i.api_keys) ? i.api_keys[0] : i.api_keys) ?? null
}

/** Mesmo formato vindo da página (Install) ou do "Sincronizar" (ExtensionLiveStatus). */
function liveFromInstall(i: Install): ExtensionLiveStatus {
  const k = installKey(i)
  const key: ExtensionLiveStatus['key'] = !k ? 'missing' : k.revoked_at ? 'revoked' : k.expires_at && new Date(k.expires_at).getTime() < Date.now() ? 'expired' : 'active'
  return { extension_id: i.extension_id, version: i.version, last_seen_at: i.last_seen_at, key, key_name: k?.name ?? null, key_last_used_at: null }
}

const MISSING = (id: string): ExtensionLiveStatus => ({ extension_id: id, version: null, last_seen_at: null, key: 'missing', key_name: null, key_last_used_at: null })

const ONLINE_MS = 10 * 60_000 // a extensão renova o contato ~1×/min com o portal aberto
type Conn = 'online' | 'idle' | 'off'
function connOf(s: ExtensionLiveStatus): Conn {
  if (s.key !== 'active') return 'off'
  return s.last_seen_at && Date.now() - new Date(s.last_seen_at).getTime() < ONLINE_MS ? 'online' : 'idle'
}
const KEY_PROBLEM: Record<Exclude<ExtensionLiveStatus['key'], 'active'>, string> = {
  revoked: 'a chave de acesso foi revogada',
  expired: 'a chave de acesso expirou',
  missing: 'a chave de acesso foi excluída',
}
const PORTAL: Record<string, string> = { 'orvia-ifood': 'o portal do iFood', 'orvia-cardapioweb': 'o Portal do Cardápio Web', 'orvia-anotaai': 'o painel do Anota AI' }
const SHORT: Record<string, string> = { 'orvia-ifood': 'iFood', 'orvia-cardapioweb': 'Cardápio Web', 'orvia-anotaai': 'Anota AI' }
const ORDER = ['orvia-ifood', 'orvia-cardapioweb', 'orvia-anotaai']
const rank = (slug: string) => (ORDER.includes(slug) ? ORDER.indexOf(slug) : ORDER.length)
function connText(s: ExtensionLiveStatus, slug?: string): string {
  const c = connOf(s)
  if (c === 'off') return `Desconectada — ${KEY_PROBLEM[s.key as Exclude<ExtensionLiveStatus['key'], 'active'>]}. Gere um código de conexão abaixo.`
  if (c === 'online') return `Conectada · último contato ${ago(s.last_seen_at)}`
  return `Conectada, sem contato recente${s.last_seen_at ? ` (último ${ago(s.last_seen_at)})` : ''} — abra ${PORTAL[slug ?? ''] ?? 'o portal'} com a extensão ativa`
}

function ago(iso: string | null) {
  if (!iso) return 'nunca'
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return `há ${s}s`
  if (s < 3600) return `há ${Math.round(s / 60)} min`
  if (s < 86_400) return `há ${Math.round(s / 3600)} h`
  return when(iso)
}

function when(iso: string | null) {
  if (!iso) return '—'
  // fuso fixo: servidor (UTC) e navegador precisam renderizar o mesmo texto (hidratação)
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
}

const SCOPE_INFO: { value: string; label: string; hint: string }[] = [
  { value: 'clientes:ler', label: 'Clientes · ler', hint: 'listar clientes para escolher o destino' },
  { value: 'catalogo:ler', label: 'Cardápio · ler', hint: 'ler cardápio e pendências' },
  { value: 'catalogo:escrever', label: 'Cardápio · escrever', hint: 'importar do iFood, confirmar aplicação, criar combo' },
  { value: 'pesquisa:ler', label: 'Pesquisa · ler', hint: 'pedir pesquisas ao agente do Undercut' },
  { value: 'clientes:escrever', label: 'Clientes · escrever', hint: 'não necessário para as extensões atuais' },
  { value: 'extensoes:ler', label: 'Extensões · ler', hint: 'diagnóstico' },
]
const DEFAULT_SCOPES = ['clientes:ler', 'catalogo:ler', 'catalogo:escrever']

/**
 * A extensão 0.4.x só tem host_permission fixa para brand.extensionHubUrl (previews *.vercel.app
 * e localhost são opcionais). No link curto público (brand.baseUrl) a conexão continua pelo
 * endereço da extensão, que serve o mesmo sistema.
 */
function extensionCompatible(origin: string): boolean {
  try {
    const h = new URL(origin).hostname
    if (h === new URL(brand.baseUrl).hostname && h !== new URL(brand.extensionHubUrl).hostname) return false
    return h === 'localhost' || h === '127.0.0.1' || h.endsWith('.vercel.app')
  } catch {
    return false
  }
}

type SyncState = { kind: 'idle' | 'busy' | 'done' | 'err'; text?: string; at?: string }
type Bulk = { action: 'revoke' | 'delete'; ids: string[] }

export function ExtensionsScreen({
  ws,
  workspaceName,
  canManage,
  canDelete = false,
  hubUrl,
  shortUrl = '',
  extensions,
  keys,
  installs,
  reports = [],
  reportsUnavailable = false,
  highlightPair = false,
}: {
  highlightPair?: boolean
  ws: string
  workspaceName: string
  canManage: boolean
  canDelete?: boolean
  hubUrl: string
  shortUrl?: string
  extensions: Extension[]
  keys: ApiKey[]
  installs: Install[]
  reports?: OptimizationReport[]
  reportsUnavailable?: boolean
}) {
  const router = useRouter()
  const refresh = useCallback(() => router.refresh(), [router])
  const [creating, setCreating] = useState(false)
  const [revoking, setRevoking] = useState<ApiKey | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulk, setBulk] = useState<Bulk | null>(null)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [sync, setSync] = useState<SyncState>({ kind: 'idle' })
  const [live, setLive] = useState<Map<string, ExtensionLiveStatus> | null>(null)
  const [autoAt, setAutoAt] = useState<string | null>(null)
  const [autoBusy, setAutoBusy] = useState(false)
  const autoRef = useRef(false)
  const [tab, setTab] = useState('')
  const extName = useMemo(() => new Map(extensions.map((e) => [e.id, e.name])), [extensions])
  const extSlug = useMemo(() => new Map(extensions.map((e) => [e.id, e.slug])), [extensions])

  const status = useMemo(() => {
    const m = new Map(installs.map((i) => [i.extension_id, liveFromInstall(i)]))
    if (live) live.forEach((s, id) => m.set(id, s))
    return m
  }, [installs, live])
  const statusOf = useCallback((id: string) => status.get(id) ?? MISSING(id), [status])

  const sorted = useMemo(() => [...extensions].sort((a, b) => rank(a.slug) - rank(b.slug)), [extensions])
  useEffect(() => {
    if (!tab && sorted.length) setTab(sorted[0]!.id)
  }, [tab, sorted])
  const activeExt = sorted.find((e) => e.id === tab) ?? sorted[0]

  const rows = useMemo(() => sorted.map((ext) => ({ ext, st: statusOf(ext.id), conn: connOf(statusOf(ext.id)) })), [sorted, statusOf])
  const onlineCount = rows.filter((r) => r.conn === 'online').length
  const idleCount = rows.filter((r) => r.conn === 'idle').length
  const offCount = rows.filter((r) => r.conn === 'off').length
  const allLive = rows.length > 0 && rows.every((r) => r.conn === 'online')
  const onlineIds = useMemo(() => new Set(rows.filter((r) => r.conn === 'online').map((r) => r.ext.id)), [rows])

  const [origin, setOrigin] = useState(hubUrl)
  useEffect(() => {
    if (!hubUrl) setOrigin(window.location.origin)
  }, [hubUrl])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  // Seleção só com chaves que ainda existem na lista (após excluir/atualizar)
  useEffect(() => {
    setSelected((cur) => {
      const ids = new Set(keys.map((k) => k.id))
      const next = new Set(Array.from(cur).filter((id) => ids.has(id)))
      return next.size === cur.size ? cur : next
    })
  }, [keys])

  /** "Sincronizar" (header) nesta tela: consulta agora se TODAS as extensões seguem conectadas. */
  const checkConnection = useCallback(async () => {
    setSync({ kind: 'busy', text: 'Consultando todas as extensões cadastradas…' })
    const inBrowser = document.documentElement.dataset.orviaIfood ?? null
    const res = await checkExtensionsAction(ws)
    router.refresh() // relê chaves, instalações e relatório (renova os links dos prints)
    if (!res.ok) return setSync({ kind: 'err', text: res.error })
    setLive(new Map(res.installs.map((s) => [s.extension_id, s])))
    const parts = res.installs.map((s) => `${extName.get(s.extension_id) ?? 'Extensão'}: ${connText(s, extSlug.get(s.extension_id))}`)
    if (!parts.length) parts.push('Nenhuma extensão cadastrada no servidor ainda.')
    parts.push(inBrowser ? `Neste navegador: extensão instalada (v${inBrowser}).` : 'Neste navegador: extensão não detectada.')
    const anyOff = res.installs.some((s) => connOf(s) === 'off') || !res.installs.length
    setSync({ kind: anyOff ? 'err' : 'done', text: parts.join(' · '), at: res.checked_at })
  }, [ws, router, extName, extSlug])

  useEffect(() => {
    const onSync = (event: Event) => {
      event.preventDefault() // avisa o header que esta tela tratou a sincronização
      void checkConnection()
    }
    window.addEventListener(SYNC_EVENT, onSync)
    return () => window.removeEventListener(SYNC_EVENT, onSync)
  }, [checkConnection])

  /**
   * Sincronização automática: consulta o servidor em segundo plano (sem router.refresh,
   * para não recarregar a tela) a cada 45 s, ao voltar o foco e ao reabrir a aba.
   * Assim o status reflete o contato real das extensões mesmo sem clicar em "Sincronizar".
   */
  const silentCheck = useCallback(async () => {
    if (autoRef.current) return
    autoRef.current = true
    setAutoBusy(true)
    try {
      const res = await checkExtensionsAction(ws)
      if (res.ok) {
        setLive(new Map(res.installs.map((s) => [s.extension_id, s])))
        setAutoAt(res.checked_at)
      }
    } finally {
      autoRef.current = false
      setAutoBusy(false)
    }
  }, [ws])

  useEffect(() => {
    void silentCheck()
    const timer = setInterval(() => void silentCheck(), 45_000)
    const onFocus = () => void silentCheck()
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void silentCheck()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [silentCheck])

  // Re-renderiza a cada 10 s para os textos "há Xs" não congelarem entre consultas.
  const [, setClock] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setClock((n) => n + 1), 10_000)
    return () => clearInterval(timer)
  }, [])

  const allSelected = keys.length > 0 && selected.size === keys.length
  const toggle = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const selectedKeys = keys.filter((k) => selected.has(k.id))
  const selectedActive = selectedKeys.filter((k) => !k.revoked_at)

  const runBulk = async () => {
    if (!bulk) return
    setBulkBusy(true)
    const res = bulk.action === 'delete' ? await deleteApiKeysAction(ws, bulk.ids) : await revokeApiKeysAction(ws, bulk.ids)
    setBulkBusy(false)
    setBulk(null)
    if (res.ok) {
      setSelected(new Set())
      setToast(`${res.count} chave${res.count === 1 ? '' : 's'} ${bulk.action === 'delete' ? 'excluída' : 'revogada'}${res.count === 1 ? '' : 's'}.`)
    } else setToast(res.error)
    router.refresh()
  }

  const showReport = reports.length > 0 || installs.length > 0
  const activeKeys = keys.filter((k) => !k.revoked_at && !(k.expires_at && new Date(k.expires_at).getTime() < Date.now())).length
  const hubAddress = origin && extensionCompatible(origin) ? origin : brand.extensionHubUrl
  const nav = [
    { id: 'sec-conexoes', label: 'Conexões' },
    { id: 'sec-hub', label: 'Hub' },
    ...(showReport ? [{ id: 'sec-relatorio', label: 'Relatório' }] : []),
    { id: 'sec-pesquisa', label: 'Pesquisa' },
    { id: 'sec-manual', label: 'Manual' },
    { id: 'sec-chaves', label: 'Chaves' },
    { id: 'sec-integracoes', label: 'Integrações' },
  ]

  return (
    <div className="relative mx-auto w-full max-w-[1400px] px-4 pb-12 pt-5 sm:px-6 md:px-[30px] md:pt-[26px]">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-64 bg-[radial-gradient(ellipse_at_top,rgba(215,20,31,0.10),transparent_62%)]" aria-hidden="true" />

      <section
        aria-labelledby="ext-page-title"
        className="relative overflow-hidden rounded-3xl border border-white/[0.08] bg-gradient-to-b from-white/[0.05] to-white/[0.012] p-4 sm:p-5 md:p-6"
      >
        <div className="uc-telemetry-bar absolute inset-x-0 top-0" aria-hidden="true" />
        <div className="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full bg-[#D7141F]/15 blur-3xl" aria-hidden="true" />

        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#D7141F]/35 bg-[#D7141F]/10 px-2.5 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-[#FFD9DB]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#F0333D] shadow-[0_0_8px_rgba(240,51,61,0.9)]" /> Chrome · MV3
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-[#8E8A86]">
                {workspaceName}
              </span>
            </div>
            <h1 id="ext-page-title" className="uc-title mt-3 text-[34px] text-[#F7F5F1] md:text-[44px]">Extensões</h1>
            <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-[#8E8A86]">
              Conecte as extensões do Chrome ao Undercut com chaves de acesso por escopo. O status é conferido automaticamente enquanto esta tela estiver aberta.
            </p>
          </div>

          <div className="flex flex-col items-start gap-2 sm:items-end">
            <LivePill allLive={allLive} online={onlineCount} total={rows.length} />
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-white/[0.08] bg-black/25 px-3 font-mono text-[10px] uppercase tracking-[0.12em] text-[#85817C]"
                suppressHydrationWarning
              >
                <RefreshCw size={12} className={cn(autoBusy && 'animate-spin text-[#F0333D]')} />
                {autoBusy ? 'verificando…' : autoAt ? `atualizado ${ago(autoAt)}` : 'aguardando'}
              </span>
              {canManage && (
                <Link
                  href={`/a/${ws}/configuracoes`}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] px-3 text-[12px] font-semibold text-[#DAD6CF] no-underline transition-colors hover:border-[#D7141F]/45 hover:text-white hover:no-underline"
                >
                  <ShieldCheck size={14} /> Configurações
                </Link>
              )}
            </div>
          </div>
        </div>

        <div className="relative mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Conectadas agora" value={`${onlineCount}/${rows.length}`} tone={onlineCount > 0 ? 'ok' : 'muted'} icon={<Zap size={14} />} />
          <Metric label="Sem contato recente" value={String(idleCount)} tone={idleCount > 0 ? 'warn' : 'muted'} icon={<Activity size={14} />} />
          <Metric label="Desconectadas" value={String(offCount)} tone={offCount > 0 ? 'bad' : 'muted'} icon={<WifiOff size={14} />} />
          <Metric label="Chaves ativas" value={canManage ? String(activeKeys) : '—'} tone={canManage && activeKeys ? 'ok' : 'muted'} icon={<KeyRound size={14} />} />
        </div>

        {shortUrl && (
          <div className="relative mt-3 flex flex-wrap items-center gap-2 rounded-2xl border border-white/[0.07] bg-black/25 px-3 py-2">
            <span className="inline-flex items-center gap-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-[#85817C]">
              <Link2 size={12} /> Link curto
            </span>
            <a href={shortUrl} className="min-w-0 flex-1 truncate font-mono text-[11px] text-[#B8B3AC] no-underline hover:text-white hover:no-underline" title={shortUrl}>
              {shortUrl.replace(/^https?:\/\//, '')}
            </a>
            <CopyBtn value={shortUrl} label="Copiar link" />
          </div>
        )}
      </section>

      <nav
        aria-label="Seções desta página"
        className="sticky top-0 z-20 -mx-4 mt-4 border-y border-white/[0.06] bg-[#080809]/90 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6 md:-mx-[30px] md:px-[30px]"
      >
        <div className="flex items-center gap-1 overflow-x-auto">
          {nav.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              className="shrink-0 rounded-full border border-transparent px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-[#8E8A86] no-underline transition-colors hover:border-white/10 hover:bg-white/[0.04] hover:text-white hover:no-underline"
            >
              {item.label}
            </a>
          ))}
          <span className="ml-auto hidden shrink-0 items-center gap-1.5 pl-3 font-mono text-[9px] uppercase tracking-[0.12em] text-[#55555C] sm:flex">
            <StatusDot conn={rows.length === 0 ? null : allLive ? 'online' : offCount === rows.length ? 'off' : 'idle'} />
            {onlineCount}/{rows.length} online · sync auto 45 s
          </span>
        </div>
      </nav>

      {sync.kind !== 'idle' && (
        <div
          role="status"
          className={cn(
            'mt-4 flex items-start gap-2 rounded-2xl border px-4 py-3 text-[12px] leading-relaxed',
            sync.kind === 'busy' && 'border-[#D7141F]/40 bg-[#D7141F]/10 text-[#FFD9DB]',
            sync.kind === 'done' && 'border-[#34D399]/40 bg-[#34D399]/10 text-[#A7F3D0]',
            sync.kind === 'err' && 'border-[#FBBF24]/40 bg-[#FBBF24]/10 text-[#FDE68A]',
          )}
        >
          <RefreshCw size={14} className={cn('mt-0.5 shrink-0', sync.kind === 'busy' && 'animate-spin')} />
          <span className="min-w-0 flex-1">
            {sync.text}
            {sync.at && <span className="ml-1 opacity-70">(verificado {when(sync.at)})</span>}
          </span>
        </div>
      )}

      <ConnectionsOverview
        rows={rows}
        online={onlineCount}
        idle={idleCount}
        off={offCount}
        activeKeys={canManage ? activeKeys : null}
        allLive={allLive}
        checkedAt={sync.at ?? autoAt}
        onManage={(id) => {
          setTab(id)
          document.getElementById('ext-conn-title')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }}
      />

      <ConnectionPanel
        ws={ws}
        extensions={sorted}
        status={status}
        canManage={canManage}
        highlight={highlightPair}
        hubAddress={hubAddress}
        workspaceName={workspaceName}
        tab={tab}
        onTab={setTab}
        onDone={refresh}
      />

      <ExtensionHub ws={ws} extensions={extensions} onlineIds={onlineIds} canManage={canManage} onToast={setToast} />

      {showReport && <ExtensionReport reports={reports} unavailable={reportsUnavailable} />}

      <ResearchPanel ws={ws} hubUrl={origin || brand.baseUrl} />

      <ManualSetup hubAddress={hubAddress} />

      {/* Chaves */}
      <section id="sec-chaves" className="mt-6 scroll-mt-24 rounded-3xl border border-white/[0.08] bg-[#0C0C0E] p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-[16px] font-bold text-[#F7F5F1]">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-[#D7141F]/30 bg-[#D7141F]/10 text-[#F0333D]">
                <KeyRound size={16} />
              </span>
              Chaves de API
            </h2>
            <p className="mt-1 text-[12px] text-[#85817C]">Escopos mínimos, hash no banco e revogação imediata. O valor completo aparece uma única vez.</p>
          </div>
          {canManage && (
            <Btn variant="primary" onClick={() => setCreating(true)}>
              <Plus size={14} /> Gerar chave
            </Btn>
          )}
        </div>
        {!canManage ? (
          <div className="mt-4">
            <Empty title="Somente dono ou coordenador gerenciam chaves">Peça a um responsável do workspace para gerar a chave da extensão.</Empty>
          </div>
        ) : keys.length === 0 ? (
          <div className="mt-4">
            <Empty title="Nenhuma chave criada">Gere um código de conexão no painel acima ou uma chave manual aqui.</Empty>
          </div>
        ) : (
          <>
            {selected.size > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-2 rounded-2xl border border-[#D7141F]/40 bg-[#1F0D0F] px-3 py-2 text-[12px] text-[#FFD9DB]">
                <span className="font-semibold">
                  {selected.size} selecionada{selected.size === 1 ? '' : 's'}
                </span>
                <span className="flex-1" />
                <Btn size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                  Limpar seleção
                </Btn>
                <Btn size="sm" disabled={selectedActive.length === 0} onClick={() => setBulk({ action: 'revoke', ids: selectedActive.map((k) => k.id) })}>
                  Revogar {selectedActive.length > 0 ? `(${selectedActive.length})` : ''}
                </Btn>
                {canDelete ? (
                  <Btn size="sm" variant="danger" onClick={() => setBulk({ action: 'delete', ids: Array.from(selected) })}>
                    <Trash2 size={13} /> Excluir ({selected.size})
                  </Btn>
                ) : (
                  <span className="text-[11px] text-[#8E8A86]">Excluir: somente o dono</span>
                )}
              </div>
            )}
            <div className="mt-4 overflow-x-auto rounded-2xl border border-white/[0.07]">
              <table className="w-full min-w-[860px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-white/[0.06] bg-black/30 text-[10px] font-bold font-mono uppercase tracking-[0.1em] text-[#8E8A86]">
                    <th className="w-10 px-3 py-2.5">
                      <input
                        type="checkbox"
                        aria-label="Selecionar todas as chaves"
                        checked={allSelected}
                        ref={(el) => {
                          if (el) el.indeterminate = selected.size > 0 && !allSelected
                        }}
                        onChange={() => setSelected(allSelected ? new Set() : new Set(keys.map((k) => k.id)))}
                        className="accent-[#D7141F]"
                      />
                    </th>
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
                    const isSel = selected.has(k.id)
                    return (
                      <tr key={k.id} className={cn('border-b border-white/[0.05] text-[12px] last:border-b-0', isSel ? 'bg-[#1F0D0F]' : 'bg-transparent')}>
                        <td className="px-3 py-2.5">
                          <input type="checkbox" aria-label={`Selecionar ${k.name}`} checked={isSel} onChange={() => toggle(k.id)} className="accent-[#D7141F]" />
                        </td>
                        <td className="px-3 py-2.5 font-semibold text-[#ECE9E3]">{k.name}</td>
                        <td className="px-3 py-2.5 font-mono text-[#B8B3AC]">{k.key_prefix}…</td>
                        <td className="px-3 py-2.5 text-[#B8B3AC]">{k.extension_id ? extName.get(k.extension_id) ?? '—' : '—'}</td>
                        <td className="px-3 py-2.5">
                          <span className="flex flex-wrap gap-1">
                            {k.scopes.map((s) => (
                              <span key={s} className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-px font-mono text-[10px] text-[#B8B3AC]">
                                {s}
                              </span>
                            ))}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-[#8E8A86]">{when(k.last_used_at)}</td>
                        <td className="px-3 py-2.5">
                          {k.revoked_at ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-[#FF6A3D]/12 px-2 py-0.5 text-[11px] text-[#FFB199]">Revogada</span>
                          ) : expired ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-[#FBBF24]/12 px-2 py-0.5 text-[11px] text-[#FDE68A]">Expirada</span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-[#34D399]/12 px-2 py-0.5 text-[11px] text-[#6EE7B7]">
                              Ativa{k.expires_at ? ` até ${when(k.expires_at)}` : ''}
                            </span>
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
            <p className="mt-2 text-[11px] text-[#85817C]">
              Por segurança o Undercut guarda só o hash das chaves: o valor completo só pode ser copiado no momento em que a chave é gerada.
            </p>
          </>
        )}
      </section>

      <IntegrationsSection
        ws={ws}
        partners={PARTNERS}
        integrations={rows.map((r) => ({ slug: r.ext.slug, id: r.ext.id, connected: r.conn === 'online' }))}
        canManage={canManage}
        onToast={setToast}
      />

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
          <p className="text-[13px] text-[#CFCBC4]">
            Revogar <b>{revoking.name}</b> ({revoking.key_prefix}…)? A extensão que usa essa chave para de funcionar imediatamente.
          </p>
          <div className="mt-5 flex justify-end gap-2 border-t border-[#1C1C1F] pt-4">
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
      {bulk && (
        <Modal title={bulk.action === 'delete' ? 'Excluir chaves' : 'Revogar chaves'} onClose={() => !bulkBusy && setBulk(null)}>
          <p className="text-[13px] text-[#CFCBC4]">
            {bulk.action === 'delete' ? 'Excluir' : 'Revogar'} <b>{bulk.ids.length}</b> chave{bulk.ids.length === 1 ? '' : 's'}?{' '}
            {bulk.action === 'delete'
              ? 'Elas somem da lista e param de funcionar na hora. Extensões que usam essas chaves ficam desconectadas. Não dá para desfazer.'
              : 'As extensões que usam essas chaves param de funcionar imediatamente.'}
          </p>
          <ul className="mt-3 max-h-40 space-y-0.5 overflow-y-auto rounded-xl border border-[#1C1C1F] bg-[#0B0B0C] px-3 py-2 text-[12px] text-[#B8B3AC]">
            {keys
              .filter((k) => bulk.ids.includes(k.id))
              .map((k) => (
                <li key={k.id}>
                  {k.name} <span className="font-mono text-[#85817C]">({k.key_prefix}…)</span>
                </li>
              ))}
          </ul>
          <div className="mt-5 flex justify-end gap-2 border-t border-[#1C1C1F] pt-4">
            <Btn variant="ghost" disabled={bulkBusy} onClick={() => setBulk(null)}>
              Cancelar
            </Btn>
            <Btn variant="danger" disabled={bulkBusy} onClick={runBulk}>
              {bulkBusy ? 'Aguarde…' : bulk.action === 'delete' ? 'Excluir' : 'Revogar'}
            </Btn>
          </div>
        </Modal>
      )}
      <Toast message={toast} />
    </div>
  )
}

function LivePill({ allLive, online, total }: { allLive: boolean; online: number; total: number }) {
  if (total === 0) {
    return (
      <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-[#8E8A86]">
        <span className="h-1.5 w-1.5 rounded-full bg-[#55555C]" /> sem extensões
      </span>
    )
  }
  if (allLive) {
    return (
      <span className="inline-flex items-center gap-2 rounded-full border border-[#34D399]/40 bg-[#34D399]/10 px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-[#A7F3D0]">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#34D399] opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-[#34D399] shadow-[0_0_8px_rgba(52,211,153,.9)]" />
        </span>
        Ao vivo · há instantes
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-[#FBBF24]/40 bg-[#FBBF24]/10 px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-[#FDE68A]">
      <span className="h-1.5 w-1.5 rounded-full bg-[#FBBF24]" /> {online}/{total} conectadas
    </span>
  )
}

function StatusDot({ conn }: { conn: Conn | null }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-block h-2.5 w-2.5 rounded-full',
        conn === 'online' && 'bg-[#34D399] shadow-[0_0_10px_rgba(52,211,153,0.8)]',
        conn === 'idle' && 'bg-[#FBBF24] shadow-[0_0_10px_rgba(251,191,36,0.6)]',
        conn === 'off' && 'bg-[#FF6A3D] shadow-[0_0_10px_rgba(255,106,61,0.6)]',
        conn === null && 'bg-[#55555C]',
      )}
    />
  )
}

function ConnectionsOverview({
  rows,
  online,
  idle,
  off,
  activeKeys,
  allLive,
  checkedAt,
  onManage,
}: {
  rows: { ext: Extension; st: ExtensionLiveStatus; conn: Conn }[]
  online: number
  idle: number
  off: number
  activeKeys: number | null
  allLive: boolean
  checkedAt: string | null
  onManage: (id: string) => void
}) {
  return (
    <section id="sec-conexoes" className="mt-5 scroll-mt-24 overflow-hidden rounded-3xl border border-white/[0.08] bg-[#0C0C0E] p-4 sm:p-5" aria-labelledby="ext-overview-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="ext-overview-title" className="flex items-center gap-2 text-[16px] font-bold text-[#F7F5F1]">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-[#34D399]/25 bg-[#34D399]/10 text-[#6EE7B7]">
              <Radio size={16} />
            </span>
            Visão geral das conexões
          </h2>
          <p className="mt-1 text-[12px] text-[#8E8A86]">
            {allLive
              ? 'Todas as extensões cadastradas estão enviando contato agora.'
              : 'O selo “Ao vivo” só aparece quando todas as extensões cadastradas estão conectadas.'}
          </p>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#55555C]" suppressHydrationWarning>
          {checkedAt ? `verificado ${when(checkedAt)}` : 'último contato de cada extensão'}
        </span>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Conectadas agora" value={`${online}/${rows.length}`} tone={online > 0 ? 'ok' : 'muted'} icon={<Zap size={14} />} />
        <Metric label="Sem contato recente" value={String(idle)} tone={idle > 0 ? 'warn' : 'muted'} icon={<Activity size={14} />} />
        <Metric label="Desconectadas" value={String(off)} tone={off > 0 ? 'bad' : 'muted'} icon={<WifiOff size={14} />} />
        <Metric label="Chaves ativas" value={activeKeys === null ? '—' : String(activeKeys)} tone={activeKeys ? 'ok' : 'muted'} icon={<KeyRound size={14} />} />
      </div>

      {rows.length === 0 ? (
        <div className="mt-3 rounded-2xl border border-dashed border-white/10 bg-white/[0.015] px-4 py-6 text-center text-[12px] text-[#85817C]">
          Nenhuma extensão cadastrada no servidor. Use “Adicionar extensão” no hub abaixo (ADM) ou aplique a migration do catálogo.
        </div>
      ) : (
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map(({ ext, st, conn }) => (
            <button
              key={ext.id}
              type="button"
              onClick={() => onManage(ext.id)}
              className="group relative overflow-hidden rounded-2xl border border-white/[0.07] bg-gradient-to-b from-white/[0.04] to-white/[0.01] p-3.5 text-left transition-all hover:border-[#D7141F]/45 hover:shadow-[0_0_30px_-14px_rgba(215,20,31,0.65)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D7141F]"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-black/30 font-mono text-[11px] font-bold text-[#F0333D]">
                  {(SHORT[ext.slug] ?? ext.name).slice(0, 2).toUpperCase()}
                </span>
                <span className="flex items-center gap-1.5 rounded-full border border-white/10 bg-black/20 px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-[#9F9A94]">
                  <StatusDot conn={conn} />
                  {conn === 'online' ? 'online' : conn === 'idle' ? 'sem contato' : 'offline'}
                </span>
              </div>
              <p className="mt-2.5 text-[13px] font-bold text-[#F7F5F1]">{SHORT[ext.slug] ?? ext.name}</p>
              <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-[#8E8A86]" suppressHydrationWarning>
                {connText(st, ext.slug)}
              </p>
              <div className="mt-2.5 flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.12em] text-[#55555C]">
                <span>{st.version ? `v${st.version}` : 'sem versão'}</span>
                <span className="inline-flex items-center gap-1 text-[#F0333D] opacity-0 transition-opacity group-hover:opacity-100">
                  gerenciar <ArrowRight size={11} />
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

function Metric({ label, value, tone, icon }: { label: string; value: string; tone: 'ok' | 'warn' | 'bad' | 'muted'; icon: ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 rounded-2xl border border-white/[0.07] bg-white/[0.02] px-3 py-2.5">
      <span
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border',
          tone === 'ok' && 'border-[#34D399]/25 bg-[#34D399]/10 text-[#6EE7B7]',
          tone === 'warn' && 'border-[#FBBF24]/25 bg-[#FBBF24]/10 text-[#FDE68A]',
          tone === 'bad' && 'border-[#FF6A3D]/25 bg-[#FF6A3D]/10 text-[#FFB199]',
          tone === 'muted' && 'border-white/10 bg-white/[0.03] text-[#85817C]',
        )}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <p className="truncate font-mono text-[9px] uppercase tracking-[0.14em] text-[#85817C]">{label}</p>
        <p className="font-display text-[18px] leading-[1.15] text-[#F7F5F1]">{value}</p>
      </div>
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
  const [created, setCreated] = useState<{ key: string; prefix: string } | null>(null)
  const [copy, setCopy] = useState<'idle' | 'ok' | 'fail'>('idle')

  if (created) {
    // A chave NUNCA é exibida: só o prefixo + máscara, e um botão que copia o valor completo.
    return (
      <Modal title="Chave criada" description="Copie agora — por segurança ela não pode ser exibida nem copiada depois." onClose={onClose} width="max-w-lg">
        <div className="flex items-center gap-2 rounded-2xl border border-[#D7141F]/50 bg-[#1F0D0F] p-3">
          <EyeOff size={15} className="shrink-0 text-[#F0333D]" aria-hidden="true" />
          <span className="min-w-0 flex-1 select-none truncate font-mono text-[12px] text-[#FFD9DB]" aria-label="Chave oculta">
            {created.prefix}
            {'•'.repeat(24)}
          </span>
          <Btn
            size="sm"
            variant={copy === 'ok' ? 'secondary' : 'primary'}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(created.key)
                setCopy('ok')
              } catch {
                setCopy('fail')
              }
            }}
          >
            {copy === 'ok' ? <Check size={13} /> : <Copy size={13} />} {copy === 'ok' ? 'Copiada' : 'Copiar chave'}
          </Btn>
        </div>
        {copy === 'fail' && (
          <p className="mt-2 rounded-xl border border-[#FF6A3D]/40 bg-[#FF6A3D]/10 px-3 py-2 text-[12px] text-[#FFB199]">
            O navegador bloqueou a área de transferência. Clique de novo em “Copiar chave”; se continuar, revogue esta chave e gere outra.
          </p>
        )}
        <p className="mt-3 text-[12px] leading-relaxed text-[#8E8A86]">Cole nas opções da extensão (campo de senha). Não envie por chat/e-mail. Se perder, revogue e gere outra.</p>
        <div className="mt-5 flex justify-end border-t border-[#1C1C1F] pt-4">
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
    if (res.ok) setCreated({ key: res.key, prefix: res.prefix })
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
              <label key={s.value} className="flex cursor-pointer items-start gap-2 rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => setScopes((cur) => (on ? cur.filter((x) => x !== s.value) : [...cur, s.value]))}
                  className="mt-0.5 accent-[#D7141F]"
                />
                <span>
                  <span className="block text-[12px] font-semibold text-[#ECE9E3]">{s.label}</span>
                  <span className="block text-[11px] text-[#85817C]">{s.hint}</span>
                </span>
              </label>
            )
          })}
        </div>
      </div>
      {error && <p className="mt-3 rounded-xl border border-[#FF6A3D]/40 bg-[#FF6A3D]/10 px-3 py-2 text-[12px] text-[#FFB199]">{error}</p>}
      <div className="mt-5 flex justify-end gap-2 border-t border-[#1C1C1F] pt-4">
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
 * Painel de conexão — uma aba por extensão (iFood, Cardápio Web, Anota AI).
 * Mostra se a extensão está conectada a este workspace; se não estiver, gera um
 * CÓDIGO DE CONEXÃO (chave vinculada à extensão, escopos mínimos) para copiar e colar
 * nas opções da extensão, junto com o endereço do Undercut.
 */
function ConnectionPanel({
  ws,
  extensions,
  status,
  canManage,
  highlight,
  hubAddress,
  workspaceName,
  tab,
  onTab,
  onDone,
}: {
  ws: string
  extensions: Extension[]
  status: Map<string, ExtensionLiveStatus>
  canManage: boolean
  highlight: boolean
  hubAddress: string
  workspaceName: string
  tab: string
  onTab: (id: string) => void
  onDone: () => void
}) {
  const ext = extensions.find((e) => e.id === tab) ?? extensions[0]
  if (!ext) return null
  const s = status.get(ext.id) ?? MISSING(ext.id)
  const c = connOf(s)
  const short = SHORT[ext.slug] ?? ext.name

  return (
    <section
      aria-labelledby="ext-conn-title"
      className={cn(
        'mt-6 overflow-hidden rounded-3xl border bg-[#0C0C0E] p-4 transition-colors sm:p-5',
        highlight ? 'border-[#D7141F]/70 shadow-[0_0_0_3px_rgba(215,20,31,0.18),0_0_60px_-20px_rgba(215,20,31,0.6)]' : 'border-white/[0.08]',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="ext-conn-title" className="flex items-center gap-2 text-[16px] font-bold text-[#F7F5F1]">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-[#D7141F]/30 bg-[#D7141F]/10 text-[#F0333D]">
              <Plug size={16} />
            </span>
            Conexão das extensões
          </h2>
          <p className="mt-1 text-[12px] text-[#85817C]">Cada extensão tem um código próprio, vinculado ao workspace {workspaceName}.</p>
        </div>
        <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.14em] text-[#8E8A86]">
          {extensions.length} extensões
        </span>
      </div>

      <div role="tablist" aria-label="Extensão" className="mt-4 flex flex-wrap gap-1.5">
        {extensions.map((e) => {
          const st = status.get(e.id)
          const cc = st ? connOf(st) : null
          const active = ext.id === e.id
          return (
            <button
              key={e.id}
              type="button"
              role="tab"
              id={`ext-conn-tab-${e.slug}`}
              aria-selected={active}
              aria-controls="ext-conn-panel"
              onClick={() => onTab(e.id)}
              className={cn(
                'inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-[12px] font-semibold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D7141F]',
                active
                  ? 'border-[#D7141F]/60 bg-[#D7141F]/15 text-[#F7F5F1] shadow-[0_0_22px_-8px_rgba(215,20,31,0.8)]'
                  : 'border-white/[0.08] bg-white/[0.02] text-[#9F9A94] hover:border-white/20 hover:text-white',
              )}
            >
              <StatusDot conn={cc} />
              {SHORT[e.slug] ?? e.name}
            </button>
          )
        })}
      </div>

      <div role="tabpanel" id="ext-conn-panel" aria-labelledby={`ext-conn-tab-${ext.slug}`} className="pt-4">
        <p className="text-[12px] leading-relaxed text-[#8E8A86]">{ext.description}</p>
        <div
          className={cn(
            'mt-3 rounded-2xl border px-3.5 py-3 text-[13px] leading-relaxed',
            c === 'online' && 'border-[#34D399]/30 bg-[#34D399]/[0.07] text-[#A7F3D0]',
            c === 'idle' && 'border-[#FBBF24]/30 bg-[#FBBF24]/[0.07] text-[#FDE68A]',
            (c === 'off' || c === null) && 'border-[#FF6A3D]/30 bg-[#FF6A3D]/[0.07] text-[#FFB199]',
          )}
          suppressHydrationWarning
        >
          <span className="flex items-start gap-2">
            <StatusDot conn={c} />
            <span className="min-w-0 flex-1">
              {connText(s, ext.slug)}
              {(s.key_name || s.version) && (
                <span className="mt-0.5 block text-[11px] opacity-80">{[s.key_name && `Acesso: ${s.key_name}`, s.version && `v${s.version}`].filter(Boolean).join(' · ')}</span>
              )}
            </span>
          </span>
        </div>

        {!canManage ? (
          <p className="mt-3 text-[12px] text-[#8E8A86]">Somente dono ou suporte (coordenador) geram o código de conexão.</p>
        ) : (
          <>
            {ext.slug === 'orvia-ifood' && <OneClickPair ws={ws} onDone={onDone} />}
            <ConnectionCode
              key={ext.id}
              ws={ws}
              slug={ext.slug}
              label={short}
              workspaceName={workspaceName}
              connected={c === 'online' || c === 'idle'}
              hubAddress={hubAddress}
              onDone={onDone}
            />
          </>
        )}
      </div>
    </section>
  )
}

function CopyBtn({ value, label }: { value: string; label: string }) {
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle')
  return (
    <Btn
      size="sm"
      variant={state === 'ok' ? 'secondary' : 'primary'}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setState('ok')
        } catch {
          setState('fail')
        }
      }}
    >
      {state === 'ok' ? <Check size={13} /> : <Copy size={13} />} {state === 'ok' ? 'Copiado' : state === 'fail' ? 'Use Mostrar e copie à mão' : label}
    </Btn>
  )
}

/** Gera o código de conexão (o valor só existe nesta tela, uma vez) com botões de copiar. */
function ConnectionCode({
  ws,
  slug,
  label,
  workspaceName,
  connected,
  hubAddress,
  onDone,
}: {
  ws: string
  slug: string
  label: string
  workspaceName: string
  connected: boolean
  hubAddress: string
  onDone: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [code, setCode] = useState<{ key: string; prefix: string } | null>(null)
  const [show, setShow] = useState(false)
  const STEPS = ['Validando a sessão…', 'Gerando chave com hash seguro…', `Vinculando ao cardápio ${label}…`]

  const generate = async () => {
    setBusy(true)
    setStep(0)
    setError(null)
    setCode(null)
    const timer = setTimeout(() => setStep(1), 350)
    const timer2 = setTimeout(() => setStep(2), 900)
    const res = await pairExtensionAction(ws, slug)
    clearTimeout(timer)
    clearTimeout(timer2)
    setBusy(false)
    setStep(0)
    if (!res.ok) return setError(res.error)
    setCode({ key: res.key, prefix: res.prefix })
    onDone() // a nova chave aparece na lista abaixo
  }

  return (
    <div className="relative mt-4 overflow-hidden rounded-2xl border border-white/[0.09] bg-white/[0.03] p-3.5 backdrop-blur-sm">
      <div className="pointer-events-none absolute -right-10 -top-10 h-24 w-24 rounded-full bg-[#D7141F]/10 blur-2xl" aria-hidden="true" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-1.5 text-[13px] font-bold text-[#ECE9E3]">
            <KeyRound size={14} className="text-[#F0333D]" /> Código de conexão · {label}
          </h3>
          <p className="mt-0.5 max-w-xl text-[11px] leading-relaxed text-[#85817C]">
            {connected ? 'Já conectada. Gere um novo código só para conectar outro navegador ou computador.' : 'Cole este código (token) e o endereço do Undercut nas opções da extensão.'}
          </p>
        </div>
        {!code && !busy && (
          <Btn variant={connected ? 'secondary' : 'primary'} onClick={generate}>
            {connected ? 'Gerar novo código' : 'Gerar código de conexão'}
          </Btn>
        )}
        {busy && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#D7141F]/40 bg-[#D7141F]/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[#FFD9DB]">
            <Loader2 size={12} className="animate-spin" /> gerando
          </span>
        )}
      </div>

      {busy && (
        <div className="uc-fade-up mt-3 rounded-xl border border-[#D7141F]/30 bg-[#D7141F]/[0.06] p-3" aria-live="polite">
          <p className="flex items-center gap-2 text-[12px] text-[#FFD9DB]">
            <Loader2 size={14} className="animate-spin" /> {STEPS[step]}
          </p>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-gradient-to-r from-[#B5121B] to-[#F0333D] transition-all duration-500" style={{ width: `${Math.min(100, (step + 1) * 34)}%` }} />
          </div>
          <p className="mt-1.5 font-mono text-[9px] uppercase tracking-[0.14em] text-[#85817C]">cardápio selecionado: {label}</p>
        </div>
      )}

      {error && <p className="mt-3 rounded-xl border border-[#FF6A3D]/40 bg-[#FF6A3D]/10 px-3 py-2 text-[12px] text-[#FFB199]">{error}</p>}

      {code && (
        <div className="uc-fade-up mt-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#34D399]/25 bg-[#34D399]/[0.05] px-3 py-2 text-[11px] text-[#A7F3D0]">
            <Check size={13} /> Código gerado para <b>{label}</b> · workspace {workspaceName}
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#D7141F]/40 bg-[#1F0D0F]/80 p-2.5">
            <span className="w-full text-[10px] font-bold font-mono uppercase tracking-[0.1em] text-[#8E8A86] sm:w-auto">Código</span>
            <span className={cn('min-w-0 flex-1 break-all font-mono text-[12px] text-[#FFD9DB]', !show && 'select-none')}>
              {show ? code.key : `${code.prefix}${'•'.repeat(24)}`}
            </span>
            <Btn size="sm" variant="ghost" onClick={() => setShow((v) => !v)}>
              {show ? <EyeOff size={13} /> : <Eye size={13} />} {show ? 'Ocultar' : 'Mostrar'}
            </Btn>
            <CopyBtn value={code.key} label="Copiar código" />
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/[0.08] bg-black/25 p-2.5">
            <span className="w-full text-[10px] font-bold font-mono uppercase tracking-[0.1em] text-[#8E8A86] sm:w-auto">Endereço</span>
            <span className="min-w-0 flex-1 break-all font-mono text-[12px] text-[#CFCBC4]">{hubAddress}</span>
            <CopyBtn value={hubAddress} label="Copiar endereço" />
          </div>
          <ol className="list-decimal space-y-0.5 pl-5 text-[12px] leading-relaxed text-[#B8B3AC]">
            <li>Abra a extensão Undercut · {label} → Opções / Conexão.</li>
            <li>Cole o endereço e o código nos campos correspondentes → “Testar conexão” / “Salvar”.</li>
            <li>Volte aqui e clique em “Sincronizar” no topo: o status muda para Conectada.</li>
          </ol>
          <p className="text-[11px] text-[#85817C]">
            Por segurança este código só aparece agora (o Undercut guarda só o hash). Não envie por chat ou e-mail; se perder, gere outro e revogue o antigo na lista de chaves.
          </p>
        </div>
      )}
    </div>
  )
}

function ManualSetup({ hubAddress }: { hubAddress: string }) {
  return (
    <section id="sec-manual" className="mt-6 scroll-mt-24 rounded-3xl border border-white/[0.08] bg-[#0C0C0E] p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-[15px] font-bold text-[#F7F5F1]">
            <ShieldCheck size={16} className="text-[#34D399]" /> Conexão manual (outro navegador ou sem a ponte)
          </h2>
          <p className="mt-1 text-[12px] text-[#85817C]">Use quando a extensão não estiver neste navegador ou o “Conectar com um clique” não aparecer.</p>
        </div>
        <a
          href="/extensoes/undercut-ifood.zip"
          download
          className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] px-3 text-[12px] font-semibold text-[#DAD6CF] no-underline hover:border-[#D7141F]/45 hover:text-white hover:no-underline"
        >
          <Download size={14} /> Baixar extensão iFood
        </a>
      </div>
      <ol className="mt-3 grid list-decimal gap-2 pl-5 text-[13px] leading-relaxed text-[#B8B3AC] md:grid-cols-3 md:gap-4">
        <li>
          Gere um código de conexão no painel acima (escopos padrão já são os mínimos).
        </li>
        <li>
          No Chrome: <span className="font-mono text-[12px]">chrome://extensions</span> → Modo do desenvolvedor → Carregar sem compactação → pasta extraída do .zip.
        </li>
        <li>
          Abra as opções da extensão, cole o endereço do Undercut (<span className="font-mono text-[12px] break-all">{hubAddress}</span>) e a chave → “Testar conexão”.
        </li>
      </ol>
      <p className="mt-3 flex items-center gap-1.5 text-[11px] text-[#85817C]">
        <Package size={12} /> O pacote e as versões ficam no Hub de extensões acima. Instale somente arquivos publicados pelo ADM.
      </p>
    </section>
  )
}

/**
 * "Conectar com um clique" (só a extensão iFood tem a ponte): ela injeta uma ponte nesta página
 * (marca data-orvia-ifood no <html> e responde por window.postMessage, mesma origem).
 * O painel gera a chave no servidor e a entrega direto à extensão — ninguém vê/cola a chave.
 * Sem a ponte neste navegador, não aparece: vale o código de conexão.
 */
function OneClickPair({ ws, onDone }: { ws: string; onDone: () => void }) {
  const [version, setVersion] = useState<string | null>(null)
  const [state, setState] = useState<PairState>({ kind: 'idle' })
  const [conn, setConn] = useState<{ configured: boolean; workspace?: string } | null>(null)

  useEffect(() => {
    const read = () => setVersion(document.documentElement.dataset.orviaIfood ?? null)
    read()
    const timer = setTimeout(read, 1000)
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return
      const data = event.data as
        | { source?: string; type?: string; version?: string; ok?: boolean; error?: string; workspace?: string; data?: { configured: boolean; workspace?: { name: string } } }
        | null
      if (!data || data.source !== 'orvia-ext') return
      if (data.type === 'hello' && data.version) {
        setVersion(data.version)
        // Solicita o status da conexão (chave/endereço salvos no service worker).
        window.postMessage({ source: 'orvia-hub', type: 'status' }, window.location.origin)
      }
      if (data.type === 'status') {
        setConn(data.ok && data.data ? { configured: data.data.configured, workspace: data.data.workspace?.name } : null)
        return
      }
      if (data.type === 'paired') {
        if (data.ok) {
          setState({ kind: 'ok', text: `Extensão conectada${data.workspace ? ` ao workspace “${data.workspace}”` : ''}. Pode abrir o portal do iFood.` })
          setConn({ configured: true, workspace: data.workspace })
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

  if (!version) return null

  const connect = async () => {
    setState({ kind: 'busy', text: 'Gerando acesso e entregando à extensão…' })
    const res = await pairExtensionAction(ws, 'orvia-ifood')
    if (!res.ok) return setState({ kind: 'err', text: res.error })
    window.postMessage({ source: 'orvia-hub', type: 'pair', key: res.key, hubUrl: window.location.origin }, window.location.origin)
    setTimeout(
      () => setState((cur) => (cur.kind === 'busy' ? { kind: 'err', text: 'A extensão não respondeu. Recarregue esta página (F5) e tente de novo, ou use o código de conexão.' } : cur)),
      15000,
    )
  }

  return (
    <div className="mt-4 rounded-2xl border border-[#34D399]/25 bg-[#34D399]/[0.04] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-[#B8B3AC]">Extensão iFood detectada neste navegador (v{version}). Conecte com um clique, sem copiar código.</p>
        <Btn variant="primary" disabled={state.kind === 'busy'} onClick={connect}>
          {state.kind === 'busy' ? 'Conectando…' : state.kind === 'ok' ? 'Conectar de novo' : 'Conectar com um clique'}
        </Btn>
      </div>
      {state.text && (
        <p
          role="status"
          className={cn(
            'mt-2 rounded-xl px-3 py-2 text-[12px]',
            state.kind === 'ok' && 'bg-[#34D399]/10 text-[#6EE7B7]',
            state.kind === 'err' && 'bg-[#FF6A3D]/10 text-[#FFB199]',
            state.kind === 'busy' && 'bg-[#D7141F]/10 text-[#FFD9DB]',
          )}
        >
          {state.text}
        </p>
      )}
      {conn && (
        <p className="mt-2 text-[11px] leading-relaxed text-[#85817C]" suppressHydrationWarning>
          {conn.configured ? `Sincronização com o Undercut ativa${conn.workspace ? ` · workspace “${conn.workspace}”` : ''}.` : 'A extensão está pronta — falta conectar ao Undercut.'}
        </p>
      )}
    </div>
  )
}
