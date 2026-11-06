import type { MenuSnapshot } from './schema'

export interface SnapshotItemRef {
  id: string
  name: string
  price: number | null
}

export interface SnapshotDiff {
  added: SnapshotItemRef[]
  removed: SnapshotItemRef[]
  priceChanges: { id: string; name: string; from: number | null; to: number | null }[]
  nameChanges: { id: string; from: string; to: string }[]
  descriptionChanges: { id: string; name: string }[]
  statusChanges: { id: string; name: string; from: string; to: string }[]
  imageChanges: { id: string; name: string; from: boolean; to: boolean }[]
  categoriesAdded: string[]
  categoriesRemoved: string[]
  totalChanges: number
}

export function diffSnapshots(before: MenuSnapshot, after: MenuSnapshot): SnapshotDiff {
  const beforeById = new Map(before.items.map((item) => [item.id, item]))
  const afterById = new Map(after.items.map((item) => [item.id, item]))

  const diff: SnapshotDiff = {
    added: [],
    removed: [],
    priceChanges: [],
    nameChanges: [],
    descriptionChanges: [],
    statusChanges: [],
    imageChanges: [],
    categoriesAdded: [],
    categoriesRemoved: [],
    totalChanges: 0,
  }

  for (const item of after.items) {
    const previous = beforeById.get(item.id)
    if (!previous) {
      diff.added.push({ id: item.id, name: item.name, price: item.price })
      continue
    }
    if (previous.price !== item.price) {
      diff.priceChanges.push({ id: item.id, name: item.name, from: previous.price, to: item.price })
    }
    if (previous.name !== item.name) diff.nameChanges.push({ id: item.id, from: previous.name, to: item.name })
    if (previous.description !== item.description) diff.descriptionChanges.push({ id: item.id, name: item.name })
    if (previous.status !== item.status) {
      diff.statusChanges.push({ id: item.id, name: item.name, from: previous.status, to: item.status })
    }
    if (previous.hasImage !== item.hasImage || previous.imageUrl !== item.imageUrl) {
      diff.imageChanges.push({ id: item.id, name: item.name, from: previous.hasImage, to: item.hasImage })
    }
  }

  for (const item of before.items) {
    if (!afterById.has(item.id)) diff.removed.push({ id: item.id, name: item.name, price: item.price })
  }

  const beforeCategories = new Set(before.categories.map((category) => category.name))
  const afterCategories = new Set(after.categories.map((category) => category.name))
  diff.categoriesAdded = after.categories.filter((category) => !beforeCategories.has(category.name)).map((category) => category.name)
  diff.categoriesRemoved = before.categories.filter((category) => !afterCategories.has(category.name)).map((category) => category.name)

  diff.totalChanges =
    diff.added.length +
    diff.removed.length +
    diff.priceChanges.length +
    diff.nameChanges.length +
    diff.statusChanges.length +
    diff.imageChanges.length +
    diff.categoriesAdded.length +
    diff.categoriesRemoved.length
  return diff
}

/** Itens cujo id não veio do portal (não podem ser alvo de escrita). */
export function isSyntheticItemId(id: string): boolean {
  return id.startsWith('synth_') || id.startsWith('dom_')
}
