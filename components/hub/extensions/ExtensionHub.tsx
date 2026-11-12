'use client'

import { Fragment, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowUpRight, Download, Loader2, Package, Pencil, Plus, ShieldCheck, Sparkles } from 'lucide-react'
import { cn, FieldLabel, Modal, TextInput } from '@/components/hub/ui'
import { Btn, Textarea } from '@/components/hub/menu/shared'
import { EXTENSION_CATALOG, catalogOf } from '@/lib/extensions/catalog'
import { PARTNERS, partnerOf, type PartnerAccent } from '@/lib/extensions/partners'
import { saveExtensionAction } from '@/app/a/[ws]/extensoes/actions'

export type HubExtension = { id: string; slug: string; name: string; description: string | null; homepage_url?: string | null }

type Card = {
  slug: string
  name: string
  description: string
  version: string | null
  downloadUrl: string | null
  homepageUrl: string | null
  monogram: string
  registered: boolean
  connected: boolean
  upcoming: boolean
  id: string | null
  partner: string
  partnerName: string
  partnerShort: string
  partnerPrimary: string
  partnerPrimaryLight: string
  partnerDeep: string
  partnerInk: string
}

/**
 * Hub de extensões: catálogo com status, download do pacote .zip e instruções de
 * instalação. Owner/suporte (coordenador) cadastra ou edita extensões aqui — o
 * cartão novo aparece para todos os workspaces (catálogo global).
 */
