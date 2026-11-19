/**
 * Sincronização Meta → ad_accounts para um workspace. SOMENTE servidor.
 *
 * Fonte: portfólios conectados em Configurações → Integrações (meta_businesses.enabled),
 * cada um com o token da conexão (criptografado). Sem portfólio conectado, usa o
 * modo legado por variável de ambiente (META_ACCESS_TOKEN + META_BUSINESS_ID).
 *
 * Escrita em ad_accounts/meta_businesses com a SESSÃO do usuário (RLS owner/coordenador);
 * leitura do token com a service role (tabela sem acesso para usuários).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '../supabaseAdmin'
import { decryptToken } from './crypto'
import { enrichAccount, type AccountEnrichment } from './api'
import { fetchAdAccount, fetchBusinessAdAccounts, graphVersion, MetaError, metaConfig, type MetaAdAccount } from './graph'

export type SyncSummary = {
  total: number
  created: number
  updated: number
  linked: number
  enriched: number
  businesses: number
  errors: string[]
  synced_at: string
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()

async function pool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i]!)
      }
    }),
  )
  return out
}

/** Tokens descriptografados das conexões ativas do workspace (connection_id → token). */
export async function workspaceTokens(workspaceId: string): Promise<Map<string, string>> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('meta_connection_tokens')
    .select('connection_id, token_ciphertext, meta_connections!inner ( status )')
    .eq('workspace_id', workspaceId)
  const out = new Map<string, string>()
  for (const row of (data ?? []) as any[]) {
    const conn = Array.isArray(row.meta_connections) ? row.meta_connections[0] : row.meta_connections
    if (conn?.status !== 'active') continue
    try {
      out.set(row.connection_id, decryptToken(row.token_ciphertext))
    } catch {
      // chave trocada/token corrompido: conexão precisa ser refeita
    }
  }
  return out
}

type Source = { metaBusinessId: string | null; businessId: string; name: string; token: string }

export async function syncWorkspaceMeta(db: SupabaseClient, workspaceId: string): Promise<SyncSummary> {
  const now = new Date().toISOString()
  const errors: string[] = []

  // 1) Fontes: portfólios conectados (ou modo legado por env)
  const { data: businesses } = await db
    .from('meta_businesses')
    .select('id, business_id, name, connection_id')
    .eq('workspace_id', workspaceId)
    .eq('enabled', true)

  const sources: Source[] = []
  if (businesses && businesses.length > 0) {
    const tokens = await workspaceTokens(workspaceId)
    for (const b of businesses) {
      const token = tokens.get(b.connection_id)
      if (!token) {
        errors.push(`${b.name}: conexão com o Facebook expirada — reconecte em Configurações → Integrações.`)
        continue
      }
      sources.push({ metaBusinessId: b.id, businessId: b.business_id, name: b.name, token })
    }
  } else {
    const legacy = metaConfig()
    if (!legacy) {
      throw new MetaError('Nenhum portfólio conectado. Conecte sua conta do Facebook em Configurações → Integrações e ative os portfólios.')
    }
    sources.push({ metaBusinessId: null, businessId: legacy.businessId, name: 'Portfólio (variável de ambiente)', token: legacy.token })
  }

  // 2) Contas de cada portfólio + enriquecimento (só contas ativas)
  type Row = MetaAdAccount & AccountEnrichment & { meta_business_id: string | null }
  const byExt = new Map<string, Row>()
  let enriched = 0

  for (const src of sources) {
    let accounts: MetaAdAccount[] = []
    try {
      accounts = await fetchBusinessAdAccounts({ token: src.token, businessId: src.businessId, version: graphVersion() })
    } catch (e) {
      const msg = e instanceof MetaError ? e.message : 'falha ao consultar a Meta'
      errors.push(`${src.name}: ${msg}`)
      if (src.metaBusinessId) await db.from('meta_businesses').update({ sync_error: msg.slice(0, 300) }).eq('id', src.metaBusinessId)
      continue
    }

    const fresh = accounts.filter((a) => !byExt.has(a.external_account_id))
    const details = await pool(fresh, 4, async (a) => {
      if (a.status !== 'active') return null
      try {
        return await enrichAccount(src.token, a.external_account_id)
      } catch {
        return null // conta sem permissão de insights: mantém dados básicos
      }
    })
    fresh.forEach((a, i) => {
      const extra = details[i]
      if (extra) enriched += 1
      // Todas as linhas do lote com as mesmas colunas (upsert em lote exige).
      const base: AccountEnrichment = {
        spend_month: a.spend_month,
        spend_yesterday: 0,
        spend_7d: 0,
        revenue_month: 0,
        roas_month: null,
        ends_at: null,
        runs_continuously: false,
        last_change_at: null,
        active_adsets: 0,
        sales_spend_month: 0,
        sales_revenue_month: 0,
        sales_purchases_month: 0,
      }
      byExt.set(a.external_account_id, { ...a, ...(extra ?? base), meta_business_id: src.metaBusinessId })
    })

    if (src.metaBusinessId) {
      await db
        .from('meta_businesses')
        .update({ last_synced_at: now, accounts_count: accounts.length, sync_error: null })
        .eq('id', src.metaBusinessId)
    }
  }

  // 3) Upsert em ad_accounts (+ vínculo automático por nome do cliente)
  const [{ data: existing, error: exErr }, { data: clients }] = await Promise.all([
    db.from('ad_accounts').select('external_account_id, client_id').eq('workspace_id', workspaceId).eq('platform', 'meta'),
    db.from('clients').select('id, name').eq('workspace_id', workspaceId).is('archived_at', null),
  ])
  if (exErr) throw new MetaError('Não consegui ler as contas do Undercut (migrations aplicadas?).')
  const prevByExt = new Map((existing ?? []).map((r) => [r.external_account_id as string, r]))
  const clientByName = new Map<string, string>()
  for (const cl of clients ?? []) if (!clientByName.has(norm(cl.name))) clientByName.set(norm(cl.name), cl.id)

  let created = 0
  let linked = 0
  const rows = Array.from(byExt.values()).map((a) => {
    const prev = prevByExt.get(a.external_account_id)
    if (!prev) created += 1
    let client_id: string | null = (prev?.client_id as string | null) ?? null
    if (!client_id) {
      client_id = (a.owner_business_name && clientByName.get(norm(a.owner_business_name))) || clientByName.get(norm(a.name)) || null
      if (client_id) linked += 1
    }
    return { workspace_id: workspaceId, platform: 'meta' as const, ...a, client_id, last_synced_at: now, sync_error: null }
  })

  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await db.from('ad_accounts').upsert(rows.slice(i, i + 200), { onConflict: 'workspace_id,platform,external_account_id' })
    if (error) throw new MetaError(`Não consegui salvar as contas (${error.code ?? 'erro'}). Confira se as migrations foram aplicadas.`)
  }

  return { total: rows.length, created, updated: rows.length - created, linked, enriched, businesses: sources.length, errors, synced_at: now }
}

