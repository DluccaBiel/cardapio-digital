import { createServerClient } from '../supabaseServer'
import { COLLABORATOR_ROLE } from '../workspace-role'

export { COLLABORATOR_ROLE, homePath } from '../workspace-role'

export type Workspace = {
  id: string
  name: string
  slug: string
  plan: string
}

export type WorkspaceMembership = Workspace & { role: string }

/** Workspaces do usuário autenticado (RLS garante o escopo). */
export async function getUserWorkspaces(): Promise<WorkspaceMembership[]> {
  const supabase = createServerClient()
  const { data: userData } = await supabase.auth.getUser()
  const user = userData.user
  if (!user) return []

  const { data: memberships } = await supabase
    .from('members')
    .select('role, workspaces ( id, name, slug, plan )')
    .eq('user_id', user.id)

  return (memberships ?? [])
    .map((m: any) => {
      const w = Array.isArray(m.workspaces) ? m.workspaces[0] : m.workspaces
      if (!w) return null
      return { ...w, role: m.role } as WorkspaceMembership
    })
    .filter(Boolean) as WorkspaceMembership[]
}

/**
 * Resolve o workspace pelo slug somente se o usuário é membro (senão null).
 *
 * O colaborador é DEFAULT-DENY: todas as telas e server actions chamam esta função,
 * então ele só passa onde a chamada pede `allowCollaborator` (hoje: layout e Extensões).
 * (As policies de RLS já o isolam dos dados — ver 20261125120100_member_invites.sql.)
 */
export async function getWorkspaceBySlug(
  slug: string,
  opts: { allowCollaborator?: boolean } = {},
): Promise<(Workspace & { role: string }) | null> {
  const list = await getUserWorkspaces()
  const found = list.find((w) => w.slug === slug) ?? null
  if (found && found.role === COLLABORATOR_ROLE && !opts.allowCollaborator) return null
  return found
}
