'use client'

export const SITUATION_LABEL: Record<string, string> = { ativo: 'Ativo', onboarding: 'Onboarding', stand_by: 'Stand-by', churn: 'Churn' }
export const SITUATION_STYLE: Record<string, string> = {
  ativo: 'border-[#34D399]/40 bg-[#052E1F] text-[#34D399]',
  onboarding: 'border-[#3D8EFF]/40 bg-[#0B1E3A] text-[#6EA8FF]',
  stand_by: 'border-[#8FA0C4]/30 bg-[#111A2E] text-[#8FA0C4]',
  churn: 'border-[#F87171]/40 bg-[#3B0A0A] text-[#F87171]',
}
export const CAMPAIGN_LABEL: Record<string, string> = { nao_definido: '— Estado —', planejamento: 'Planejamento', ativo: 'Ativo', pausado: 'Pausado', encerrado: 'Encerrado' }
export const CREATIVE_LABEL: Record<string, string> = { nao_definido: '— Não definido —', em_producao: 'Em produção', estatico_pronto: 'Estático pronto', video_pronto: 'Vídeo pronto', em_aprovacao: 'Em aprovação' }
export const DELIVERY_LABEL: Record<string, string> = { pendente: '— Entrega —', estatico_pronto: 'Estático pronto', video_pronto: 'Vídeo pronto', sem_criativo: 'Sem criativo', entregue: 'Entregue' }

export type FilterState = {
  q: string
  situation: string
  alert: string
  campaignState: string
  delivery: string
  editor: string
  weekPending: boolean
  period: string
}

export function parseFilter(sp: URLSearchParams): FilterState {
  return {
    q: sp.get('q') ?? '',
    situation: sp.get('situation') ?? '',
    alert: sp.get('alert') ?? '',
    campaignState: sp.get('campaign_state') ?? '',
    delivery: sp.get('delivery') ?? '',
    editor: sp.get('editor') ?? '',
    weekPending: sp.get('week_pending') === '1',
    period: sp.get('period') ?? '',
  }
}

export function toQuery(f: FilterState, month: string): string {
  const p = new URLSearchParams()
  if (f.q) p.set('q', f.q)
  if (f.situation) p.set('situation', f.situation)
  if (f.alert) p.set('alert', f.alert)
  if (f.campaignState) p.set('campaign_state', f.campaignState)
  if (f.delivery) p.set('delivery', f.delivery)
  if (f.editor) p.set('editor', f.editor)
  if (f.weekPending) p.set('week_pending', '1')
  if (f.period) p.set('period', f.period)
  if (month) p.set('month', month)
  return p.toString()
}
