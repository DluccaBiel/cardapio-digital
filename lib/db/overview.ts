import type { SupabaseClient } from '@supabase/supabase-js'
import type { MockClient, MockTag, Situation } from '../mock'
import { clientHealth } from '../health'

/**
 * Dados REAIS da Visão geral: clientes + tags + contas de anúncio (sincronizadas da Meta).
 * Mantém o formato `MockClient` da fase visual; campos operacionais que ainda não têm
 * tabela (Pix, rotina, criativo, entrega) começam vazios.
 *
 * Por cliente soma as contas ACOMPANHADAS (is_watched); se nenhuma estiver marcada,
 * soma todas as vinculadas. Contas sem cliente aparecem como linha própria.
 */

type AccountRow = {
  id: string
  client_id: string | null
  name: string
  status: string
  account_type: string
  balance: number | string
  spend_month: number | string
  spend_yesterday?: number | string | null
  spend_7d?: number | string | null
  revenue_month?: number | string | null
  ends_at?: string | null
  runs_continuously?: boolean | null
  last_change_at?: string | null
  active_adsets?: number | null
  is_watched: boolean
  last_synced_at: string | null
  owner_business_name: string | null
}

const SITUATION: Record<string, Situation> = { ativo: 'ativo', pausado: 'stand_by', encerrado: 'churn' }
const n = (v: unknown) => Number(v ?? 0) || 0

/** yyyy-mm-dd no fuso de São Paulo (coluna "Término"). */
function spDay(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
}

function aggregate(base: Omit<MockClient, 'spendMonth' | 'spendYesterday' | 'balance' | 'daysLeft' | 'termination' | 'lastChange' | 'alert' | 'campaignState' | 'roas' | 'accountsCount'>, all: AccountRow[], fallbackChange: string): MockClient {
  const watched = all.filter((a) => a.is_watched)
  const accounts = watched.length > 0 ? watched : all

  if (accounts.length === 0) {
    return {
      ...base,
      spendMonth: 0,
      spendYesterday: 0,
      balance: null,
      daysLeft: null,
      termination: null,
      lastChange: fallbackChange,
      alert: false,
      campaignState: 'nao_definido',
      roas: null,
      accountsCount: 0,
    }
  }

  const spendMonth = accounts.reduce((t, a) => t + n(a.spend_month), 0)
  const spendYesterday = accounts.reduce((t, a) => t + n(a.spend_yesterday), 0)
  const spend7d = accounts.reduce((t, a) => t + n(a.spend_7d), 0)
  const revenue = accounts.reduce((t, a) => t + n(a.revenue_month), 0)
  const balance = accounts.reduce((t, a) => t + n(a.balance), 0)
  const prepaidBalance = accounts.filter((a) => a.account_type === 'prepaid').reduce((t, a) => t + Math.max(0, n(a.balance)), 0)
  const daily = spend7d / 7
  const daysLeft = balance < 0 ? -1 : prepaidBalance > 0 && daily > 0 ? prepaidBalance / daily : null

  const ends = accounts.map((a) => a.ends_at).filter((v): v is string => !!v).sort()
  const changes = accounts.map((a) => a.last_change_at ?? a.last_synced_at).filter((v): v is string => !!v).sort()
  const activeAdsets = accounts.reduce((t, a) => t + n(a.active_adsets), 0)
  const anyActive = accounts.some((a) => a.status === 'active')

  return {
    ...base,
    spendMonth,
    spendYesterday,
    balance,
    daysLeft,
    termination: ends.length ? spDay(ends[ends.length - 1]!) : null,
    lastChange: changes.length ? changes[changes.length - 1]! : fallbackChange,
    alert: balance < 0 || (daysLeft !== null && daysLeft < 2) || accounts.some((a) => a.status === 'error'),
    campaignState: activeAdsets > 0 ? 'ativo' : anyActive ? 'pausado' : 'encerrado',
    roas: spendMonth > 0 ? Math.round((revenue / spendMonth) * 100) / 100 : null,
    accountsCount: accounts.length,
  }
}

const EMPTY_OPS = {
  pixPaidAt: null,
  pixAmount: null,
  routine: [] as string[],
  creativeStatus: 'nao_definido' as const,
  deliveryState: 'pendente' as const,
  editor: '',
  notePending: false,
}

