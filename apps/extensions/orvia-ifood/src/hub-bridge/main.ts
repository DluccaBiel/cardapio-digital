/**
 * Ponte "conectar com um clique" — content script na tela de Extensões do Orvia.
 *  1) anuncia que a extensão está instalada (data-orvia-ifood + postMessage 'hello');
 *     a própria página pode pedir o status da conexão ('status');
 *  2) recebe da PRÓPRIA página (mesma origem) a chave recém-gerada e repassa ao
 *     service worker, que testa e salva;
 *  3) devolve só o resultado (nunca a chave) para a página.
 */
import { send } from '../lib/messages'

const version = chrome.runtime.getManifest().version
document.documentElement.dataset.orviaIfood = version
window.postMessage({ source: 'orvia-ext', type: 'hello', version }, window.location.origin)

window.addEventListener('message', async (event: MessageEvent) => {
  if (event.source !== window || event.origin !== window.location.origin) return
  const data = event.data as { source?: string; type?: string; key?: string; hubUrl?: string } | null
  if (!data || data.source !== 'orvia-hub') return
  if (data.type === 'status') {
    const res = await send<{ configured: boolean; workspace?: { name: string } }>({ type: 'hub:status' })
    window.postMessage(
      res.ok
        ? { source: 'orvia-ext', type: 'status', ok: true, data: res.data }
        : { source: 'orvia-ext', type: 'status', ok: false, error: res.error },
      window.location.origin,
    )
    return
  }
  if (data.type !== 'pair' || typeof data.key !== 'string') return
  const res = await send<{ workspace: { name: string } }>({ type: 'hub:pair', hubUrl: window.location.origin, apiKey: data.key })
  window.postMessage(
    res.ok
      ? { source: 'orvia-ext', type: 'paired', ok: true, workspace: res.data.workspace.name }
      : { source: 'orvia-ext', type: 'paired', ok: false, error: res.error },
    window.location.origin,
  )
})
