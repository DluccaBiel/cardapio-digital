import type { ActionPlan, DiscoveryEntry, MenuSnapshot } from '../core/schema'
import { snapshotFingerprint } from '../core/normalize'
import { clampSettings, DEFAULT_SETTINGS, type Settings } from '../core/settings'
import type { RunResult } from '../core/run-types'

const KEYS = {
  settings: 'orvia.settings',
  snapshots: 'orvia.snapshots',
  discovery: 'orvia.discovery',
  planDraft: 'orvia.planDraft',
  lastRun: 'orvia.lastRun',
  aiKey: 'orvia.ai.key',
} as const

const MAX_SNAPSHOTS = 30
const MAX_DISCOVERY = 400

const memory = new Map<string, unknown>()

type AreaName = 'local' | 'session'

function getArea(name: AreaName): chrome.storage.StorageArea | null {
  try {
    return globalThis.chrome?.storage?.[name] ?? null
  } catch {
    return null
  }
}

async function readValue<T>(areaName: AreaName, key: string, fallback: T): Promise<T> {
  const area = getArea(areaName)
  if (!area) return (memory.get(`${areaName}:${key}`) as T | undefined) ?? fallback
  try {
    const result = await area.get(key)
    const value = result[key]
    return value === undefined ? fallback : (value as T)
  } catch {
    return fallback
  }
}

async function writeValue(areaName: AreaName, key: string, value: unknown): Promise<void> {
  const area = getArea(areaName)
  if (!area) {
    memory.set(`${areaName}:${key}`, value)
    return
  }
  await area.set({ [key]: value })
}

async function removeValue(areaName: AreaName, key: string): Promise<void> {
  const area = getArea(areaName)
  if (!area) {
    memory.delete(`${areaName}:${key}`)
    return
  }
  await area.remove(key)
}

export async function loadSettings(): Promise<Settings> {
  const stored = await readValue<Partial<Settings> | null>('local', KEYS.settings, null)
  return clampSettings(stored ?? DEFAULT_SETTINGS)
}

export async function saveSettings(settings: Settings): Promise<Settings> {
  const clamped = clampSettings(settings)
  await writeValue('local', KEYS.settings, clamped)
  return clamped
}

export async function listSnapshots(): Promise<MenuSnapshot[]> {
  const stored = await readValue<MenuSnapshot[]>('local', KEYS.snapshots, [])
  return Array.isArray(stored) ? stored : []
}

export async function getSnapshot(id: string): Promise<MenuSnapshot | null> {
  const list = await listSnapshots()
  return list.find((snapshot) => snapshot.id === id) ?? null
}

/** Salva com deduplicação pelo conteúdo e limite de versões. */
export async function saveSnapshot(snapshot: MenuSnapshot): Promise<{ saved: boolean; snapshots: MenuSnapshot[] }> {
  const stored = await listSnapshots()
  const fingerprint = snapshotFingerprint(snapshot)
  const latest = stored[0]
  if (latest && snapshotFingerprint(latest) === fingerprint && latest.merchant.name === snapshot.merchant.name) {
    return { saved: false, snapshots: stored }
  }
  const next = [snapshot, ...stored.filter((entry) => entry.id !== snapshot.id)].slice(0, MAX_SNAPSHOTS)
  await writeValue('local', KEYS.snapshots, next)
  return { saved: true, snapshots: next }
}

export async function deleteSnapshot(id: string): Promise<MenuSnapshot[]> {
  const next = (await listSnapshots()).filter((snapshot) => snapshot.id !== id)
  await writeValue('local', KEYS.snapshots, next)
  return next
}

export async function listDiscovery(): Promise<DiscoveryEntry[]> {
  const stored = await readValue<DiscoveryEntry[]>('session', KEYS.discovery, [])
  return Array.isArray(stored) ? stored : []
}

export async function addDiscoveryEntries(entries: DiscoveryEntry[]): Promise<DiscoveryEntry[]> {
  if (entries.length === 0) return listDiscovery()
  const current = await listDiscovery()
  const next = [...entries, ...current].slice(0, MAX_DISCOVERY)
  await writeValue('session', KEYS.discovery, next)
  return next
}

export async function clearDiscovery(): Promise<void> {
  await removeValue('session', KEYS.discovery)
}

export async function loadPlanDraft(): Promise<ActionPlan | null> {
  return readValue<ActionPlan | null>('local', KEYS.planDraft, null)
}

export async function savePlanDraft(plan: ActionPlan | null): Promise<void> {
  if (!plan) {
    await removeValue('local', KEYS.planDraft)
    return
  }
  await writeValue('local', KEYS.planDraft, plan)
}

export async function loadLastRun(): Promise<RunResult | null> {
  return readValue<RunResult | null>('local', KEYS.lastRun, null)
}

export async function saveLastRun(run: RunResult | null): Promise<void> {
  if (!run) {
    await removeValue('local', KEYS.lastRun)
    return
  }
  await writeValue('local', KEYS.lastRun, run)
}

/** A chave de IA só existe no storage.local (nunca sync, nunca em logs). */
export async function loadAiKey(): Promise<string> {
  return readValue<string>('local', KEYS.aiKey, '')
}

export async function saveAiKey(key: string): Promise<void> {
  await writeValue('local', KEYS.aiKey, key)
}

export async function clearAiKey(): Promise<void> {
  await removeValue('local', KEYS.aiKey)
}

export async function hasAiKey(): Promise<boolean> {
  return (await loadAiKey()).trim() !== ''
}

export function __clearMemoryStorageForTests(): void {
  memory.clear()
}
