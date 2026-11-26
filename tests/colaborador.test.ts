import { describe, expect, it } from 'vitest'
import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { hashInviteToken, inviteState, isInviteToken, newInviteToken } from '../lib/invites'
import { COLLABORATOR_ROLE, homePath } from '../lib/workspace-role'
import { availableExtensions } from '../lib/extensions/catalog'

describe('convite de colaborador', () => {
  it('gera token de 192 bits no formato esperado e guarda só o hash', () => {
    const a = newInviteToken()
    const b = newInviteToken()
    expect(a).not.toBe(b)
    expect(isInviteToken(a)).toBe(true)
    expect(hashInviteToken(a)).toMatch(/^[0-9a-f]{64}$/)
    expect(hashInviteToken(a)).not.toContain(a)
    expect(isInviteToken('curto')).toBe(false)
    expect(isInviteToken(`${a}!`)).toBe(false)
  })

  it('estado do convite', () => {
    const base = { used_at: null, revoked_at: null, expires_at: new Date(Date.now() + 1000).toISOString() }
    expect(inviteState(base)).toBe('pending')
    expect(inviteState({ ...base, used_at: new Date().toISOString() })).toBe('used')
    expect(inviteState({ ...base, revoked_at: new Date().toISOString() })).toBe('revoked')
    expect(inviteState({ ...base, expires_at: new Date(Date.now() - 1000).toISOString() })).toBe('expired')
  })

  it('colaborador cai em Extensões; os demais, na Visão geral', () => {
    expect(homePath({ slug: 'x', role: COLLABORATOR_ROLE })).toBe('/a/x/extensoes')
    expect(homePath({ slug: 'x', role: 'owner' })).toBe('/a/x/visao-geral')
  })
})

describe('Extensões simples', () => {
  it('lista só as extensões que funcionam, com download e passo a passo', async () => {
    // O vitest compila JSX no modo clássico (tsconfig usa jsx: preserve): expõe o React global.
    ;(globalThis as { React?: unknown }).React = React
    const { ExtensionsSimple } = await import('../components/hub/extensions/ExtensionsSimple')
    const slugs = availableExtensions().map((e) => e.slug)
    expect(slugs).toEqual(['undercut-ifood', 'undercut-cardapioweb', 'undercut-anotaai'])
    const html = renderToStaticMarkup(createElement(ExtensionsSimple, { workspaceName: 'Teste' }))
    for (const e of availableExtensions()) expect(html).toContain(`${e.downloadUrl}?v=${e.version}`)
    expect(html).toContain('Como instalar no Chrome')
    expect(html).not.toContain('Chave') // sem chaves de API para o colaborador
    expect(html).not.toContain('conectada') // sem status de conexão
  })
})
