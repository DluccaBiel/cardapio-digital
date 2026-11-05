'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createServerClient } from '../../../lib/supabaseServer'
import { currentISOWeek } from '../../../lib/format'

const SITUATIONS = ['ativo', 'onboarding', 'stand_by', 'churn'] as const
const CAMPAIGN_STATES = ['nao_definido', 'planejamento', 'ativo', 'pausado', 'encerrado'] as const
const CREATIVE_STATUSES = ['nao_definido', 'em_producao', 'estatico_pronto', 'video_pronto', 'em_aprovacao'] as const
const DELIVERY_STATES = ['pendente', 'estatico_pronto', 'video_pronto', 'sem_criativo', 'entregue'] as const
const ROUTINE_KEYS = ['routine_report', 'routine_upload', 'routine_ia', 'routine_share', 'routine_note', 'routine_camera'] as const

const textField = z.string().max(160).transform((v) => v.trim())
const nullableDate = z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal(''), z.null()])

export async function createClientAction(workspaceId: string, _slug: string, input: { name: string; segment: string; situation: string }) {
  const parsed = z
    .object({ name: z.string().trim().min(1).max(160), segment: z.string().trim().max(120), situation: z.enum(SITUATIONS) })
    .safeParse(input)
  if (!parsed.success) return { error: 'Dados inválidos para o cliente.' }

  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('clients')
    .insert({ workspace_id: workspaceId, name: parsed.data.name, segment: parsed.data.segment, situation: parsed.data.situation, status: 'ativo' })
    .select('id')
    .single()

  if (error) return { error: 'Não foi possível criar o cliente (verifique com seu papel).' }
  revalidatePath(`/a/${_slug}/visao-geral`)
  return { error: null, id: data.id as string }
}

const fieldSchemas: Record<string, z.ZodTypeAny> = {
  situation: z.enum(SITUATIONS),
  campaign_state: z.enum(CAMPAIGN_STATES),
  creative_status: z.enum(CREATIVE_STATUSES),
  delivery_state: z.enum(DELIVERY_STATES),
  editor: textField,
  segment: textField,
  termination_date: nullableDate,
  has_alert: z.boolean(),
  monthly_fee: z.union([z.number().nonnegative(), z.null()]),
}

export async function setClientField(workspaceId: string, _slug: string, clientId: string, field: string, value: unknown) {
  const schema = fieldSchemas[field]
  if (!schema) return { error: 'Campo não permitido.' }
  const parsed = schema.safeParse(value)
  if (!parsed.success) return { error: 'Valor inválido.' }

  const supabase = createServerClient()
  const patch: Record<string, unknown> = { [field]: parsed.data === '' ? null : parsed.data }
  const { error, count } = await supabase
    .from('clients')
    .update(patch)
    .eq('id', clientId)
    .eq('workspace_id', workspaceId)
    .select('id', { count: 'exact', head: true })

  if (error || count === 0) return { error: 'Não foi possível salvar (sem permissão ou cliente não encontrado).' }
  revalidatePath(`/a/${_slug}/visao-geral`)
  return { error: null }
}

export async function createTagAction(workspaceId: string, _slug: string, input: { name: string; color: string }) {
  const parsed = z
    .object({ name: z.string().trim().min(1).max(60), color: z.string().regex(/^#[0-9a-fA-F]{6}$/) })
    .safeParse(input)
  if (!parsed.success) return { error: 'Tag inválida.' }

  const supabase = createServerClient()
  const { data, error } = await supabase.from('tags').insert({ workspace_id: workspaceId, ...parsed.data }).select('id, name, color').single()
  if (error) {
    if (error.code === '23505') return { error: 'Tag com esse nome já existe.' }
    return { error: 'Não foi possível criar a tag.' }
  }
  revalidatePath(`/a/${_slug}/visao-geral`)
  return { error: null, tag: data }
}

export async function setClientTag(workspaceId: string, _slug: string, clientId: string, tagId: string, on: boolean) {
  const supabase = createServerClient()
  if (on) {
    const { error } = await supabase.from('client_tags').insert({ workspace_id: workspaceId, client_id: clientId, tag_id: tagId })
    if (error && error.code !== '23505') return { error: 'Não foi possível aplicar a tag.' }
  } else {
    const { error } = await supabase.from('client_tags').delete().eq('workspace_id', workspaceId).eq('client_id', clientId).eq('tag_id', tagId)
    if (error) return { error: 'Não foi possível remover a tag.' }
  }
  revalidatePath(`/a/${_slug}/visao-geral`)
  return { error: null }
}

export async function registerPixAction(workspaceId: string, _slug: string, clientId: string, amount: number) {
  const parsed = z.number().nonnegative().max(10_000_000).safeParse(amount)
  if (!parsed.success) return { error: 'Valor inválido.' }
  const supabase = createServerClient()
  const { error, count } = await supabase
    .from('clients')
    .update({ pix_paid_at: new Date().toISOString(), pix_amount: parsed.data })
    .eq('id', clientId)
    .eq('workspace_id', workspaceId)
    .select('id', { count: 'exact', head: true })
  if (error || count === 0) return { error: 'Não foi possível registrar o Pix.' }
  revalidatePath(`/a/${_slug}/visao-geral`)
  return { error: null }
}

const routineEnum = z.enum(ROUTINE_KEYS)

export async function toggleRoutineAction(workspaceId: string, _slug: string, clientId: string, key: string, value: boolean) {
  const parsedKey = routineEnum.safeParse(key)
  if (!parsedKey.success) return { error: 'Campo inválido.' }
  const k = parsedKey.data

  const supabase = createServerClient()
  const { data: row } = await supabase
    .from('clients')
    .select('routine_week, routine_report, routine_upload, routine_ia, routine_share, routine_note, routine_camera')
    .eq('id', clientId)
    .eq('workspace_id', workspaceId)
    .single()
  if (!row) return { error: 'Cliente não encontrado ou sem permissão.' }

  const week = currentISOWeek()
  const stale = row.routine_week !== week
  const patch: Record<string, unknown> = { routine_week: week }
  if (stale) {
    for (const rk of ROUTINE_KEYS) patch[rk] = false
  }
  patch[k] = value

  const { error, count } = await supabase
    .from('clients')
    .update(patch)
    .eq('id', clientId)
    .eq('workspace_id', workspaceId)
    .select('id', { count: 'exact', head: true })
  if (error || count === 0) return { error: 'Não foi possível atualizar a rotina.' }
  revalidatePath(`/a/${_slug}/visao-geral`)
  return { error: null }
}
