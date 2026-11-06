import type {
  AnalysisContext,
  ComboSuggestion,
  Finding,
  MenuItem,
  MenuSnapshot,
  RiskLevel,
} from './schema'
import { isSyntheticItemId } from './snapshots'

export const NICHES: { value: string; label: string }[] = [
  { value: 'hamburgueria', label: 'Hamburgueria' },
  { value: 'pizzaria', label: 'Pizzaria' },
  { value: 'japones', label: 'Japonês' },
  { value: 'marmitaria', label: 'Marmitaria / self-service' },
  { value: 'acai', label: 'Açaí / sobremesas' },
  { value: 'lanches', label: 'Lanches' },
  { value: 'doces', label: 'Doces / confeitaria' },
  { value: 'pet', label: 'Pet' },
  { value: 'farmacia', label: 'Farmácia' },
  { value: 'mercado', label: 'Mercado' },
  { value: 'bebidas', label: 'Bebidas' },
  { value: 'outro', label: 'Outro' },
]

export const GOALS: { value: AnalysisContext['goal']; label: string }[] = [
  { value: 'ticket', label: 'Aumentar ticket médio' },
  { value: 'conversao', label: 'Melhorar conversão' },
  { value: 'margem', label: 'Proteger margem' },
  { value: 'volume', label: 'Aumentar volume' },
]

const NICHE_MAIN_KEYWORDS: Record<string, string[]> = {
  hamburgueria: ['burger', 'hambur', 'cheese', 'smash', 'lanche'],
  pizzaria: ['pizza', 'pizza', 'calabresa', 'marguerita', 'margherita'],
  japones: ['sushi', 'sashimi', 'combinado', 'temaki', 'hot roll', 'yakisoba'],
  marmitaria: ['marmita', 'marmitex', 'prato', 'executivo', 'self'],
  acai: ['açaí', 'acai', 'açai', 'sorvete', 'milkshake', 'sobremesa'],
  lanches: ['lanche', 'sanduíche', 'sanduiche', 'hot dog', 'x-', 'burguer', 'burger'],
  doces: ['bolo', 'doce', 'brigadeiro', 'torta', 'cupcake', 'confeitaria'],
  pet: ['ração', 'racao', 'petisco', 'sachê', 'sache', 'brinquedo'],
  farmacia: ['medicamento', 'remédio', 'remedio', 'higiene', 'dermo', 'vitamina'],
  mercado: ['cesta', 'kit', 'hortifruti', 'mercearia', 'bebida'],
  bebidas: ['cerveja', 'drink', 'suco', 'refrigerante', 'vinho', 'energético'],
}

const DRINK_RE = /bebida|drink|suco|refrigerante|cerveja|vinho|água|agua|energ[eé]tico|chá|cha|caf[eé]|milkshake/i
const SIDE_RE = /acompanhamento|adicional|por[cç][aã]o|batata|frita|salada|sobremesa|doce|entrada/i
const COMBO_RE = /combo|kit|fam[ií]lia|dupla|promo[cç][aã]o/i

function percent(part: number, total: number): number {
  return total > 0 ? (part / total) * 100 : 0
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
  return sorted[middle] ?? null
}

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function listNames(items: MenuItem[], max = 6): string {
  const names = items.slice(0, max).map((item) => `“${item.name}”`)
  return items.length > max ? `${names.join(', ')} e mais ${items.length - max}` : names.join(', ')
}

function severityFromRatio(value: number, highThreshold: number): RiskLevel {
  return value >= highThreshold ? 'alto' : value >= highThreshold / 2 ? 'medio' : 'baixo'
}