const EMPTY_ENRICHMENT: AccountEnrichment = {
  spend_month: 0,
  spend_yesterday: 0,
  spend_7d: 0,
  revenue_month: 0,
  roas_month: null,
  ends_at: null,
  runs_continuously: false,
  last_change_at: null,
  active_adsets: 0,
  sales_spend_month: 0,
  sales_revenue_month: 0,
  sales_purchases_month: 0,
}

/**
 * Atualização RÁPIDA (a cada 5 min na Visão geral): só as contas ACOMPANHADAS.
 * Busca cada conta direto (saldo, Pix/cartão, status) + gasto/vendas/término, sem listar
 * o portfólio inteiro — bem mais leve para os limites de chamada da Meta.
 */
export async function refreshWatchedMeta(db: SupabaseClient, workspaceId: string): Promise<{ refreshed: number; errors: string[]; synced_at: string }> {
  const now = new Date().toISOString()
  const errors: string[] = []
  const [{ data: watched }, { data: businesses }] = await Promise.all([
    db.from('ad_accounts').select('id, name, external_account_id, meta_business_id').eq('workspace_id', workspaceId).eq('platform', 'meta').eq('is_watched', true),
    db.from('meta_businesses').select('id, connection_id').eq('workspace_id', workspaceId),
  ])
  if (!watched || watched.length === 0) return { refreshed: 0, errors, synced_at: now }

  const tokens = await workspaceTokens(workspaceId)
  const anyToken = tokens.values().next().value ?? metaConfig()?.token ?? null
  const connByBiz = new Map((businesses ?? []).map((b) => [b.id as string, b.connection_id as string]))
  const tokenFor = (bizId: string | null) => (bizId && tokens.get(connByBiz.get(bizId) ?? '')) || anyToken

  let refreshed = 0
  await pool(watched, 4, async (row) => {
    const token = tokenFor(row.meta_business_id as string | null)
    if (!token) {
      errors.push(`${row.name}: sem conexão ativa com o Facebook.`)
      return
    }
    try {
      const acc = await fetchAdAccount(token, graphVersion(), row.external_account_id as string)
      const extra = acc.status === 'active' ? await enrichAccount(token, acc.external_account_id).catch(() => null) : EMPTY_ENRICHMENT
      const { access_kind: _a, owner_business_id: _b, ...fields } = acc
      const { error } = await db
        .from('ad_accounts')
        .update({ ...fields, ...(extra ?? {}), last_synced_at: now, sync_error: null })
        .eq('workspace_id', workspaceId)
        .eq('id', row.id)
      if (error) errors.push(`${row.name}: não consegui salvar (${error.code ?? 'erro'}).`)
      else refreshed += 1
    } catch (e) {
      const msg = e instanceof MetaError ? e.message : 'falha ao consultar a Meta'
      errors.push(`${row.name}: ${msg}`)
      await db.from('ad_accounts').update({ sync_error: msg.slice(0, 300) }).eq('workspace_id', workspaceId).eq('id', row.id)
    }
  })
  return { refreshed, errors, synced_at: now }
}
