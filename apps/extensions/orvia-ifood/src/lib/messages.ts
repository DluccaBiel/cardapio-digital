import type { MenuSnapshot } from '../core/schema'

/** Mensagens content/options → service worker. */
export type Msg =
  | { type: 'snapshot:save'; snapshot: MenuSnapshot }
  | { type: 'snapshot:latest' }
  | { type: 'hub:status' }
  | { type: 'hub:clients' }
  | { type: 'hub:menu'; clientId: string }
  | { type: 'hub:import'; clientId: string; snapshot: MenuSnapshot }
  | { type: 'hub:pending'; clientId: string }
  | { type: 'hub:sync'; itemId: string; etag: string; ifoodId?: string | null }
  | { type: 'hub:createCombo'; body: { client_id: string; name: string; description: string; price: number; components: { component_id: string; quantity: number }[] } }
  | { type: 'hub:test'; hubUrl: string; apiKey: string }
  | { type: 'hub:pair'; hubUrl: string; apiKey: string }
  | { type: 'options:open' }

export type Reply<T = unknown> = { ok: true; data: T } | { ok: false; error: string; code?: string; details?: Record<string, unknown> }

/** Envia ao service worker com tratamento de "extensão recarregada". */
export async function send<T>(msg: Msg): Promise<Reply<T>> {
  try {
    const reply = (await chrome.runtime.sendMessage(msg)) as Reply<T> | undefined
    return reply ?? { ok: false, error: 'Sem resposta da extensão.' }
  } catch {
    return { ok: false, error: 'A extensão foi atualizada. Recarregue a página do iFood (F5).' }
  }
}

export const HUB_CONFIG_KEY = 'orvia.hub'
export const SELECTED_CLIENT_KEY = 'orvia.selectedClient'