export function runRules(snapshot: MenuSnapshot, context: AnalysisContext): Finding[] {
  const findings: Finding[] = []
  const ignored = new Set(context.doNotTouchItemIds)
  const scopedItems = snapshot.items.filter((item) => !ignored.has(item.id))
  const active = scopedItems.filter((item) => item.status !== 'paused')
  const priced = active.filter((item) => item.price !== null && item.price > 0)

  const push = (
    id: string,
    tipo: string,
    severidade: RiskLevel,
    titulo: string,
    evidencia: string,
    sugestao: string,
    itemIds: string[] = [],
    categoryIds: string[] = [],
  ): void => {
    findings.push({ id, tipo, severidade, titulo, evidencia, sugestao, itemIds, categoryIds })
  }

  const noPhoto = active.filter((item) => !item.hasImage)
  if (noPhoto.length > 0) {
    push(
      'photo_missing',
      'imagem',
      severityFromRatio(percent(noPhoto.length, Math.max(1, active.length)), 60),
      'Itens sem foto',
      `${noPhoto.length} de ${active.length} itens ativos sem foto (${Math.round(percent(noPhoto.length, Math.max(1, active.length)))}%): ${listNames(noPhoto)}.`,
      'Fotografar os itens de maior saída primeiro. Foto é o fator de conversão mais direto no cardápio.',
      noPhoto.map((item) => item.id),
    )
  }

  const emptyDescription = active.filter((item) => item.description.trim() === '')
  if (emptyDescription.length > 0) {
    push(
      'description_empty',
      'descricao',
      severityFromRatio(percent(emptyDescription.length, Math.max(1, active.length)), 50),
      'Itens sem descrição',
      `${emptyDescription.length} item(ns) ativos sem descrição: ${listNames(emptyDescription)}.`,
      'Escrever 1–2 linhas com ingredientes, tamanho e diferencial. Evitar repetir o nome do item.',
      emptyDescription.map((item) => item.id),
    )
  }

  const shortDescription = active.filter((item) => {
    const length = item.description.trim().length
    return length > 0 && length < 25
  })
  if (shortDescription.length > 0) {
    push(
      'description_short',
      'descricao',
      'baixo',
      'Descrições muito curtas',
      `${shortDescription.length} item(ns) com descrição abaixo de 25 caracteres: ${listNames(shortDescription)}.`,
      'Ampliar para algo entre 60 e 160 caracteres, com benefício claro para o cliente.',
      shortDescription.map((item) => item.id),
    )
  }

  const longDescription = active.filter((item) => item.description.trim().length > 300)
  if (longDescription.length > 0) {
    push(
      'description_long',
      'descricao',
      'baixo',
      'Descrições muito longas',
      `${longDescription.length} item(ns) com mais de 300 caracteres: ${listNames(longDescription)}.`,
      'Encurtar para 300 caracteres no máximo; o excesso costuma ser cortado na listagem.',
      longDescription.map((item) => item.id),
    )
  }

  const generic = active.filter((item) => /^(item|produto|teste|novo item|sem nome)\b/i.test(item.name.trim()))
  if (generic.length > 0) {
    push(
      'name_generic',
      'nome',
      'medio',
      'Nomes genéricos',
      `Nomes como “Item”, “Produto” ou “Teste”: ${listNames(generic)}.`,
      'Trocar por nome comercial + diferencial (ex.: “Smash Duplo 180g”).',
      generic.map((item) => item.id),
    )
  }

  const uppercase = active.filter((item) => {
    const letters = item.name.replace(/[^A-Za-zÀ-ÿ]/g, '')
    return letters.length >= 4 && letters === letters.toUpperCase() && /[A-ZÀ-Þ]/.test(letters)
  })
  if (uppercase.length > 0) {
    push(
      'name_uppercase',
      'nome',
      'baixo',
      'Nomes em caixa alta',
      `${uppercase.length} item(ns) com nome todo em maiúsculas: ${listNames(uppercase)}.`,
      'Usar caixa mista (Title Case). Caixa alta em excesso reduz legibilidade.',
      uppercase.map((item) => item.id),
    )
  }

  const abbreviated = active.filter((item) => /\b(qtd|und?|pct|ref|aprox|p\/|c\/|s\/)\b/i.test(item.name))
  if (abbreviated.length > 0) {
    push(
      'name_abbrev',
      'nome',
      'baixo',
      'Abreviações no nome',
      `${abbreviated.length} item(ns) com abreviações: ${listNames(abbreviated)}.`,
      'Escrever por extenso. Abreviações atrapalham busca e leitura.',
      abbreviated.map((item) => item.id),
    )
  }

  const byNormalized = new Map<string, MenuItem[]>()
  for (const item of active) {
    const key = normalizeName(item.name)
    if (!byNormalized.has(key)) byNormalized.set(key, [])
    byNormalized.get(key)!.push(item)
  }
  const duplicates = [...byNormalized.values()].filter((group) => group.length > 1).flat()
  if (duplicates.length > 0) {
    push(
      'name_duplicate',
      'nome',
      'alto',
      'Nomes duplicados ou equivalentes',
      `Itens com o mesmo nome normalizado: ${listNames(duplicates)}.`,
      'Diferenciar tamanho, sabor ou composição no nome para evitar confusão e erro de pedido.',
      duplicates.map((item) => item.id),
    )
  }

  const smallCategories = snapshot.categories.filter((category) => category.itemIds.length > 0 && category.itemIds.length < 3)
  if (smallCategories.length > 0) {
    push(
      'category_small',
      'categoria',
      'baixo',
      'Categorias com poucos itens',
      smallCategories.map((category) => `${category.name} (${category.itemIds.length})`).join(', '),
      'Agrupar com categoria próxima ou completar com entradas/acompanhamentos.',
      [],
      smallCategories.map((category) => category.id),
    )
  }

  const largeCategories = snapshot.categories.filter((category) => category.itemIds.length > 25)
  if (largeCategories.length > 0) {
    push(
      'category_large',
      'categoria',
      'baixo',
      'Categorias com muitos itens',
      largeCategories.map((category) => `${category.name} (${category.itemIds.length})`).join(', '),
      'Dividir em subcategorias para facilitar a navegação.',
      [],
      largeCategories.map((category) => category.id),
    )
  }

  const firstCategories = snapshot.categories.slice(0, 2)
  if (!firstCategories.some((category) => COMBO_RE.test(category.name)) && active.length >= 5) {
    push(
      'category_order',
      'estrutura',
      'medio',
      'Combos e promoções fora do topo',
      `Ordem atual: ${snapshot.categories.slice(0, 5).map((category) => category.name).join(' → ')}.`,
      'Colocar uma categoria de combos/promoções entre as duas primeiras. É a posição de maior visibilidade.',
      [],
      snapshot.categories.slice(0, 2).map((category) => category.id),
    )
  }

  if (!context.doNotTouchPrices) {
    for (const category of snapshot.categories) {
      const items = priced.filter((item) => item.categoryId === category.id)
      if (items.length < 3) continue
      const med = median(items.map((item) => item.price as number))
      if (med === null || med <= 0) continue
      const outliers = items.filter((item) => {
        const price = item.price as number
        return price > med * 2.2 || price < med * 0.35
      })
      if (outliers.length > 0) {
        push(
          `price_outlier_${category.id}`,
          'preco',
          'medio',
          `Preços fora do padrão em ${category.name}`,
          `Mediana da categoria: R$ ${med.toFixed(2)}. Fora do padrão: ${listNames(outliers)}.`,
          'Revisar posicionamento: preço muito acima pode reduzir conversão; muito abaixo pode puxar a percepção de valor.',
          outliers.map((item) => item.id),
          [category.id],
        )
      }
    }

    if (priced.length >= 4) {
      const prices = [...new Set(priced.map((item) => item.price as number))].sort((a, b) => a - b)
      const med = median(prices)
      if (med !== null && med > 0 && prices.length >= 3) {
        let biggestGap = 0
        let gapFrom = 0
        let gapTo = 0
        for (let index = 1; index < prices.length; index += 1) {
          const from = prices[index - 1] ?? 0
          const to = prices[index] ?? 0
          const gap = to - from
          if (gap / med > biggestGap) {
            biggestGap = gap / med
            gapFrom = from
            gapTo = to
          }
        }
        if (biggestGap > 0.6) {
          push(
            'price_gap',
            'preco',
            'baixo',
            'Degraus de preço mal distribuídos',
            `Maior salto: R$ ${gapFrom.toFixed(2)} → R$ ${gapTo.toFixed(2)} (${Math.round(biggestGap * 100)}% da mediana).`,
            'Criar uma opção intermediária ou um item de entrada para suavizar a escada de preços.',
          )
        }
      }
    }
  }

  const noComplements = active.filter((item) => item.complements.length === 0 && !COMBO_RE.test(item.name))
  if (noComplements.length > 0 && percent(noComplements.length, Math.max(1, active.length)) >= 60) {
    push(
      'complements_missing',
      'upsell',
      'medio',
      'Oportunidade de complementos',
      `${noComplements.length} de ${active.length} itens ativos sem grupos de complementos.`,
      'Adicionar acompanhamentos e bebidas como complementos pagos nos itens principais para elevar o ticket.',
      noComplements.map((item) => item.id),
    )
  }

  const paused = scopedItems.filter((item) => item.status === 'paused')
  if (paused.length > 0) {
    const old = paused.filter((item) => {
      if (!item.updatedAt) return false
      const timestamp = Date.parse(item.updatedAt)
      return Number.isFinite(timestamp) && Date.now() - timestamp > 30 * 24 * 60 * 60 * 1000
    })
    push(
      'paused_items',
      'status',
      old.length > 0 ? 'alto' : 'baixo',
      'Itens pausados',
      `${paused.length} item(ns) pausados: ${listNames(paused)}.${old.length > 0 ? ` ${old.length} estão pausados há mais de 30 dias.` : ' A idade não veio no snapshot para os demais.'}`,
      'Revisar se devem voltar ao cardápio ou ser atualizados antes de reativar.',
      paused.map((item) => item.id),
    )
  }

  const hasCombo = snapshot.items.some((item) => COMBO_RE.test(item.name)) || snapshot.categories.some((category) => COMBO_RE.test(category.name))
  if (!hasCombo && active.length >= 4) {
    push(
      'no_combos',
      'estrutura',
      'medio',
      'Nenhum combo detectado',
      'Não há item ou categoria com “combo”, “kit” ou “promoção” no nome.',
      'Criar combos prato + bebida (+ acompanhamento/sobremesa) com preço calculado a partir dos itens existentes e desconto definido por você.',
    )
  }

  if (priced.length >= 3) {
    const med = median(priced.map((item) => item.price as number))
    if (med !== null && med > 0) {
      const entry = priced.filter((item) => (item.price as number) <= med * 0.5)
      if (entry.length === 0) {
        push(
          'no_entry_price',
          'preco',
          'baixo',
          'Falta de item de entrada',
          `Nenhum item ativo custa até R$ ${(med * 0.5).toFixed(2)} (metade da mediana de R$ ${med.toFixed(2)}).`,
          'Criar uma entrada de baixo preço (adicional, porção pequena ou bebida) para reduzir a barreira do primeiro pedido.',
        )
      }
    }
  }

  return findings
}

