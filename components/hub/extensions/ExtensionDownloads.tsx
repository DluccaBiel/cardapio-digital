'use client'

import { useState } from 'react'
import { Check, ChevronDown, Copy, Download, Package, Sparkles } from 'lucide-react'
import { cn } from '../ui'
import { EXTENSION_CATALOG, availableExtensions, type ExtensionCatalogEntry } from '../../../lib/extensions/catalog'

export type ExtensionConn = 'online' | 'idle' | 'off'

/** Instalação: igual para todas as extensões (feita uma vez por extensão). */
const INSTALL_STEPS: { title: string; text: string }[] = [
  { title: 'Baixe o arquivo', text: 'Clique em “Baixar” na extensão que você vai usar. Vem um arquivo .zip.' },
  { title: 'Extraia numa pasta fixa', text: 'Descompacte o .zip numa pasta que você não vai apagar (ex.: Documentos › Undercut). O Chrome lê a extensão dessa pasta, então ela precisa continuar lá.' },
  { title: 'Abra as extensões do Chrome', text: 'Copie o endereço chrome://extensions, cole numa nova aba e ligue o “Modo do desenvolvedor” (canto superior direito).' },
  { title: 'Carregue a pasta', text: 'Clique em “Carregar sem compactação” e escolha a pasta extraída — a que tem o arquivo manifest.json dentro.' },
  { title: 'Fixe na barra', text: 'Clique no ícone de quebra-cabeça do Chrome e fixe a extensão para ela ficar sempre à mão.' },
]

/** Uso: passos de cada extensão (o que acontece na tela do portal da plataforma). */
const USE_STEPS: Record<string, { portal: string; steps: string[] }> = {
  'undercut-ifood': {
    portal: 'Portal do Parceiro do iFood',
    steps: [
      'Entre no Portal do Parceiro do iFood com a conta da loja do cliente, como você já faz.',
      'O painel do Undercut aparece na própria página. Conecte: entre com o e-mail e a senha que você criou no Undercut.',
      'Sincronize o cardápio da loja. A extensão lê os produtos e avisa quais estão sem foto.',
      'Peça a análise: o Undercut sugere combos e ajustes de cardápio.',
      'Revise as sugestões e aprove só o que fizer sentido para o cliente.',
      'Aplique o que foi aprovado. No final a extensão envia o relatório com prints para o Undercut.',
    ],
  },
  'undercut-cardapioweb': {
    portal: 'Portal do Cardápio Web',
    steps: [
      'Entre no Portal do Cardápio Web com a conta do cliente, como você já faz.',
      'O painel do Undercut aparece na própria página. Conecte: entre com o e-mail e a senha que você criou no Undercut.',
      'Sincronize o cardápio da loja. A extensão lê os produtos e avisa quais estão sem foto.',
      'Peça a análise: o Undercut sugere combos e ajustes de cardápio.',
      'Revise as sugestões e aprove só o que fizer sentido para o cliente.',
      'Aplique o que foi aprovado. No final a extensão envia o relatório com prints para o Undercut.',
    ],
  },
  'undercut-anotaai': {
    portal: 'painel do Anota AI',
    steps: [
      'Entre no painel do Anota AI com a conta do cliente, como você já faz.',
      'O painel do Undercut aparece na própria página. Conecte: entre com o e-mail e a senha que você criou no Undercut.',
      'Sincronize o cardápio da loja. A extensão lê os produtos e avisa quais estão sem foto.',
      'Peça a análise: o Undercut sugere combos e ajustes de cardápio.',
      'Revise as sugestões e aprove só o que fizer sentido para o cliente.',
      'Aplique o que foi aprovado. No final a extensão envia o relatório com prints para o Undercut.',
    ],
  },
}

const CONN_LABEL: Record<ExtensionConn, { text: string; cls: string }> = {
  online: { text: 'conectada', cls: 'border-[#34D399]/40 bg-[#34D399]/10 text-[#A7F3D0]' },
  idle: { text: 'sem contato recente', cls: 'border-[#FBBF24]/40 bg-[#FBBF24]/10 text-[#FDE68A]' },
  off: { text: 'desconectada', cls: 'border-[#FF6A3D]/40 bg-[#FF6A3D]/10 text-[#FFB199]' },
}

