/** Objetivos de análise do cardápio (sem dependência de IA). */
export const GOALS = {
  ticket: 'aumentar o ticket médio (combos, upsell, descrições que valorizam o produto)',
  conversao: 'aumentar a conversão (descrições claras e apetitosas, preços competitivos, nomes fáceis)',
  margem: 'melhorar a margem (ajustes de preço moderados onde houver espaço, combos com bom custo)',
  organizacao: 'organizar e padronizar o cardápio (nomes consistentes, descrições completas, sem erros)',
} as const
export type Goal = keyof typeof GOALS
