'use client'

import { useFormState, useFormStatus } from 'react-dom'
import { createWorkspace, type CreateWorkspaceState } from './actions'

const initialState: CreateWorkspaceState = { error: null }

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-6 w-full rounded-lg bg-[#3D8EFF] px-4 py-2.5 font-bold text-[#070B14] transition-colors hover:bg-[#6EA8FF] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3D8EFF] disabled:opacity-60"
    >
      {pending ? 'Criando…' : 'Criar workspace'}
    </button>
  )
}

export function OnboardingForm() {
  const [state, formAction] = useFormState(createWorkspace, initialState)

  return (
    <form action={formAction} className="mt-6 space-y-4">
      <div>
        <label htmlFor="name" className="mb-1.5 block text-sm font-semibold">Nome do workspace</label>
        <input id="name" name="name" required maxLength={80} placeholder="Ex.: Assessoria Alpha" className="w-full rounded-lg border border-[#1C2A47] bg-[#070B14] px-3 py-2 text-[#E6ECFA] outline-none placeholder:text-[#8FA0C4] focus:border-[#3D8EFF]" />
      </div>
      <div>
        <label htmlFor="slug" className="mb-1.5 block text-sm font-semibold">Identificador (URL)</label>
        <div className="flex items-stretch overflow-hidden rounded-lg border border-[#1C2A47] focus-within:border-[#3D8EFF]">
          <span className="flex items-center bg-[#0B1220] px-3 text-sm text-[#8FA0C4]">/a/</span>
          <input id="slug" name="slug" required maxLength={63} placeholder="alpha" pattern="[a-z0-9][a-z0-9\-]{1,62}" className="w-full bg-[#070B14] px-3 py-2 text-[#E6ECFA] outline-none placeholder:text-[#8FA0C4]" />
        </div>
        <p className="mt-1 text-xs text-[#8FA0C4]">Só letras minúsculas, números e hífens.</p>
      </div>
      {state.error && <p role="alert" className="rounded-lg border border-[#F87171]/40 bg-[#3B0A0A] px-3 py-2 text-sm text-[#FECACA]">{state.error}</p>}
      <SubmitButton />
    </form>
  )
}
