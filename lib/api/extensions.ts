/**
 * Canais de extensão do Undercut: iFood, Cardápio Web, Anota AI e parceiros
 * (FlyTo — integração de sistema parceiro, ver migrations 0008/0010). (0008, FlyTo em 0010.)
 *
 * Quem decide o canal de uma chamada é a CHAVE (api_keys.extension_id), criada no
 * login feito dentro da extensão. No login, a extensão é identificada por:
 *   1) campo `extension` no corpo (versões novas das extensões), ou
 *   2) `Origin: chrome-extension://<id>` — a extensão Cardápio Web tem id fixo
 *      (campo `key` do manifest), configurável em CARDAPIOWEB_EXTENSION_IDS;
 *   3) senão, 'undercut-ifood' (comportamento anterior; o id dela varia por máquina).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export const EXTENSION_SLUGS = ['undercut-ifood', 'undercut-cardapioweb', 'undercut-anotaai', 'undercut-flyto'] as const
export type ExtensionSlug = (typeof EXTENSION_SLUGS)[number]
export type Platform = 'ifood' | 'cardapioweb' | 'anotaai' | 'flyto'

export const PLATFORM_OF: Record<ExtensionSlug, Platform> = {
  'undercut-ifood': 'ifood',
  'undercut-cardapioweb': 'cardapioweb',
  'undercut-anotaai': 'anotaai',
  'undercut-flyto': 'flyto',
}
export const PLATFORM_LABEL: Record<Platform, string> = { ifood: 'iFood', cardapioweb: 'Cardápio Web', anotaai: 'Anota AI', flyto: 'FlyTo' }

/** Id do Chrome da extensão Cardápio Web 0.3.x (derivado do `key` do manifest). */
const DEFAULT_CARDAPIOWEB_IDS = ['onolpcebolaabfapfnmemokkinncppok']

function cardapiowebIds(): string[] {
  const env = (process.env.CARDAPIOWEB_EXTENSION_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^[a-p]{32}$/.test(s))
  return env.length ? env : DEFAULT_CARDAPIOWEB_IDS
}

/**
 * Extensão do SDR no WhatsApp Web. NÃO é um canal de loja (sem cardápio/trava de loja):
 * fica fora de EXTENSION_SLUGS/Platform e tem escopos próprios (sdr:*).
 */
export const SDR_EXTENSION_SLUG = 'undercut-sdr' as const
export const LOGIN_EXTENSION_SLUGS = [...EXTENSION_SLUGS, SDR_EXTENSION_SLUG] as const
export type LoginExtensionSlug = (typeof LOGIN_EXTENSION_SLUGS)[number]

export function isExtensionSlug(v: unknown): v is ExtensionSlug {
  return typeof v === 'string' && (EXTENSION_SLUGS as readonly string[]).includes(v)
}

/** Qual extensão está fazendo o login (ver ordem no topo do arquivo). */
export function detectExtensionSlug(req: Request, declared?: string | null): ExtensionSlug {
  if (isExtensionSlug(declared)) return declared
  const m = /^chrome-extension:\/\/([a-p]{32})$/.exec(req.headers.get('origin') ?? '')
  if (m && cardapiowebIds().includes(m[1]!)) return 'undercut-cardapioweb'
  return 'undercut-ifood'
}

/** Canal da chave autenticada. Chave sem extensão (manual) ou desconhecida → iFood. */
export async function platformOfExtensionId(db: SupabaseClient, extensionId: string | null): Promise<Platform> {
  if (!extensionId) return 'ifood'
  const { data } = await db.from('extensions').select('slug').eq('id', extensionId).maybeSingle()
  return isExtensionSlug(data?.slug) ? PLATFORM_OF[data.slug] : 'ifood'
}

/** Coluna da trava de loja de cada canal em `clients`. */
export const STORE_COLUMN: Record<Platform, 'ifood_merchant_id' | 'cardapioweb_store_id' | 'anotaai_store_id' | 'flyto_store_id'> = {
  ifood: 'ifood_merchant_id',
  cardapioweb: 'cardapioweb_store_id',
  anotaai: 'anotaai_store_id',
  flyto: 'flyto_store_id',
}
