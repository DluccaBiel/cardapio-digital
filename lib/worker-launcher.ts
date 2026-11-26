import type { SupabaseClient } from '@supabase/supabase-js'

/** Robô considerado online se bateu ponto nos últimos 30 s (igual ao painel). */
export const WORKER_TTL_MS = 30_000

export type LaunchResult =
  | { state: 'online' } // já estava ligado
  | { state: 'started'; via: 'remoto' | 'local'; online: boolean } // ligamos agora (online=false: ainda subindo)
  | { state: 'manual'; reason: string } // sem como ligar sozinho

export async function workerOnline(db: SupabaseClient, workspaceId: string): Promise<boolean> {
  const { data } = await db.from('whatsapp_sessions').select('worker_seen_at').eq('workspace_id', workspaceId).maybeSingle()
  const seen = data?.worker_seen_at ? Date.parse(data.worker_seen_at as string) : 0
  return Date.now() - seen < WORKER_TTL_MS
}

/**
 * Liga o robô sozinho quando o usuário manda disparar.
 *  1) WORKER_START_URL (servidor 24 h): chamada HTTP que liga a máquina/serviço do robô. Ex. Fly.io:
 *     https://api.machines.dev/v1/apps/<app>/machines/<id>/start  + WORKER_START_TOKEN (token da Fly, vai como Bearer).
 *  2) Fora da Vercel (rodando `npm run dev/start` no PC): inicia o processo local em segundo plano.
 *  3) Senão: pede ligação manual (a Vercel não mantém conexão de WhatsApp aberta).
 */
export async function ensureWorkerRunning(db: SupabaseClient, workspaceId: string, waitMs = 8_000): Promise<LaunchResult> {
  if (await workerOnline(db, workspaceId)) return { state: 'online' }

  const url = process.env.WORKER_START_URL?.trim()
  if (url) {
    try {
      const token = process.env.WORKER_START_TOKEN?.trim()
      const res = await fetch(url, {
        method: process.env.WORKER_START_METHOD?.trim() || 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        signal: AbortSignal.timeout(8_000),
      })
      if (!res.ok && res.status !== 409 /* já iniciada */) return { state: 'manual', reason: `O servidor do robô respondeu ${res.status} ao pedido de ligar.` }
    } catch (e) {
      return { state: 'manual', reason: `Não consegui falar com o servidor do robô (${e instanceof Error ? e.message : 'erro de rede'}).` }
    }
    const until = Date.now() + waitMs
    while (Date.now() < until) {
      await new Promise((ok) => setTimeout(ok, 1_500))
      if (await workerOnline(db, workspaceId)) return { state: 'started', via: 'remoto', online: true }
    }
    return { state: 'started', via: 'remoto', online: false }
  }

  if (process.env.VERCEL !== '1') {
    try {
      const { spawn } = await import('node:child_process')
      const path = await import('node:path')
      const root = process.cwd()
      const child = spawn(process.execPath, [path.join(root, 'apps', 'whatsapp-worker', 'src', 'index.mjs')], {
        cwd: path.join(root, 'apps', 'whatsapp-worker'),
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      })
      child.unref()
      return { state: 'started', via: 'local', online: false }
    } catch (e) {
      return { state: 'manual', reason: `Falha ao iniciar o robô local: ${e instanceof Error ? e.message : e}` }
    }
  }

  return { state: 'manual', reason: 'Configure WORKER_START_URL na Vercel (servidor do robô) para ligar sozinho — veja docs/robo-24h.md.' }
}

export function launchMessage(r: LaunchResult): string {
  if (r.state === 'online') return 'Robô já está ligado.'
  if (r.state === 'started') return r.online ? 'Robô ligado automaticamente.' : 'Robô sendo ligado… em instantes ele assume os envios.'
  return r.reason
}
