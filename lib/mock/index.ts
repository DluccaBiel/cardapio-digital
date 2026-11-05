/**
 * Camada de acesso única da fase visual.
 * Trocar as implementações por Supabase nas próximas fases, sem alterar
 * os componentes — todos consomem apenas estas funções e tipos.
 */
export {
  MOCK_ROUTINE_WEEK,
  MOCK_TAGS_LIST,
  MOCK_WORKSPACE,
  getAdAccounts,
  getClients,
  getPeriodLabels,
  getReportDraft,
} from './data'
export type {
  MockAdAccount,
  MockClient,
  MockCreative,
  MockReportDraft,
  MockTag,
  MockWorkspace,
  Situation,
} from './types'