function Steps({ items }: { items: { title?: string; text: string }[] }) {
  return (
    <ol className="space-y-2.5">
      {items.map((step, i) => (
        <li key={i} className="flex gap-3">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[#D7141F]/40 bg-[#D7141F]/10 font-mono text-[11px] font-bold text-[#F0333D]">{i + 1}</span>
          <span className="min-w-0 text-[13px] leading-relaxed text-[#CFCBC4]">
            {step.title && <b className="text-[#F7F5F1]">{step.title}. </b>}
            {step.text}
          </span>
        </li>
      ))}
    </ol>
  )
}

function CopyChip({ value }: { value: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setDone(true)
          setTimeout(() => setDone(false), 2000)
        } catch {
          setDone(false)
        }
      }}
      className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/30 px-2.5 py-1 font-mono text-[11px] text-[#DAD6CF] hover:border-[#D7141F]/45 hover:text-white"
    >
      {done ? <Check size={12} /> : <Copy size={12} />} chrome://extensions
    </button>
  )
}

function Card({ entry, conn }: { entry: ExtensionCatalogEntry; conn?: ExtensionConn | null }) {
  const [open, setOpen] = useState(false)
  const use = USE_STEPS[entry.slug]
  const status = conn ? CONN_LABEL[conn] : null
  return (
    <article className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-gradient-to-b from-white/[0.045] to-white/[0.01] p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[#D7141F]/40 bg-[#D7141F]/10 font-mono text-[13px] font-bold text-[#F0333D]">{entry.monogram}</span>
        {status && (
          <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.12em]', status.cls)}>{status.text}</span>
        )}
      </div>
      <h3 className="mt-3 text-[15px] font-bold text-[#F7F5F1]">{entry.short}</h3>
      <p className="mt-1 text-[12px] leading-relaxed text-[#9F9A94]">{entry.description}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <a
          href={`${entry.downloadUrl}?v=${entry.version ?? ''}`}
          download
          className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#D7141F] px-4 text-[13px] font-bold text-white no-underline transition-colors hover:bg-[#F0333D] hover:no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F0333D]"
        >
          <Download size={16} /> Baixar
        </a>
        {entry.version && <span className="rounded-full border border-white/10 bg-black/30 px-2 py-0.5 font-mono text-[10px] text-[#B8B3AC]">v{entry.version}</span>}
      </div>
      {use && (
        <div className="mt-3 border-t border-white/[0.06] pt-3">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="flex w-full items-center justify-between gap-2 text-left text-[12px] font-semibold text-[#DAD6CF] hover:text-white"
          >
            Como usar no {use.portal}
            <ChevronDown size={14} className={cn('transition-transform', open && 'rotate-180')} />
          </button>
          {open && (
            <div className="mt-3">
              <Steps items={use.steps.map((text) => ({ text }))} />
            </div>
          )}
        </div>
      )}
    </article>
  )
}

/**
 * Baixar + instalar + usar. Mesma visão simples para todos; o ADM acrescenta o status
 * de conexão em cada cartão (`conns`). Só aparecem as extensões que já funcionam.
 */
export function ExtensionDownloads({ conns }: { conns?: Record<string, ExtensionConn> }) {
  const list = availableExtensions()
  const upcoming = EXTENSION_CATALOG.filter((e) => e.upcoming)
  return (
    <section id="sec-baixar" aria-labelledby="ext-down-title" className="mt-6 scroll-mt-24 rounded-3xl border border-white/[0.08] bg-[#0C0C0E] p-4 sm:p-5">
      <h2 id="ext-down-title" className="flex items-center gap-2 text-[16px] font-bold text-[#F7F5F1]">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-[#D7141F]/30 bg-[#D7141F]/10 text-[#F0333D]">
          <Package size={16} />
        </span>
        Baixar extensões
      </h2>
      <p className="mt-1 text-[12px] text-[#85817C]">Escolha a plataforma do cliente, baixe e siga o passo a passo.</p>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {list.map((entry) => (
          <Card key={entry.slug} entry={entry} conn={conns ? (conns[entry.slug] ?? 'off') : null} />
        ))}
      </div>

      {upcoming.length > 0 && (
        <p className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] text-[#85817C]">
          <Sparkles size={12} className="text-[#FBBF24]" /> Em breve: {upcoming.map((e) => e.short).join(', ')}.
        </p>
      )}

      <div className="mt-5 rounded-2xl border border-white/[0.07] bg-black/25 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[14px] font-bold text-[#F7F5F1]">Como instalar no Chrome (uma vez)</h3>
          <CopyChip value="chrome://extensions" />
        </div>
        <div className="mt-3">
          <Steps items={INSTALL_STEPS} />
        </div>
        <p className="mt-3 rounded-xl border border-[#FBBF24]/20 bg-[#FBBF24]/[0.05] px-3 py-2 text-[11px] leading-relaxed text-[#FDE68A]">
          Para atualizar depois: baixe o .zip novo, extraia por cima da mesma pasta e, em chrome://extensions, clique em “Recarregar” (setinha circular) na extensão.
        </p>
      </div>
    </section>
  )
}
