import type { ActionType } from './schema'

export type RunMode = 'apply' | 'dry-run' | 'undo'
export type RunEntryStatus = 'ok' | 'erro' | 'pulada'

export interface RunEntry {
  actionId: string
  tipo: ActionType | 'undo'
  status: RunEntryStatus
  message: string
  httpStatus: number | null
  at: string
  /** Valores antes/depois efetivamente usados (sem dados sensíveis). */
  before: unknown
  after: unknown
}

export interface RunResult {
  id: string
  mode: RunMode
  startedAt: string
  finishedAt: string | null
  merchantName: string | null
  entries: RunEntry[]
  verificationErrors: string[]
  stopped: string | null
}

export function emptyRun(mode: RunMode, merchantName: string | null): RunResult {
  return {
    id: `run_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    mode,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    merchantName,
    entries: [],
    verificationErrors: [],
    stopped: null,
  }
}