export async function loadOverview(db: SupabaseClient, workspaceId: string): Promise<{ clients: MockClient[]; tags: MockTag[]; lastSyncedAt: string | null }> {
  const accountsFull =
    'id, client_id, name, status, account_type, balance, spend_month, spend_yesterday, spend_7d, revenue_month, ends_at, runs_continuously, last_change_at, active_adsets, is_watched, last_synced_at, owner_business_name'
  const accountsBasic = 'id, client_id, name, status, account_type, balance, spend_month, is_watched, last_synced_at, owner_business_name'

  const [{ data: clientRows }, { data: tagRows }, { data: linkRows }, accFull] = await Promise.all([
    db.from('clients').select('id, name, status, niche, updated_at').eq('workspace_id', workspaceId).is('archived_at', null).order('name'),
    db.from('tags').select('id, name, color').eq('workspace_id', workspaceId).order('name'),
    db.from('client_tags').select('client_id, tag_id').eq('workspace_id', workspaceId),
    db.from('ad_accounts').select(accountsFull).eq('workspace_id', workspaceId).eq('platform', 'meta'),
  ])
  // Banco sem a migration de integrações: cai para as colunas básicas.
  const accounts = (accFull.error
    ? (await db.from('ad_accounts').select(accountsBasic).eq('workspace_id', workspaceId).eq('platform', 'meta')).data ?? []
    : accFull.data ?? []) as AccountRow[]

  const tags: MockTag[] = (tagRows ?? []).map((t) => ({ id: t.id, name: t.name, color: t.color }))
  const tagById = new Map(tags.map((t) => [t.id, t]))
  const tagsByClient = new Map<string, MockTag[]>()
  for (const l of linkRows ?? []) {
    const tag = tagById.get(l.tag_id)
    if (tag) tagsByClient.set(l.client_id, [...(tagsByClient.get(l.client_id) ?? []), tag])
  }
  const byClient = new Map<string, AccountRow[]>()
  for (const a of accounts) if (a.client_id) byClient.set(a.client_id, [...(byClient.get(a.client_id) ?? []), a])

  const clients: MockClient[] = (clientRows ?? []).map((c: any) =>
    aggregate(
      {
        id: c.id,
        name: c.name,
        segment: c.niche === 'health' ? 'Saúde' : c.niche === 'food' ? 'Food' : '—',
        situation: SITUATION[c.status] ?? 'ativo',
        tags: tagsByClient.get(c.id) ?? [],
        ...EMPTY_OPS,
      },
      byClient.get(c.id) ?? [],
      c.updated_at,
    ),
  )

  // Contas sem cliente vinculado: linha própria (vincule em Contas de anúncio).
  for (const a of accounts.filter((x) => !x.client_id)) {
    clients.push(
      aggregate(
        {
          id: `conta:${a.id}`,
          name: a.name,
          segment: a.owner_business_name ? `Sem cliente · ${a.owner_business_name}` : 'Conta sem cliente vinculado',
          situation: 'onboarding',
          tags: [],
          ...EMPTY_OPS,
        },
        [{ ...a, is_watched: true }],
        a.last_synced_at ?? new Date().toISOString(),
      ),
    )
  }

  for (const c of clients) {
    const h = clientHealth({
      unlinked: c.id.startsWith('conta:'),
      accountsCount: c.accountsCount ?? 0,
      balance: c.balance,
      daysLeft: c.daysLeft,
      termination: c.termination,
    })
    c.health = h.health
    c.healthReason = h.reason
  }

  const synced = accounts.map((a) => a.last_synced_at).filter((v): v is string => !!v).sort()
  return { clients, tags, lastSyncedAt: synced.length ? synced[synced.length - 1]! : null }
}

/** Lista leve para a busca (Ctrl K): só clientes, sem métricas. */
export async function loadClientIndex(db: SupabaseClient, workspaceId: string): Promise<MockClient[]> {
  const { data } = await db.from('clients').select('id, name, status, updated_at').eq('workspace_id', workspaceId).is('archived_at', null).order('name')
  return (data ?? []).map((c: any) => ({
    id: c.id,
    name: c.name,
    segment: '',
    situation: SITUATION[c.status] ?? 'ativo',
    tags: [],
    spendMonth: 0,
    spendYesterday: 0,
    balance: null,
    daysLeft: null,
    termination: null,
    lastChange: c.updated_at,
    alert: false,
    campaignState: 'nao_definido',
    roas: null,
    accountsCount: 0,
    ...EMPTY_OPS,
  }))
}
