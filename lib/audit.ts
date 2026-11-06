import { createAdminClient } from './supabaseAdmin'

/**
 * Registra uma ação no audit_log (escrita só via service role — ver 0002_rls.sql).
 * NUNCA passe segredos, chaves, tokens ou PII em `metadata`.
 * Falha de auditoria não derruba a operação, mas é logada (sem dados sensíveis).
 */
export async function audit(entry: {
  workspaceId: string
  actorType: 'user' | 'api_key' | 'system'
  actorId: string | null
  action: string
  entityType: string
  entityId?: string | null
  metadata?: Record<string, unknown>
}): Promise<void> {
  try {
    const admin = createAdminClient()
    const { error } = await admin.from('audit_log').insert({
      workspace_id: entry.workspaceId,
      actor_type: entry.actorType,
      actor_id: entry.actorId,
      action: entry.action,
      entity_type: entry.entityType,
      entity_id: entry.entityId ?? null,
      metadata: entry.metadata ?? {},
    })
    if (error) console.error('[audit] falha ao registrar', entry.action, error.code)
  } catch {
    console.error('[audit] falha ao registrar', entry.action)
  }
}
