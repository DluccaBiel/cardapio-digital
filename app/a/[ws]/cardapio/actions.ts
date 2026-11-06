'use server'

import { revalidatePath } from 'next/cache'
import { getWorkspaceBySlug } from '../../../../lib/db/workspaces'
import { createServerClient } from '../../../../lib/supabaseServer'
import * as m from '../../../../lib/menu/mutations'

type ActionResult = { ok: true; id?: string } | { ok: false; error: string; conflict?: boolean }

const WRITE_ROLES = new Set(['owner', 'coordenador', 'editor'])

/** Contexto da sessão: membro do workspace + cliente Supabase com RLS. */
async function ctxFor(ws: string): Promise<m.Ctx | string> {
  const workspace = await getWorkspaceBySlug(ws)
  if (!workspace) return 'Workspace não encontrado ou sem acesso.'
  if (!WRITE_ROLES.has(workspace.role)) return 'Seu papel é somente leitura neste workspace.'
  const db = createServerClient()
  const { data } = await db.auth.getUser()
  if (!data.user) return 'Sessão expirada. Entre novamente.'
  return { db: db as any, workspaceId: workspace.id, actor: { type: 'user', id: data.user.id } }
}

function done(ws: string, res: m.Result<{ id: string } & Record<string, unknown>>): ActionResult {
  if (!res.ok) return { ok: false, error: res.message, conflict: res.code === 'conflict' }
  revalidatePath(`/a/${ws}/cardapio`)
  return { ok: true, id: res.data.id }
}

async function run(ws: string, fn: (ctx: m.Ctx) => Promise<m.Result<any>>): Promise<ActionResult> {
  const ctx = await ctxFor(ws)
  if (typeof ctx === 'string') return { ok: false, error: ctx }
  try {
    return done(ws, await fn(ctx))
  } catch {
    return { ok: false, error: 'Erro inesperado. Tente novamente.' }
  }
}

export async function createClientAction(ws: string, input: unknown) {
  return run(ws, (ctx) => m.createMenuClient(ctx, input))
}
export async function saveCategoryAction(ws: string, input: unknown) {
  return run(ws, (ctx) => m.saveCategory(ctx, input))
}
export async function deleteCategoryAction(ws: string, id: string, expected?: string) {
  return run(ws, (ctx) => m.deleteCategory(ctx, id, expected))
}
export async function moveCategoryAction(ws: string, clientId: string, id: string, direction: 'up' | 'down') {
  return run(ws, (ctx) => m.moveCategory(ctx, clientId, id, direction))
}
export async function saveItemAction(ws: string, input: unknown) {
  return run(ws, (ctx) => m.saveItem(ctx, input))
}
export async function patchItemAction(ws: string, id: string, expected: string, patch: unknown) {
  return run(ws, (ctx) => m.patchItem(ctx, id, expected, patch))
}
export async function deleteItemAction(ws: string, id: string, expected?: string) {
  return run(ws, (ctx) => m.deleteItem(ctx, id, expected))
}
export async function saveComboAction(ws: string, input: unknown) {
  return run(ws, (ctx) => m.saveCombo(ctx, input))
}
export async function saveGroupAction(ws: string, input: unknown) {
  return run(ws, (ctx) => m.saveGroup(ctx, input))
}
export async function deleteGroupAction(ws: string, id: string, expected?: string) {
  return run(ws, (ctx) => m.deleteGroup(ctx, id, expected))
}
export async function saveSubitemAction(ws: string, input: unknown) {
  return run(ws, (ctx) => m.saveSubitem(ctx, input))
}
export async function deleteSubitemAction(ws: string, id: string, expected?: string) {
  return run(ws, (ctx) => m.deleteSubitem(ctx, id, expected))
}
export async function markSyncedAction(ws: string, id: string, expected: string) {
  return run(ws, (ctx) => m.markSynced(ctx, id, expected))
}
