'use client'

import { useMemo, useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { isValidWorkspaceSlug, toWorkspaceSlug } from '../../lib/slug'
import { createWorkspace, type CreateWorkspaceState } from './actions'

const initialState: CreateWorkspaceState = { error: null }

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-6 w-full rounded-[5px] bg-[#D7141F] px-4 py-2.5 font-bold text-[#070708] transition-colors hover:bg-[#F0333D] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D7141F] disabled:opacity-60"
    >
      {pending ? 'Criando…' : 'Criar workspace'}
    </button>
  )
}

export function OnboardingForm() {
  const [state, formAction] = useFormState(createWorkspace, initialState)
  const [identifier, setIdentifier] = useState('')

  const slug = useMemo(() => toWorkspaceSlug(identifier), [identifier])
  const slugReady = isValidWorkspaceSlug(slug)

  return (
    <form action={formAction} className="mt-6 space-y-4">
      <div>
        <label htmlFor="name" className="mb-1.5 block text-sm font-semibold">Nome do workspace</label>
        <input id="name" name="name" required maxLength={80} placeholder="Ex.: Assessoria Alpha" className="w-full rounded-[5px] border border-[#232326] bg-[#070708] px-3 py-2 text-[#F2F0EC] outline-none placeholder:text-[#9A9590] focus:border-[#D7141F]" />
      </div>
      <div>
        <label htmlFor="slug" className="mb-1.5 block text-sm font-semibold">Identificador (URL)</label>
        <div className="flex items-stretch overflow-hidden rounded-[5px] border border-[#232326] focus-within:border-[#D7141F]">
          <span className="flex items-center bg-[#0B0B0C] px-3 text-sm text-[#9A9590]">/a/</span>
          <input
            id="slug"
            name="slug"
            required
            maxLength={300}
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            placeholder="alpha ou https://sua-assessoria.com.br"
            aria-describedby="slug-hint"
            className="w-full bg-[#070708] px-3 py-2 text-[#F2F0EC] outline-none placeholder:text-[#9A9590]"
          />
        </div>
        {identifier.trim() !== '' && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1 text-xs" aria-live="polite">
            <span className="text-[#9A9590]">Endereço:</span>
            <span className={slugReady ? 'font-semibold text-[#F0333D]' : 'font-semibold text-[#FFB199]'}>
              /a/{slugReady ? slug : '…'}
            </span>
            {!slugReady && <span className="text-[#FFB199]">— informe letras ou cole um link válido</span>}
          </div>
        )}
        <p id="slug-hint" className="mt-1 text-xs text-[#9A9590]">
          Aceita qualquer link ou texto: convertemos para um endereço válido (letras minúsculas, números e hífens).
        </p>
      </div>
      {state.error && <p role="alert" className="rounded-[5px] border border-[#FF6A3D]/40 bg-[#3B0A0A] px-3 py-2 text-sm text-[#FFD3C4]">{state.error}</p>}
      <SubmitButton />
    </form>
  )
}