export function ExtensionHub({
  ws,
  extensions,
  onlineIds,
  canManage,
  onToast,
}: {
  ws: string
  extensions: HubExtension[]
  onlineIds: Set<string>
  canManage: boolean
  onToast: (message: string) => void
}) {
  const router = useRouter()
  const [editing, setEditing] = useState<Card | null>(null)
  const [creating, setCreating] = useState(false)
  const [install, setInstall] = useState<Card | null>(null)
  const [partnerFilter, setPartnerFilter] = useState<string>('all')

  const cards = useMemo<Card[]>(() => {
    const db = new Map(extensions.map((e) => [e.slug, e]))
    const slugs = Array.from(new Set([...EXTENSION_CATALOG.map((e) => e.slug), ...extensions.map((e) => e.slug)]))
    return slugs
      .map((slug) => {
        const meta = catalogOf(slug)
        const row = db.get(slug)
        const partner = partnerOf(slug)
        return {
          slug,
          name: meta?.name ?? row?.name ?? slug,
          description: row?.description ?? meta?.description ?? '',
          version: meta?.version ?? null,
          downloadUrl: meta?.downloadUrl ?? null,
          homepageUrl: row?.homepage_url ?? meta?.homepageUrl ?? null,
          monogram: meta?.monogram ?? slug.slice(0, 2).toUpperCase(),
          registered: Boolean(row),
          connected: row ? onlineIds.has(row.id) : false,
          upcoming: Boolean(meta?.upcoming) || (!meta && !row),
          id: row?.id ?? null,
          partner: partner ? partner.slug : 'undercut',
          partnerName: partner?.name ?? 'Undercut',
          partnerShort: partner?.short ?? 'Undercut',
          partnerPrimary: partner?.primary ?? '#D7141F',
          partnerPrimaryLight: partner?.primaryLight ?? '#F0333D',
          partnerDeep: partner?.deep ?? '#7A0E13',
          partnerInk: partner?.ink ?? '#0B0B0C',
        }
      })
      .filter((card) => partnerFilter === 'all' || card.partner === partnerFilter)
  }, [extensions, onlineIds, partnerFilter])

  const groups = useMemo(() => {
    const map = new Map<string, Card[]>()
    for (const card of cards) {
      const key = card.partner
      const list = map.get(key) ?? []
      list.push(card)
      map.set(key, list)
    }
    const order = (slug: string) => {
      const idx = PARTNERS.findIndex((p) => p.slug === slug)
      return idx === -1 ? PARTNERS.length + 1 : idx
    }
    const sorted = Array.from(map.entries()).sort((a, b) => {
      if (a[0] === 'undercut') return -1
      if (b[0] === 'undercut') return 1
      return order(a[0]) - order(b[0])
    })
    return sorted.map(([slug, groupCards]) => ({ slug, cards: groupCards }))
  }, [cards])

  const partnerOptions = useMemo(() => {
    const seen = new Set<string>(['undercut'])
    for (const card of cards) seen.add(card.partner)
    for (const p of PARTNERS) seen.add(p.slug)
    return Array.from(seen).map((slug) => ({
      slug,
      label: slug === 'undercut' ? 'Undercut' : (PARTNERS.find((p) => p.slug === slug)?.short ?? slug),
    }))
  }, [cards])

  return (
    <section id="sec-hub" className="mt-6 scroll-mt-24 overflow-hidden rounded-3xl border border-white/[0.08] bg-[#0C0C0E] p-4 sm:p-5" aria-labelledby="ext-hub-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="ext-hub-title" className="flex items-center gap-2 text-[16px] font-bold text-[#F7F5F1]">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-[#D7141F]/30 bg-[#D7141F]/10 text-[#F0333D]">
              <Package size={16} />
            </span>
            Hub de extensões
          </h2>
          <p className="mt-1 text-[12px] text-[#8E8A86]">Baixe, instale e conecte as extensões Chrome do Undercut. Cada uma usa uma chave com escopos mínimos.</p>
        </div>
        {canManage && (
          <Btn variant="primary" onClick={() => setCreating(true)}>
            <Plus size={14} /> Adicionar extensão
          </Btn>
        )}
      </div>

        {partnerFilter !== 'all' && (
          <div className="mb-4 flex flex-wrap items-center gap-1.5">
            {partnerOptions.map((p) => (
              <button
                key={p.slug}
                type="button"
                onClick={() => setPartnerFilter(p.slug)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D7141F]',
                  partnerFilter === p.slug ? 'border-[#D7141F]/60 bg-[#D7141F]/15 text-[#F7F5F1]' : 'border-white/[0.08] bg-white/[0.02] text-[#9F9A94] hover:border-white/20 hover:text-white',
                )}
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={partnerFilter === p.slug ? { backgroundColor: p.slug === 'undercut' ? '#D7141F' : '#5FA759', boxShadow: `0 0 8px ${p.slug === 'undercut' ? 'rgba(215,20,31,0.8)' : 'rgba(95,167,89,0.8)'}` } : { backgroundColor: p.slug === 'undercut' ? '#D7141F' : '#5FA759', boxShadow: `0 0 8px ${p.slug === 'undercut' ? 'rgba(215,20,31,0.5)' : 'rgba(95,167,89,0.5)'}` }}
                />
                {p.label}
              </button>
            ))}
          </div>
        )}

        {groups.map((group) => {
          const accent: PartnerAccent = group.slug === 'undercut' ? { primary: '#D7141F', primaryLight: '#F0333D', deep: '#7A0E13', ink: '#0B0B0C' } : (partnerOf(group.slug) ?? partnerOf('undercut'))
          const isPartner = group.slug !== 'undercut'
          const partnerName = group.slug === 'undercut' ? 'Undercut' : PARTNERS.find((p) => p.slug === group.slug)?.name ?? 'Parceiro'
          return (
            <Fragment key={group.slug}>
              <div className={cn('mb-8', !isPartner && 'mt-0')}>
              {isPartner && (
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span
                    className="inline-flex items-center rounded-full border px-2.5 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.18em]"
                    style={{ borderColor: `${accent.primary}55`, backgroundColor: `${accent.primary}14`, color: accent.primaryLight }}
                  >
                    <span className="mr-1.5 h-1.5 w-1.5 rounded-full" style={{ backgroundColor: accent.primaryLight, boxShadow: `0 0 8px ${accent.primaryLight}` }} />
                    Parceiro · {partnerName}
                  </span>
                  <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-[#55555C]">{group.cards.length} extensão{group.cards.length === 1 ? '' : 'ões'} do parceiro</span>
                </div>
              )}
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {group.cards.map((card) => (
                  <article
                    key={card.slug}
                    className={cn(
                      'group relative overflow-hidden rounded-2xl border bg-gradient-to-b from-white/[0.045] to-white/[0.01] p-4 transition-colors',
                      'hover:border-[#D7141F]/45 hover:bg-white/[0.02]',
                    )}
                    style={isPartner ? { borderColor: `${card.partnerPrimary}26` } : undefined}
                  >
                    <div className="pointer-events-none absolute -right-12 -top-12 h-28 w-28 rounded-full blur-2xl" style={{ backgroundColor: `${card.partnerPrimary}14` }} aria-hidden="true" />
                    <div className="flex items-start justify-between gap-2">
                      <span
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border font-mono text-[12px] font-bold tracking-wide"
                        style={{ borderColor: `${card.partnerPrimary}40`, backgroundColor: `${card.partnerPrimary}14`, color: card.partnerPrimaryLight }}
                      >
                        {card.monogram}
                      </span>
                      <span
                        className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.14em]"
                        style={
                          card.connected
                            ? { borderColor: `${card.partnerPrimary}55`, backgroundColor: `${card.partnerPrimary}12`, color: card.partnerPrimaryLight }
                            : card.registered
                              ? { borderColor: 'rgba(251,191,36,0.4)', backgroundColor: 'rgba(251,191,36,0.1)', color: '#FDE68A' }
                              : { borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.03)', color: '#8E8A86' }
                        }
                      >
                        <span
                          className="h-1.5 w-1.5 rounded-full"
                          style={card.connected ? { backgroundColor: card.partnerPrimary, boxShadow: `0 0 8px ${card.partnerPrimary}` } : card.registered ? { backgroundColor: '#FBBF24' } : { backgroundColor: '#55555C' }}
                        />
                        {card.connected ? 'conectada' : card.registered ? 'instalada' : 'não instalada'}
                      </span>
                    </div>
                    <h3 className="mt-3 text-[14px] font-bold text-[#F7F5F1]">{card.name}</h3>
                    <p className="mt-1 line-clamp-3 min-h-[48px] text-[12px] leading-relaxed text-[#9F9A94]">{card.description || 'Extensão do catálogo Undercut.'}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      {card.version && (
                        <span className="rounded-full border border-white/10 bg-black/30 px-2 py-0.5 font-mono text-[10px] text-[#B8B3AC]">v{card.version}</span>
                      )}
                      {card.upcoming && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-[#FBBF24]/30 bg-[#FBBF24]/10 px-2 py-0.5 font-mono text-[10px] text-[#FDE68A]">
                          <Sparkles size={10} /> em breve
                        </span>
                      )}
                      {isPartner && card.registered && !card.connected && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 font-mono text-[10px] text-[#8E8A86]">
                          aguardando integração
                        </span>
                      )}
                    </div>
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      {card.downloadUrl ? (
                        <a
                          href={card.downloadUrl}
                          download
                          className="inline-flex h-8 items-center gap-1.5 rounded-xl px-3 text-[12px] font-semibold text-white transition-colors hover:opacity-90"
                          style={{ backgroundColor: card.partnerPrimary }}
                        >
                          <Download size={14} /> Baixar .zip
                        </a>
                      ) : (
                        <span className="inline-flex h-8 cursor-not-allowed items-center gap-1.5 rounded-xl border border-white/10 px-3 text-[12px] font-semibold text-[#55555C]">
                          <Download size={14} /> {card.upcoming ? 'Em breve' : 'Sem pacote'}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => setInstall(card)}
                        className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] px-3 text-[12px] font-semibold text-[#DAD6CF] transition-colors hover:border-white/20 hover:text-white"
                      >
                        <ShieldCheck size={14} /> Como instalar
                      </button>
                      {card.homepageUrl && (
                        <a
                          href={card.homepageUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex h-8 items-center gap-1 rounded-xl px-2 text-[12px] font-semibold text-[#8E8A86] hover:text-white"
                        >
                          Site <ArrowUpRight size={13} />
                        </a>
                      )}
                      {canManage && card.registered && (
                        <button
                          type="button"
                          onClick={() => setEditing(card)}
                          className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-xl text-[#85817C] transition-colors hover:bg-white/[0.05] hover:text-white"
                          aria-label={`Editar ${card.name}`}
                          title="Editar extensão"
                        >
                          <Pencil size={14} />
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
              </div>
            </Fragment>
          )
        })}

      {(creating || editing) && (
        <ExtensionModal
          ws={ws}
          card={editing}
          onClose={() => {
            setCreating(false)
            setEditing(null)
          }}
          onSaved={(message) => {
            setCreating(false)
            setEditing(null)
            onToast(message)
            router.refresh()
          }}
        />
      )}

      {install && <InstallModal card={install} onClose={() => setInstall(null)} />}
    </section>
  )
}

function ExtensionModal({ ws, card, onClose, onSaved }: { ws: string; card: Card | null; onClose: () => void; onSaved: (message: string) => void }) {
  const [name, setName] = useState(card?.name ?? '')
  const [slug, setSlug] = useState(card?.slug ?? '')
  const [description, setDescription] = useState(card?.description ?? '')
  const [homepage, setHomepage] = useState(card?.homepageUrl ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setBusy(true)
    setError(null)
    const res = await saveExtensionAction(ws, {
      id: card?.id ?? null,
      slug: slug.trim() || name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 62),
      name,
      description,
      homepage_url: homepage,
    })
    setBusy(false)
    if (!res.ok) return setError(res.error)
    onSaved(card ? 'Extensão atualizada.' : 'Extensão adicionada ao catálogo.')
  }

  return (
    <Modal title={card ? 'Editar extensão' : 'Adicionar extensão'} description="Catálogo global — aparece para todos os workspaces." onClose={onClose} width="max-w-lg">
      <label className="block">
        <FieldLabel>Nome</FieldLabel>
        <TextInput value={name} onChange={setName} autoFocus placeholder="Ex.: Undercut · 99Food" />
      </label>
      <div className="mt-3">
        <FieldLabel>Slug (identificador)</FieldLabel>
        <TextInput value={slug} onChange={setSlug} placeholder="undercut-99food" />
      </div>
      <div className="mt-3">
        <FieldLabel>Descrição</FieldLabel>
        <Textarea value={description} onChange={setDescription} placeholder="O que a extensão faz em uma frase." rows={3} />
      </div>
      <div className="mt-3">
        <FieldLabel>Site / pacote (.zip)</FieldLabel>
        <TextInput value={homepage} onChange={setHomepage} placeholder="https://…/extensao.zip" />
        <p className="mt-1 text-[11px] text-[#85817C]">Para o botão “Baixar .zip” aparecer, coloque o pacote em public/extensoes/ e registre o caminho no catálogo.</p>
      </div>
      {error && <p className="mt-3 rounded-xl border border-[#FF6A3D]/40 bg-[#FF6A3D]/10 px-3 py-2 text-[12px] text-[#FFB199]">{error}</p>}
      <div className="mt-5 flex justify-end gap-2 border-t border-[#1C1C1F] pt-4">
        <Btn variant="ghost" onClick={onClose}>
          Cancelar
        </Btn>
        <Btn variant="primary" disabled={busy || name.trim().length < 2} onClick={submit}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : null} {busy ? 'Salvando…' : 'Salvar extensão'}
        </Btn>
      </div>
    </Modal>
  )
}

function InstallModal({ card, onClose }: { card: Card; onClose: () => void }) {
  return (
    <Modal title={`Instalar ${card.name}`} description="Chrome / Edge (MV3) — modo do desenvolvedor." onClose={onClose} width="max-w-lg">
      <ol className="list-decimal space-y-2 pl-5 text-[13px] leading-relaxed text-[#CFCBC4]">
        <li>
          {card.downloadUrl ? (
            <>
              Baixe o pacote{' '}
              <a href={card.downloadUrl} download className="font-semibold text-[#F0333D] underline decoration-[#F0333D]/50 underline-offset-2">
                {card.slug}.zip
              </a>{' '}
              e extraia em uma pasta.
            </>
          ) : (
            'A extensão ainda não tem pacote público. Fale com o suporte do Undercut.'
          )}
        </li>
        <li>
          Abra <span className="font-mono text-[12px] text-[#F7F5F1]">chrome://extensions</span> e ative o <b>Modo do desenvolvedor</b>.
        </li>
        <li>Clique em <b>Carregar sem compactação</b> e escolha a pasta extraída.</li>
        <li>Abra as opções da extensão e cole o endereço do Undercut + o código de conexão gerado nesta página.</li>
        <li>Volte aqui e clique em <b>Sincronizar</b> — o status muda para conectada.</li>
      </ol>
      <div className="mt-4 rounded-xl border border-[#34D399]/25 bg-[#34D399]/[0.06] px-3 py-2 text-[12px] text-[#A7F3D0]">
        Nunca instale .zip de origem desconhecida. Os pacotes do hub são publicados pelo ADM do Undercut.
      </div>
      <div className="mt-5 flex justify-end border-t border-[#1C1C1F] pt-4">
        <Btn variant="primary" onClick={onClose}>
          Entendi
        </Btn>
      </div>
    </Modal>
  )
}
