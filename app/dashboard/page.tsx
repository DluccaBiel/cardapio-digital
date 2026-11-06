import { redirect } from 'next/navigation'

/**
 * Rota legada da v0.2 ("Dashboard Admin" com CSV de `produtos`).
 * Substituída pelo hub em /a/{workspace}/... — a raiz (/) escolhe o workspace
 * (ou leva ao onboarding/login). Mantida só como redirecionamento para links antigos.
 */
export default function LegacyDashboard() {
  redirect('/')
}
