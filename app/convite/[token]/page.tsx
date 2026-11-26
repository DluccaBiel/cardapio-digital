import { brand } from '@undercut/brand'
import { hashInviteToken, inviteState, isInviteToken } from '../../../lib/invites'
import { createAdminClient } from '../../../lib/supabaseAdmin'
import { AcceptInviteForm } from './AcceptInviteForm'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Undercut — Criar acesso', robots: { index: false, follow: false } }

export default async function InvitePage({ params }: { params: { token: string } }) {
  let workspaceName: string | null = null
  let problem: string | null = null

  if (!isInviteToken(params.token)) {
    problem = 'Este link não é válido.'
  } else {
    const { data: invite } = await createAdminClient()
      .from('member_invites')
      .select('label, used_at, revoked_at, expires_at, workspaces ( name )')
      .eq('token_hash', hashInviteToken(params.token))
      .maybeSingle()
    if (!invite) problem = 'Este link não é válido.'
    else if (inviteState(invite) !== 'pending') problem = 'Este link não vale mais (já foi usado, cancelado ou venceu). Peça um novo ao responsável.'
    else {
      const w = Array.isArray(invite.workspaces) ? invite.workspaces[0] : invite.workspaces
      workspaceName = (w as { name?: string } | null)?.name ?? brand.name
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#070708] px-4 py-10 text-[#F2F0EC]">
      <div className="w-full max-w-md rounded-[8px] border border-[#232326] bg-[#161618] p-8 shadow-2xl">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/undercut-mark.svg" alt="Undercut" width={64} height={64} className="mx-auto mb-4" />
        {problem ? (
          <>
            <h1 className="text-center text-xl font-extrabold tracking-tight">Link indisponível</h1>
            <p className="mt-3 text-center text-sm text-[#9A9590]">{problem}</p>
          </>
        ) : (
          <>
            <h1 className="text-center text-2xl font-extrabold tracking-tight">Criar seu acesso</h1>
            <p className="mt-1 text-center text-sm text-[#9A9590]">
              Você foi convidado para <b className="text-[#F2F0EC]">{workspaceName}</b>. Escolha seu e-mail e sua senha — só você vai saber a senha.
            </p>
            <AcceptInviteForm token={params.token} />
            <p className="mt-4 text-center text-[11px] text-[#85817C]">Com este acesso você baixa e usa as extensões do Chrome. O resto do painel fica restrito.</p>
          </>
        )}
      </div>
    </main>
  )
}
