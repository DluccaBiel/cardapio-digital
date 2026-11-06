import type {
  ActionPlan,
  ActionType,
  AnalysisContext,
  ComboSuggestion,
  ComboSpec,
  Finding,
  MenuItem,
  MenuSnapshot,
  PlanAction,
} from './schema'
import { PLAN_SCHEMA_VERSION } from './schema'
import { summarizeSnapshotForAi } from './rules'
import { isSyntheticItemId } from './snapshots'

export const ACTION_LABELS: Record<ActionType, string> = {
  update_name: 'Nome',
  update_description: 'Descrição',
  update_price: 'Preço',
  set_status: 'Status',
  reorder_category: 'Ordem de categoria',
  create_combo: 'Novo combo',
  update_image: 'Imagem',
  note: 'Observação',
}

export const RISK_LABELS = { baixo: 'Baixo', medio: 'Médio', alto: 'Alto' } as const

export function itemById(snapshot: MenuSnapshot, id: string): MenuItem | null {
  return snapshot.items.find((item) => item.id === id) ?? null
}

export function comboFromSuggestion(suggestion: ComboSuggestion, snapshot: MenuSnapshot): ComboSpec {
  return {
    name: suggestion.name,
    description: `Combo com ${suggestion.componentNames.join(', ')}.`,
    components: suggestion.componentIds.map((itemId, index) => ({
      itemId,
      quantity: suggestion.componentQuantities[index] ?? 1,
    })),
    price: suggestion.price,
    discountPercent: suggestion.discountPercent,
    paused: true,
  }
}

export function buildComboAction(suggestion: ComboSuggestion, snapshot: MenuSnapshot): PlanAction {
  const combo = comboFromSuggestion(suggestion, snapshot)
  return {
    id: `combo_${suggestion.id}`,
    tipo: 'create_combo',
    alvo: {},
    antes: null,
    depois: combo,
    justificativa: `${suggestion.explanation} Combo nasce pausado para revisão e publicação manual.`,
    risco: 'medio',
    prioridade: 2,
  }
}

export function planCountsByType(plan: ActionPlan | null): Record<ActionType, number> {
  const counts = Object.fromEntries(Object.keys(ACTION_LABELS).map((key) => [key, 0])) as Record<ActionType, number>
  plan?.actions.forEach((action) => {
    counts[action.tipo] += 1
  })
  return counts
}

export function planCountsByRisk(plan: ActionPlan | null): Record<'baixo' | 'medio' | 'alto', number> {
  const counts = { baixo: 0, medio: 0, alto: 0 }
  plan?.actions.forEach((action) => {
    counts[action.risco] += 1
  })
  return counts
}

export function defaultSelectedIds(plan: ActionPlan | null): string[] {
  return plan ? plan.actions.filter((action) => action.risco !== 'alto').map((action) => action.id) : []
}

export function selectedActions(plan: ActionPlan | null, selected: Set<string>): PlanAction[] {
  return plan ? plan.actions.filter((action) => selected.has(action.id)) : []
}

export interface TicketEstimate {
  actionId: string
  label: string
  detail: string
}

/** Estimativas factuais (sem inventar vendas/margens). */
export function estimateImpact(plan: ActionPlan | null, snapshot: MenuSnapshot | null): TicketEstimate[] {
  if (!plan) return []
  const estimates: TicketEstimate[] = []
  for (const action of plan.actions) {
    if (action.tipo === 'create_combo' && isCombo(action.depois)) {
      const combo = action.depois
      const componentsTotal = combo.components.reduce((sum, component) => {
        const item = snapshot?.items.find((entry) => entry.id === component.itemId)
        return sum + (item?.price ?? 0) * component.quantity
      }, 0)
      const discount = componentsTotal > 0 ? (1 - combo.price / componentsTotal) * 100 : combo.discountPercent
      estimates.push({
        actionId: action.id,
        label: combo.name,
        detail: `Preço R$ ${combo.price.toFixed(2)} · soma dos itens R$ ${componentsTotal.toFixed(2)} · desconto aplicado ${discount.toFixed(1)}%.`,
      })
    }
    if (action.tipo === 'update_price' && typeof action.antes === 'number' && typeof action.depois === 'number') {
      const delta = action.depois - action.antes
      const pct = action.antes > 0 ? (delta / action.antes) * 100 : 0
      estimates.push({
        actionId: action.id,
        label: snapshot?.items.find((entry) => entry.id === action.alvo.itemId)?.name ?? action.alvo.itemName ?? action.id,
        detail: `R$ ${action.antes.toFixed(2)} → R$ ${action.depois.toFixed(2)} (${delta >= 0 ? '+' : ''}${pct.toFixed(1)}%).`,
      })
    }
  }
  return estimates
}

export function isCombo(value: unknown): value is ComboSpec {
  return typeof value === 'object' && value !== null && 'components' in value && 'price' in value && 'paused' in value
}

function stripFences(text: string): string {
  const trimmed = text.trim()
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return fence?.[1] ?? trimmed
}

export function parsePlanJson(text: string): { value: unknown | null; error: string | null } {
  if (!text.trim()) return { value: null, error: 'Cole o JSON do plano.' }
  try {
    return { value: JSON.parse(stripFences(text)), error: null }
  } catch (error) {
    return { value: null, error: `JSON inválido: ${error instanceof Error ? error.message : 'erro de sintaxe'}` }
  }
}

