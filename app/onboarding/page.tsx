import { redirect } from 'next/navigation'
import { getUserWorkspaces } from '../../lib/db/workspaces'
import { createServerClient } from '../../lib/supabaseServer'
import { OnboardingForm } from './OnboardingForm'

export const metadata = { title: 'Undercut — Bem-vindo', description: 'Crie seu primeiro workspace no Undercut.' }

export default async function OnboardingPage() {
  const supabase = createServerClient()
  const { data } = await supabase.auth.getUser()
  if (!data.user) redirect('/login')

  const workspaces = await getUserWorkspaces()
  if (workspaces.length > 0) redirect(`/a/${workspaces[0].slug}/visao-geral`)

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#070708] px-4 text-[#F2F0EC]">
      <div className="w-full max-w-md rounded-[8px] border border-[#232326] bg-[#161618] p-8 shadow-2xl">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/undercut-mark.svg" alt="Undercut" width={72} height={72} className="mx-auto mb-4" />
        <h1 className="text-center text-2xl font-extrabold tracking-tight">Vamos começar</h1>
        <p className="mt-1 text-center text-sm text-[#9A9590]">Crie o primeiro workspace da sua assessoria. Você poderá adicionar membros e clientes depois.</p>
        <OnboardingForm />
      </div>
    </main>
  )
}
