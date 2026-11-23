import type { ProspectLead } from '../db/disparos'

export type SdrSearchView = {
  id: string
  status: 'pendente' | 'buscando' | 'concluida' | 'erro'
  city: string
  uf: string | null
  label: string | null
  found: number
  created_count: number
  detail: string | null
}

export type SdrLeadView = ProspectLead & {
  icpScore: number
  icpBand: string
  icpEvidencias: string[]
}

