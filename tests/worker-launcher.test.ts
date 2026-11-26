import { afterEach, describe, expect, it, vi } from 'vitest'
import { ensureWorkerRunning, launchMessage } from '../lib/worker-launcher'

const dbWith = (seen: string | null) => ({
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { worker_seen_at: seen } }) }) }) }),
}) as any

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('ligar o robô sozinho', () => {
  it('não faz nada se já está online', async () => {
    const r = await ensureWorkerRunning(dbWith(new Date().toISOString()), 'ws')
    expect(r.state).toBe('online')
  })
  it('chama WORKER_START_URL quando desligado', async () => {
    vi.stubEnv('WORKER_START_URL', 'https://api.example.test/start')
    vi.stubEnv('WORKER_START_TOKEN', 'tok')
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))
    const r = await ensureWorkerRunning(dbWith(null), 'ws', 10)
    expect(f).toHaveBeenCalledWith('https://api.example.test/start', expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer tok' }) }))
    expect(r).toEqual({ state: 'started', via: 'remoto', online: false })
  })
  it('na Vercel sem URL pede ligação manual', async () => {
    vi.stubEnv('VERCEL', '1')
    vi.stubEnv('WORKER_START_URL', '')
    const r = await ensureWorkerRunning(dbWith(null), 'ws')
    expect(r.state).toBe('manual')
    expect(launchMessage(r)).toMatch(/WORKER_START_URL/)
  })
})
