import { describe, expect, it, vi } from 'vitest'
import { HubClient, isValidApiKey, normalizeHubUrl, originMatchesPatterns } from '../src/lib/hub'

const KEY = `ck_live_${'a'.repeat(43)}`

function fakeFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  return vi.fn(async (_url: string, _init?: RequestInit) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } }),
  )
}

describe('normalizeHubUrl', () => {
  it('aceita https e devolve só a origem', () => {
    expect(normalizeHubUrl('https://orvia-gestao.vercel.app/a/x/cardapio')).toBe('https://orvia-gestao.vercel.app')
  })
  it('aceita http apenas em localhost', () => {
    expect(normalizeHubUrl('http://localhost:3000')).toBe('http://localhost:3000')
    expect(normalizeHubUrl('http://exemplo.com')).toBeNull()
  })
  it('rejeita lixo', () => {
    expect(normalizeHubUrl('não é url')).toBeNull()
    expect(normalizeHubUrl('javascript:alert(1)')).toBeNull()
  })
})

describe('isValidApiKey', () => {
  it('valida formato ck_live_ + 43', () => {
    expect(isValidApiKey(KEY)).toBe(true)
    expect(isValidApiKey('ck_live_curta')).toBe(false)
  })
})

describe('HubClient', () => {
  it('envia X-API-Key, sem cookies, e lê data + ETag', async () => {
    const f = fakeFetch(200, { data: { client: {}, items: [], etag: '"x:1"' } }, { etag: '"x:1"' })
    const client = new HubClient({ hubUrl: 'https://hub.example', apiKey: KEY }, f as any)
    const res = await client.menu('c-1')
    expect(res).toMatchObject({ ok: true, etag: '"x:1"' })
    const [url, init] = f.mock.calls[0]!
    expect(url).toBe('https://hub.example/api/v1/menu?client_id=c-1')
    expect((init!.headers as Record<string, string>)['X-API-Key']).toBe(KEY)
    expect(init!.credentials).toBe('omit')
  })

  it('importação manda If-Match', async () => {
    const f = fakeFetch(200, { data: {} })
    const client = new HubClient({ hubUrl: 'https://hub.example', apiKey: KEY }, f as any)
    await client.importSnapshot('"2026:3"', { client_id: 'c' })
    const init = f.mock.calls[0]![1]!
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['If-Match']).toBe('"2026:3"')
  })

  it('markSynced manda If-Match e ifood_id', async () => {
    const f = fakeFetch(200, { data: {} })
    const client = new HubClient({ hubUrl: 'https://hub.example', apiKey: KEY }, f as any)
    await client.markSynced('id-1', '"etag"', 'IF-9')
    const [url, init] = f.mock.calls[0]!
    expect(url).toBe('https://hub.example/api/v1/menu/items/id-1/ifood-sync')
    expect(JSON.parse(String(init!.body))).toEqual({ ifood_id: 'IF-9' })
    expect((init!.headers as Record<string, string>)['If-Match']).toBe('"etag"')
  })

  it('traduz o envelope de erro', async () => {
    const f = fakeFetch(409, { error: { code: 'merchant_mismatch', message: 'Loja diferente', details: { a: 1 } } })
    const client = new HubClient({ hubUrl: 'https://hub.example', apiKey: KEY }, f as any)
    expect(await client.importSnapshot('"e"', {})).toEqual({ ok: false, status: 409, code: 'merchant_mismatch', message: 'Loja diferente', details: { a: 1 } })
  })

  it('falha de rede vira erro amigável', async () => {
    const client = new HubClient({ hubUrl: 'https://hub.example', apiKey: KEY }, (async () => {
      throw new TypeError('fail')
    }) as any)
    expect(await client.clients()).toMatchObject({ ok: false, status: 0, code: 'network' })
  })

  it('recusa endereço http fora de localhost', () => {
    expect(() => new HubClient({ hubUrl: 'http://exemplo.com', apiKey: KEY })).toThrow()
  })
})

describe('originMatchesPatterns', () => {
  const patterns = ['https://orvia-gestao.vercel.app/a/*/extensoes*', 'http://localhost/a/*/extensoes*']
  it('ignora a porta (padrões do Chrome não têm porta)', () => {
    expect(originMatchesPatterns('http://localhost:3100', patterns)).toBe(true)
  })
  it('exige mesmo esquema e host', () => {
    expect(originMatchesPatterns('https://orvia-gestao.vercel.app', patterns)).toBe(true)
    expect(originMatchesPatterns('https://localhost:3100', patterns)).toBe(false)
    expect(originMatchesPatterns('https://evil.vercel.app', patterns)).toBe(false)
    expect(originMatchesPatterns('https://orvia-gestao.vercel.app.evil.com', patterns)).toBe(false)
  })
  it('suporta curinga de subdomínio', () => {
    expect(originMatchesPatterns('https://x.vercel.app', ['https://*.vercel.app/*'])).toBe(true)
  })
})
