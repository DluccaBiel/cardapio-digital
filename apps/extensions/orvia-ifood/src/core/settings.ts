export interface AiConfig {
  enabled: boolean
  baseUrl: string
  model: string
}

export interface Settings {
  /** Ritmo mínimo entre chamadas de escrita (ms). Nunca abaixo de 700. */
  pauseMs: number
  /** Alerta de variação de preço (%) na conferência. */
  priceWarnPct: number
  /** Bloqueio de variação de preço (%) que exige confirmação dupla. */
  priceBlockPct: number
  /** Incluir valores de exemplo (redigidos) na descoberta. */
  includeExamples: boolean
  ai: AiConfig
}

export const MIN_PAUSE_MS = 700

export const DEFAULT_SETTINGS: Settings = {
  pauseMs: 900,
  priceWarnPct: 15,
  priceBlockPct: 40,
  includeExamples: false,
  ai: {
    enabled: false,
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4.1-mini',
  },
}

export function clampSettings(input: Partial<Settings> | null | undefined): Settings {
  const source = input ?? {}
  const pauseMs = Number.isFinite(source.pauseMs) ? Math.max(MIN_PAUSE_MS, Math.round(source.pauseMs as number)) : DEFAULT_SETTINGS.pauseMs
  const priceWarnPct = Number.isFinite(source.priceWarnPct)
    ? Math.min(90, Math.max(1, source.priceWarnPct as number))
    : DEFAULT_SETTINGS.priceWarnPct
  const priceBlockPct = Number.isFinite(source.priceBlockPct)
    ? Math.min(95, Math.max(priceWarnPct + 1, source.priceBlockPct as number))
    : Math.max(DEFAULT_SETTINGS.priceBlockPct, priceWarnPct + 1)
  return {
    pauseMs,
    priceWarnPct,
    priceBlockPct,
    includeExamples: Boolean(source.includeExamples),
    ai: {
      enabled: Boolean(source.ai?.enabled),
      baseUrl: typeof source.ai?.baseUrl === 'string' && source.ai.baseUrl.trim() ? source.ai.baseUrl.trim() : DEFAULT_SETTINGS.ai.baseUrl,
      model: typeof source.ai?.model === 'string' && source.ai.model.trim() ? source.ai.model.trim() : DEFAULT_SETTINGS.ai.model,
    },
  }
}

export function normalizeOrigin(baseUrl: string): string | null {
  try {
    const url = new URL(baseUrl)
    if (url.protocol !== 'https:') return null
    return `${url.origin}/*`
  } catch {
    return null
  }
}
