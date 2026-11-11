/**
 * Canais de extensão do Orvia: iFood, Cardápio Web e Anota AI (0008).
 *
 * Quem decide o canal de uma chamada é a CHAVE (api_keys.extension_id), criada no
 * login feito dentro da extensão. No login, a extensão é identificada por:
 *   1) campo `extension` no corpo (versões novas das extensões), ou
 *   2) `Origin: chrome-extension://<id>` — a extensão Cardápio Web tem id fixo
 *      (campo `key` do manifest), configurável em CARDAPIOWEB_EXTENSION_IDS;
 *   3) senão, 'orvia-ifood' (comportamento anterior; o id dela varia por máquina).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export const EXTENSION_SLUGS = ['orvia-ifood', 'orvia-cardapioweb', 'orvia-anotaai'] as const
export type ExtensionSlug = (typeof EXTENSION_SLUGS)[number]
export type Platform = 'ifood' | 'cardapioweb' | 'anotaai'

export const PLATFORM_OF: Record<ExtensionSlug, Platform> = {
  'orvia-ifood': 'ifood',
  'orvia-cardapioweb': 'cardapioweb',
  'orvia-anotaai': 'anotaai',
}
export const PLATFORM_LABEL: Record<Platform, string> = { ifood: 'iFood', cardapioweb: 'Cardápio Web', anotaai: 'Anota AI' }

/** Id do Chrome da extensão Cardápio Web 0.3.x (derivado do `key` do manifest). */
const DEFAULT_CARDAPIOWEB_IDS = ['onolpcebolaabfapfnmemokkinncppok']

function cardapiowebIds(): string[] {
  const env = (process.env.CARDAPIOWEB_EXTENSION_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^[a-p]{32}$/.test(s))
  return env.length ? env : DEFAULT_CARDAPIOWEB_IDS
}

export function isExtensionSlug(v: unknown): v is ExtensionSlug {
  return typeof v === 'string' && (EXTENSION_SLUGS as readonly string[]).includes(v)
}

/** Qual extensão está fazendo o login (ver ordem no topo do arquivo). */
export function detectExtensionSlug(req: Request, declared?: string | null): ExtensionSlug {
  if (isExtensionSlug(declared)) return declared
  const m = /^chrome-extension:\/\/([a-p]{32})$/.exec(req.headers.get('origin') ?? '')
  if (m && cardapiowebIds().includes(m[1]!)) return 'orvia-cardapioweb'
  return 'orvia-ifood'
}

/** Canal da chave autenticada. Chave sem extensão (manual) ou desconhecida → iFood. */
export async function platformOfExtensionId(db: SupabaseClient, extensionId: string | null): Promise<Platform> {
  if (!extensionId) return 'ifood'
  const { data } = await db.from('extensions').select('slug').eq('id', extensionId).maybeSingle()
  return isExtensionSlug(data?.slug) ? PLATFORM_OF[data.slug] : 'ifood'
}

/** Coluna da trava de loja de cada canal em `clients`. */
export const STORE_COLUMN: Record<Platform, 'ifood_merchant_id' | 'cardapioweb_store_id' | 'anotaai_store_id'> = {
  ifood: 'ifood_merchant_id',
  cardapioweb: 'cardapioweb_store_id',
  anotaai: 'anotaai_store_id',
}
