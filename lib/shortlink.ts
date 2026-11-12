import { createHash } from 'crypto'
import { brand } from '@undercut/brand'
import { createAdminClient } from './supabaseAdmin'

/**
 * Link curto de acesso ao workspace: `/c/<8 hex>`.
 *
 * O código é DERIVADO do slug (sha-256 truncado), então não precisa de tabela
 * nova nem de migration — o mesmo slug sempre gera o mesmo código e o
 * redirecionamento resolve no servidor com service role.
 *
 * Ex.: https://undercuthub.vercel.app/a/odkalakbh.../extensoes
 *   →  https://undercuthub.vercel.app/c/1a2b3c4d
 */
export function workspaceCode(slug: string): string {
  return createHash('sha256').update(slug, 'utf8').digest('hex').slice(0, 8)
}

export function shortUrlFor(slug: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL || brand.baseUrl).replace(/\/+$/, '')
  return `${base}/c/${workspaceCode(slug)}`
}

/** Resolve o slug pelo código curto. Ignora workspaces excluídos. */
export async function findWorkspaceByCode(code: string): Promise<string | null> {
  const clean = code.toLowerCase()
  if (!/^[0-9a-f]{6,12}$/.test(clean)) return null
  const admin = createAdminClient()
  const { data, error } = await admin.from('workspaces').select('slug').is('deleted_at', null)
  if (error || !data) return null
  return data.find((w) => workspaceCode(String(w.slug)) === clean)?.slug ?? null
}
