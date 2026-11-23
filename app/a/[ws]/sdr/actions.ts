'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { audit } from '../../../../lib/audit'
import { getWorkspaceBySlug } from '../../../../lib/db/workspaces'
import { createServerClient } from '../../../../lib/supabaseServer'
import { icpFromLead } from '../../../../lib/sdr/score'
import { startLocalWorkerAction } from '../disparos/actions'
import type { SdrSearchView, SdrLeadView } from '../../../../lib/sdr/types'

export type { SdrSearchView, SdrLeadView }

type Fail = { ok: false; error: string }
const MANAGERS = ['owner', 'coordenador']

async function ctx(ws: string) {
  const workspace = await getWorkspaceBySlug(ws)
  if (!workspace) return { error: 'Workspace não encontrado.' } as const
  if (!MANAGERS.includes(workspace.role)) return { error: 'Somente dono ou coordenador gerenciam a prospecção SDR.' } as const
  const db = createServerClient()
  const { data: u } = await db.auth.getUser()
  if (!u.user) return { error: 'Sessão expirada. Entre de novo.' } as const
  return { workspace, db, userId: u.user.id } as const
}

const searchSchema = z.object({
  city: z.string().trim().min(2).max(80),
  uf: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  niche: z.enum(['food', 'health']).default('food'),
})


const SEARCH_FIELDS = 'id, status, city, uf, label, found, created_count, detail'

export async function sdrRequestSearchAction(ws: string, input: unknown): Promise<{ ok: true; search: SdrSearchView } | Fail> {
  const c = await ctx(ws)
  if ('error' in c) return { ok: false, error: c.error! }
  const parsed = searchSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Informe a cidade (e UF com 2 letras, se quiser).' }

  // Tenta ligar o robô se estiver rodando localmente
  try {
    await startLocalWorkerAction(ws)
  } catch {}

  const { data, error } = await c.db
    .from('prospect_searches')
    .insert({
      workspace_id: c.workspace.id,
      niche: parsed.data.niche,
      city: parsed.data.city,
      uf: parsed.data.uf ?? null,
      created_by: c.userId,
    })
    .select(SEARCH_FIELDS)
    .single()

  if (error || !data) return { ok: false, error: 'Não consegui registrar a pesquisa de empresas.' }

  await audit({
    workspaceId: c.workspace.id,
    actorType: 'user',
    actorId: c.userId,
    action: 'sdr.search_request',
    entityType: 'prospect_search',
    entityId: data.id,
    metadata: { niche: parsed.data.niche, city: parsed.data.city, uf: parsed.data.uf },
  })

  return { ok: true, search: data as SdrSearchView }
}

export async function sdrSearchStatusAction(
  ws: string,
  id: string,
): Promise<{ ok: true; search: SdrSearchView; fresh: SdrLeadView[] } | Fail> {
  const c = await ctx(ws)
  if ('error' in c) return { ok: false, error: c.error! }
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: 'Identificador inválido.' }

  const { data, error } = await c.db
    .from('prospect_searches')
    .select(SEARCH_FIELDS)
    .eq('workspace_id', c.workspace.id)
    .eq('id', id)
    .maybeSingle()

  if (error || !data) return { ok: false, error: 'Pesquisa não encontrada.' }

  let fresh: SdrLeadView[] = []
  if (data.status === 'concluida') {
    const { data: leads } = await c.db
      .from('prospect_leads')
      .select('id, name, phone, category, city, uf, address, website, status, found_at')
      .eq('workspace_id', c.workspace.id)
      .eq('search_id', id)
      .order('name')

    fresh = (leads ?? []).map((l: any) => {
      const icp = icpFromLead(l)
      return {
        ...l,
        icpScore: icp.score,
        icpBand: icp.band,
        icpEvidencias: icp.evidencias,
      }
    })
  }

  return { ok: true, search: data as SdrSearchView, fresh }
}

export async function sendLeadsToDisparoAction(
  ws: string,
  leadIds: string[],
): Promise<{ ok: true; count: number } | Fail> {
  const c = await ctx(ws)
  if ('error' in c) return { ok: false, error: c.error! }
  if (!Array.isArray(leadIds) || leadIds.length === 0) return { ok: false, error: 'Selecione ao menos uma empresa para enviar aos disparos.' }

  const { data, error } = await c.db
    .from('prospect_leads')
    .update({ status: 'novo' })
    .eq('workspace_id', c.workspace.id)
    .in('id', leadIds)
    .not('status', 'in', '(opt_out,invalido)')
    .select('id')

  if (error) return { ok: false, error: 'Não consegui encaminhar as empresas para o disparo.' }

  await audit({
    workspaceId: c.workspace.id,
    actorType: 'user',
    actorId: c.userId,
    action: 'sdr.send_to_disparos',
    entityType: 'prospect_leads',
    metadata: { count: data?.length ?? 0, ids: leadIds },
  })

  revalidatePath(`/a/${ws}/sdr`)
  revalidatePath(`/a/${ws}/disparos`)
  return { ok: true, count: data?.length ?? 0 }
}

