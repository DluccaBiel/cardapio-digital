'use client'

import { useState } from 'react'
import { Check, Copy, ExternalLink, Loader2, Search, Sparkles, Terminal } from 'lucide-react'
import { cn, Modal } from '@/components/hub/ui'
import { Btn } from '@/components/hub/menu/shared'
import { researchAction } from '@/app/a/[ws]/extensoes/actions'

type Answer = Awaited<ReturnType<typeof researchAction>>

/**
 * Agente de pesquisa do Undercut: as extensões (e o painel) perguntam e recebem
 * uma resposta com fontes públicas. Sem ANTHROPIC_API_KEY funciona no modo
 * gratuito (busca pública).
 */
export function ResearchPanel({ ws, hubUrl }: { ws: string; hubUrl: string }) {
  const [question, setQuestion] = useState('')
  const [context, setContext] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Answer | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [docs, setDocs] = useState(false)

  const ask = async () => {
    setBusy(true)
    setError(null)
    const res = await researchAction(ws, { question, context: context.trim() || undefined })
    setBusy(false)
    if (!res.ok) return setError(res.error)
    setResult(res)
  }

  const endpoint = `${hubUrl || ''}/api/v1/research`
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`curl -X POST ${endpoint} -H "Content-Type: application/json" -H "X-API-Key: ck_live_..." -d '{"question":"Qual o preço médio de combo de hambúrguer em São Paulo?"}'`)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      setCopied(false)
    }
  }

  const answer = result?.ok ? result.data : null

  return (
    <section className="relative mt-6 overflow-hidden rounded-3xl border border-[#D7141F]/20 bg-gradient-to-br from-[#160A0C] via-[#0E0E10] to-[#0B0B0C] p-4 sm:p-5" aria-labelledby="ext-research-title">
      <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-[#D7141F]/10 blur-3xl" aria-hidden="true" />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="ext-research-title" className="flex items-center gap-2 text-[16px] font-bold text-[#F7F5F1]">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-[#D7141F]/30 bg-[#D7141F]/10 text-[#F0333D]">
              <Search size={16} />
            </span>
            Agente de pesquisa
          </h2>
          <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-[#8E8A86]">
            Pergunte sobre mercado, concorrentes, preços e tendências. O agente responde com fontes públicas — e as extensões podem pedir a mesma pesquisa pela API.
          </p>
        </div>
        <Btn variant="secondary" onClick={() => setDocs(true)}>
          <Terminal size={14} /> API para extensões
        </Btn>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[1.35fr_1fr]">
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-3">
          <label className="block">
            <span className="mb-1.5 block font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-[#8E8A86]">Pergunta</span>
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="Ex.: Quais combos de hambúrguer estão sendo vendidos em São Paulo e por qual preço?"
              className="w-full resize-y rounded-xl border border-[#2A2A2E] bg-[#0B0B0C] px-3 py-2 text-[13px] text-[#ECE9E3] outline-none placeholder:text-[#85817C] focus:border-[#D7141F] focus:ring-2 focus:ring-[#D7141F]/20"
            />
          </label>
          <label className="mt-2 block">
            <span className="mb-1.5 block font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-[#8E8A86]">Contexto (opcional)</span>
            <input
              value={context}
              onChange={(e) => setContext(e.target.value)}
              maxLength={1200}
              placeholder="Cidade, segmento, produto, estratégia…"
              className="h-[38px] w-full rounded-xl border border-[#2A2A2E] bg-[#0B0B0C] px-3 text-[12px] text-[#ECE9E3] outline-none placeholder:text-[#85817C] focus:border-[#D7141F] focus:ring-2 focus:ring-[#D7141F]/20"
            />
          </label>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#55555C]">{question.length}/500</span>
            <Btn variant="primary" disabled={busy || question.trim().length < 5} onClick={ask}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} {busy ? 'Pesquisando…' : 'Pesquisar'}
            </Btn>
          </div>
          {error && <p className="mt-3 rounded-xl border border-[#FF6A3D]/40 bg-[#FF6A3D]/10 px-3 py-2 text-[12px] text-[#FFB199]">{error}</p>}
        </div>

        <div className="rounded-2xl border border-white/[0.08] bg-black/20 p-3">
          <h3 className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-[#8E8A86]">Resposta</h3>
          {!answer ? (
            <div className="mt-6 flex flex-col items-center gap-2 px-4 text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] text-[#55555C]">
                <Search size={18} />
              </span>
              <p className="text-[12px] leading-relaxed text-[#85817C]">A resposta aparece aqui, com as fontes usadas. Nada é aplicado automaticamente.</p>
            </div>
          ) : (
            <div className="uc-fade-up mt-2">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.14em]',
                    answer.status === 'ok' ? 'border-[#34D399]/40 bg-[#34D399]/10 text-[#6EE7B7]' : 'border-[#FBBF24]/40 bg-[#FBBF24]/10 text-[#FDE68A]',
                  )}
                >
                  <span className={cn('h-1.5 w-1.5 rounded-full', answer.status === 'ok' ? 'bg-[#34D399]' : 'bg-[#FBBF24]')} />
                  {answer.status === 'ok' ? 'resposta' : 'sem fontes'}
                </span>
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#55555C]">{answer.mode === 'ia' ? 'IA + busca' : 'modo gratuito'}</span>
              </div>
              <div className="mt-2 max-h-[290px] overflow-y-auto whitespace-pre-wrap text-[12px] leading-relaxed text-[#CFCBC4]">{answer.answer}</div>
              {answer.sources.length > 0 && (
                <div className="mt-3 border-t border-white/[0.07] pt-2">
                  <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-[#55555C]">Fontes</p>
                  <ul className="mt-1 space-y-1">
                    {answer.sources.map((s) => (
                      <li key={s.url}>
                        <a href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-start gap-1 text-[11px] text-[#F0333D] hover:underline">
                          <ExternalLink size={11} className="mt-0.5 shrink-0" /> <span className="line-clamp-2">{s.title}</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {answer.notices.length > 0 && <p className="mt-2 text-[10px] leading-relaxed text-[#85817C]">{answer.notices.join(' ')}</p>}
            </div>
          )}
        </div>
      </div>

      {docs && (
        <Modal title="Pesquisa para extensões" description="POST /api/v1/research · escopo pesquisa:ler" onClose={() => setDocs(false)} width="max-w-xl">
          <p className="text-[13px] leading-relaxed text-[#CFCBC4]">
            Gere uma chave com o escopo <b>pesquisa:ler</b> (as chaves de conexão das extensões já incluem) e envie:
          </p>
          <pre className="mt-3 overflow-x-auto rounded-xl border border-[#2A2A2E] bg-[#0B0B0C] p-3 font-mono text-[11px] leading-relaxed text-[#B8B3AC]">
{`POST ${endpoint}
X-API-Key: ck_live_…
Content-Type: application/json

{
  "question": "Qual o preço médio de combo de hambúrguer em São Paulo?",
  "context": "Cliente: lanchonete no centro. Estratégia: combos.",
  "max_sources": 5
}`}
          </pre>
          <pre className="mt-2 overflow-x-auto rounded-xl border border-white/[0.06] bg-black/30 p-3 font-mono text-[11px] leading-relaxed text-[#8E8A86]">
{`200 { data: { answer, sources[], mode, status, notices[], answered_at } }
401 chave inválida · 403 sem pesquisa:ler · 429 rate limit`}
          </pre>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] text-[#85817C]">Somente fontes públicas. O conteúdo não é gravado (só o audit_log, sem pergunta/resposta).</p>
            <Btn variant="secondary" onClick={copy}>
              {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copiado' : 'Copiar exemplo'}
            </Btn>
          </div>
          <div className="mt-4 flex justify-end border-t border-[#1C1C1F] pt-4">
            <Btn variant="primary" onClick={() => setDocs(false)}>
              Fechar
            </Btn>
          </div>
        </Modal>
      )}
    </section>
  )
}
