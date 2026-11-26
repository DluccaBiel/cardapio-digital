'use client'

import { useFormState, useFormStatus } from 'react-dom'
import { acceptInviteAction, type AcceptState } from './actions'

const initialState: AcceptState = { error: null }
const input =
  'w-full rounded-[5px] border border-[#232326] bg-[#070708] px-3 py-2 text-[#F2F0EC] outline-none placeholder:text-[#9A9590] focus:border-[#D7141F]'

function Submit() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-2 w-full rounded-[5px] bg-[#D7141F] px-4 py-2.5 font-bold text-white transition-colors hover:bg-[#F0333D] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D7141F] disabled:opacity-60"
    >
      {pending ? 'Criando acesso…' : 'Criar meu acesso'}
    </button>
  )
}

export function AcceptInviteForm({ token }: { token: string }) {
  const [state, formAction] = useFormState(acceptInviteAction.bind(null, token), initialState)
  return (
    <form action={formAction} className="mt-6 space-y-4">
      <div>
        <label htmlFor="name" className="mb-1.5 block text-sm font-semibold">Seu nome</label>
        <input id="name" name="name" required minLength={2} maxLength={80} autoComplete="name" className={input} />
      </div>
      <div>
        <label htmlFor="email" className="mb-1.5 block text-sm font-semibold">Seu e-mail</label>
        <input id="email" name="email" type="email" required maxLength={160} autoComplete="email" placeholder="voce@email.com" className={input} />
      </div>
      <div>
        <label htmlFor="password" className="mb-1.5 block text-sm font-semibold">Crie uma senha</label>
        <input id="password" name="password" type="password" required minLength={8} maxLength={72} autoComplete="new-password" className={input} />
        <p className="mt-1 text-xs text-[#85817C]">Mínimo de 8 caracteres.</p>
      </div>
      <div>
        <label htmlFor="confirm" className="mb-1.5 block text-sm font-semibold">Repita a senha</label>
        <input id="confirm" name="confirm" type="password" required minLength={8} maxLength={72} autoComplete="new-password" className={input} />
      </div>
      {state.error && (
        <p role="alert" className="rounded-[5px] border border-[#FF6A3D]/40 bg-[#FF6A3D]/10 px-3 py-2 text-sm text-[#FFB199]">
          {state.error}
        </p>
      )}
      <Submit />
    </form>
  )
}