export function makePlan(actions: PlanAction[], snapshot: MenuSnapshot | null, summary: string): ActionPlan {
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    merchant: snapshot?.merchant ?? null,
    createdAt: new Date().toISOString(),
    summary,
    actions,
  }
}

export function actionTargetName(action: PlanAction, snapshot: MenuSnapshot | null): string {
  if (action.tipo === 'create_combo' && isCombo(action.depois)) return action.depois.name
  if (action.tipo === 'reorder_category') {
    return snapshot?.categories.find((category) => category.id === action.alvo.categoryId)?.name ?? action.alvo.categoryId ?? '—'
  }
  const item = snapshot && action.alvo.itemId ? itemById(snapshot, action.alvo.itemId) : null
  return item?.name ?? action.alvo.itemName ?? action.alvo.itemId ?? '—'
}

export function beforeAfterText(action: PlanAction): { before: string; after: string } {
  if (action.tipo === 'create_combo' && isCombo(action.depois)) {
    return {
      before: '—',
      after: `${action.depois.name} · R$ ${action.depois.price.toFixed(2)} · ${action.depois.components.length} itens · pausado`,
    }
  }
  if (action.tipo === 'update_price') {
    return {
      before: typeof action.antes === 'number' ? `R$ ${action.antes.toFixed(2)}` : '—',
      after: typeof action.depois === 'number' ? `R$ ${action.depois.toFixed(2)}` : '—',
    }
  }
  if (action.tipo === 'set_status') {
    return { before: String(action.antes ?? '—'), after: String(action.depois ?? '—') }
  }
  if (action.tipo === 'reorder_category') {
    return { before: String(action.antes ?? '—'), after: String(action.depois ?? '—') }
  }
  return {
    before: typeof action.antes === 'string' ? action.antes : JSON.stringify(action.antes ?? '—'),
    after: typeof action.depois === 'string' ? action.depois : JSON.stringify(action.depois ?? '—'),
  }
}

export function actionsWithUnsupportedItems(actions: PlanAction[], snapshot: MenuSnapshot | null): PlanAction[] {
  if (!snapshot) return actions
  return actions.filter((action) => {
    if (action.tipo === 'create_combo' && isCombo(action.depois)) {
      return action.depois.components.some((component) => isSyntheticItemId(component.itemId))
    }
    const id = action.alvo.itemId ?? ''
    return id !== '' && isSyntheticItemId(id)
  })
}

export function buildAiPrompt(
  context: AnalysisContext,
  snapshot: MenuSnapshot,
  findings: Finding[],
  combos: ComboSuggestion[],
): string {
  const menu = summarizeSnapshotForAi(snapshot)
  return [
    'Você é especialista em cardápios de delivery no iFood. Analise o cardápio abaixo e devolva SOMENTE JSON válido, sem markdown.',
    '',
    'CONTEXTO INFORMADO PELO GESTOR:',
    JSON.stringify({ ...context, niche: context.niche === 'outro' ? context.nicheOther : context.niche }, null, 2),
    '',
    'ACHADOS DAS REGRAS LOCAIS (não repita se não ajudar):',
    JSON.stringify(findings.map((finding) => ({ tipo: finding.tipo, severidade: finding.severidade, titulo: finding.titulo, sugestao: finding.sugestao })), null, 2),
    '',
    'COMBOS JÁ SUGERIDOS PELAS REGRAS (use como referência, não invente preços):',
    JSON.stringify(combos, null, 2),
    '',
    'CARDÁPIO (dados do cliente; não inclua dados pessoais):',
    JSON.stringify(menu, null, 2),
    '',
    'FORMATO OBRIGATÓRIO DA RESPOSTA (ActionPlan v1):',
    JSON.stringify(
      {
        schemaVersion: 1,
        merchant: snapshot.merchant,
        createdAt: '<ISO-8601>',
        summary: '<resumo curto>',
        actions: [
          {
            id: 'act_1',
            tipo: 'update_name | update_description | update_price | set_status | reorder_category | create_combo | update_image | note',
            alvo: { itemId: '<id existente>', categoryId: '<id existente quando aplicável>' },
            antes: '<valor atual conforme cardápio>',
            depois: '<novo valor>',
            justificativa: '<por que>',
            risco: 'baixo | medio | alto',
            prioridade: 1,
          },
        ],
      },
      null,
      2,
    ),
    '',
    'REGRAS:',
    '- Use apenas IDs existentes no cardápio acima. Ações com IDs inexistentes serão rejeitadas.',
    '- Não invente margens, custos ou preços. Para combos, calcule a partir da soma dos itens e do desconto informado pelo gestor.',
    '- create_combo: depois = { name, description, components: [{ itemId, quantity }], price, discountPercent, paused: true }. Combos SEMPRE pausados.',
    '- Não proponha apagar itens ou categorias.',
    '- update_price exige antes (número) e depois (número).',
    '- Prioridade de 1 a 5, sendo 1 a mais alta.',
    '- Responda apenas o JSON.',
  ].join('\n')
}
