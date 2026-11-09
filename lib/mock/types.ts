/**
 * Tipos da camada de demonstração visual.
 * IMPORTANTE: todos os dados em `lib/mock/data.ts` são FICTÍCIOS e servem
 * apenas para a fase visual. Nenhuma chamada ao Supabase é feita por aqui.
 */

export type Situation = 'ativo' | 'onboarding' | 'stand_by' | 'churn'

export type MockTag = {
  id: string
  name: string
  color: string
}

export type MockClient = {
  id: string
  name: string
  segment: string
  situation: Situation
  tags: MockTag[]
  /** Gasto no mês corrente (R$) — soma das contas acompanhadas. */
  spendMonth: number
  /** Gasto de ontem (R$) — linha secundária da coluna. */
  spendYesterday: number
  /** Saldo consolidado; null quando não há conta vinculada. */
  balance: number | null
  /** Dias estimados de saldo (negativo = conta devedora). */
  daysLeft: number | null
  termination: string | null
  lastChange: string
  alert: boolean
  pixPaidAt: string | null
  pixAmount: number | null
  campaignState: 'nao_definido' | 'planejamento' | 'ativo' | 'pausado' | 'encerrado'
  routine: string[]
  creativeStatus: 'nao_definido' | 'em_producao' | 'estatico_pronto' | 'video_pronto' | 'em_aprovacao'
  deliveryState: 'pendente' | 'estatico_pronto' | 'video_pronto' | 'sem_criativo' | 'entregue'
  editor: string
  /** Destaque vermelho no ícone de nota (pendência de rotina). */
  notePending: boolean
}

export type MockAdAccount = {
  id: string
  externalId: string
  name: string | null
  status: 'Ativa' | 'Pausada' | 'Desativada' | 'Pendente'
  type: 'Pré-paga' | 'Cartão'
  balance: number
  spendTotal: number
  lastSync: string
  watched: boolean
  clientId: string | null
  clientName: string | null
  timezone: string
  starred: boolean
  /** BM dona da conta (contas de clientes compartilhadas) — só nos dados reais. */
  ownerBusinessName?: string | null
}

export type MockCreative = {
  id: string
  label: string
  purchases: number
  gradient: string
}

export type MockReportDraft = {
  clientId: string
  clientName: string
  clientSituation: string
  periodLabel: string
  previousPeriodLabel: string
  compare: boolean
  blocks: { general: boolean; byObjective: boolean; topCreatives: boolean; balance: boolean }
  metrics: {
    investment: number
    investmentDelta: number
    reach: number
    reachDelta: number
    purchases: number
    purchasesDelta: number
    costPerPurchase: number
    costPerPurchaseDelta: number
    revenue: number
    roas: number
    impressions: number
    clicks: number
    ctr: number
    cpm: number
    frequency: number
    balance: number
    balanceDays: number
  }
  creatives: MockCreative[]
  whatsappText: string
}

export type MockWorkspace = {
  name: string
  slug: string
}
