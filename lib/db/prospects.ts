import { createServerClient } from '../supabaseServer'

export type Niche = 'food' | 'health'

export type ProspectClient = {
  id: string
  name: string
  email: string | null
  phone: string | null
  whatsapp: string | null
  instagram: string | null
  website: string | null
  monthly_fee: number | null
  status: 'ativo' | 'pausado' | 'encerrado'
  niche: Niche | null
}

/**
 * Clientes do workspace para Prospecção/SDR/Disparos (sessão do usuário → RLS).
 * `niche`/`website` vêm da migration 20261116152908; se ela ainda não foi
 * aplicada no banco, cai para a seleção sem essas colunas e avisa.
 */
export async function listProspectClients(workspaceId: string): Promise<{ clients: ProspectClient[]; missingColumns: boolean }> {
  const db = createServerClient()
  const base = 'id, name, email, phone, whatsapp, instagram, monthly_fee, status'

  const full = await db
    .from('clients')
    .select(`${base}, website, niche`)
    .eq('workspace_id', workspaceId)
    .is('archived_at', null)
    .order('name')

  if (!full.error) {
    return { clients: (full.data ?? []).map(normalize), missingColumns: false }
  }

  const fallback = await db.from('clients').select(base).eq('workspace_id', workspaceId).is('archived_at', null).order('name')
  return { clients: (fallback.data ?? []).map(normalize), missingColumns: true }
}

function normalize(row: any): ProspectClient {
  return {
    id: row.id,
    name: row.name,
    email: row.email ?? null,
    phone: row.phone ?? null,
    whatsapp: row.whatsapp ?? null,
    instagram: row.instagram ?? null,
    website: row.website ?? null,
    monthly_fee: row.monthly_fee == null ? null : Number(row.monthly_fee),
    status: row.status,
    niche: row.niche === 'food' || row.niche === 'health' ? row.niche : null,
  }
}