function pickByKeywords(snapshot: MenuSnapshot, keywords: string[]): MenuItem[] {
  const matched = snapshot.items.filter((item) => {
    if (item.status === 'paused' || item.price === null || item.price <= 0) return false
    const haystack = `${item.name} ${item.categoryName ?? ''}`.toLowerCase()
    return keywords.some((keyword) => haystack.includes(keyword))
  })
  return matched.sort((a, b) => (a.price ?? 0) - (b.price ?? 0))
}

function usable(item: MenuItem | undefined): item is MenuItem {
  return Boolean(item && item.status !== 'paused' && item.price !== null && item.price > 0 && !isSyntheticItemId(item.id))
}

export function suggestCombos(snapshot: MenuSnapshot, context: AnalysisContext): ComboSuggestion[] {
  const discount = Math.min(50, Math.max(0, context.comboDiscountPercent || 0))
  const keywords = NICHE_MAIN_KEYWORDS[context.niche] ?? []
  let mains = pickByKeywords(snapshot, keywords).filter(usable)
  if (mains.length === 0) {
    mains = snapshot.items
      .filter(usable)
      .filter((item) => !DRINK_RE.test(`${item.name} ${item.categoryName ?? ''}`))
      .sort((a, b) => (b.price ?? 0) - (a.price ?? 0))
  }
  const drinks = snapshot.items
    .filter(usable)
    .filter((item) => DRINK_RE.test(`${item.name} ${item.categoryName ?? ''}`))
    .sort((a, b) => (a.price ?? 0) - (b.price ?? 0))
  const sides = snapshot.items
    .filter(usable)
    .filter((item) => SIDE_RE.test(`${item.name} ${item.categoryName ?? ''}`) && !drinks.includes(item))
    .sort((a, b) => (a.price ?? 0) - (b.price ?? 0))

  const suggestions: ComboSuggestion[] = []
  const make = (id: string, components: { item: MenuItem; quantity: number }[], suffix?: string): void => {
    if (components.length < 2) return
    const total = components.reduce((sum, component) => sum + (component.item.price as number) * component.quantity, 0)
    if (total <= 0) return
    const price = Math.round(total * (1 - discount / 100) * 100) / 100
    if (price <= 0) return
    const names = components.map((component) => `${component.quantity > 1 ? `${component.quantity}× ` : ''}${component.item.name}`)
    if (suggestions.some((suggestion) => suggestion.componentIds.join('|') === components.map((component) => component.item.id).join('|'))) return
    const explanation = `Soma dos itens: R$ ${total.toFixed(2)} − ${discount}% = R$ ${price.toFixed(2)}.`
    suggestions.push({
      id,
      name: `Combo ${components.map((component) => component.item.name).slice(0, 2).join(' + ')}${suffix ? ` ${suffix}` : ''}`,
      componentIds: components.map((component) => component.item.id),
      componentNames: names,
      componentQuantities: components.map((component) => component.quantity),
      componentsTotal: Math.round(total * 100) / 100,
      discountPercent: discount,
      price,
      explanation,
    })
  }

  const main = mains[0]
  const main2 = mains.find((item) => item.id !== main?.id)
  const drink = drinks[0]
  const side = sides[0]

  if (main && drink) {
    make('combo_pair', [
      { item: main, quantity: 1 },
      { item: drink, quantity: 1 },
    ])
  }
  if (main && drink && (side || main2)) {
    const third = side ?? main2!
    make('combo_trio', [
      { item: main, quantity: 1 },
      { item: drink, quantity: 1 },
      { item: third, quantity: 1 },
    ])
  }
  if (main && main2 && drink) {
    make('combo_family', [
      { item: main, quantity: 1 },
      { item: main2, quantity: 1 },
      { item: drink, quantity: 2 },
    ], 'Família')
  }

  return suggestions
}

export function summarizeSnapshotForAi(snapshot: MenuSnapshot): Record<string, unknown> {
  return {
    merchant: snapshot.merchant,
    capturedAt: snapshot.capturedAt,
    categories: snapshot.categories.map((category) => ({
      id: category.id,
      name: category.name,
      position: category.position,
      itemCount: category.itemIds.length,
    })),
    items: snapshot.items.map((item) => ({
      id: item.id,
      name: item.name,
      description: item.description,
      price: item.price,
      originalPrice: item.originalPrice,
      status: item.status,
      hasImage: item.hasImage,
      categoryId: item.categoryId,
      categoryName: item.categoryName,
      complementGroups: item.complements.map((group) => ({ name: group.name, optionCount: group.options.length })),
    })),
  }
}
