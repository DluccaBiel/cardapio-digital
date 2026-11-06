import { NextResponse } from 'next/server'
import type { Fail } from '../menu/mutations'

/**
 * CORS: a extensão chama a API pelo service worker (host_permissions → sem CORS).
 * Ainda assim respondemos preflight para origens `chrome-extension://<id>`
 * cadastradas em ALLOWED_EXTENSION_ORIGINS (lista separada por vírgula). Nunca `*`.
 */
function allowedOrigin(origin: string | null): string | null {
  if (!origin) return null
  const list = (process.env.ALLOWED_EXTENSION_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return list.includes(origin) ? origin : null
}

export function corsHeaders(req: Request): Record<string, string> {
  const origin = allowedOrigin(req.headers.get('origin'))
  if (!origin) return {}
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, If-Match, Idempotency-Key',
    'Access-Control-Expose-Headers': 'ETag, X-RateLimit-Limit, X-RateLimit-Remaining, Retry-After',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  }
}

export function preflight(req: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) })
}

export function ok(req: Request, data: unknown, init?: { status?: number; headers?: Record<string, string> }) {
  return NextResponse.json(
    { data },
    { status: init?.status ?? 200, headers: { 'Cache-Control': 'no-store', ...corsHeaders(req), ...(init?.headers ?? {}) } },
  )
}

export type ErrorCode =
  | 'invalid_input'
  | 'unauthorized'
  | 'forbidden_scope'
  | 'not_found'
  | 'conflict'
  | 'has_items'
  | 'merchant_mismatch'
  | 'validation_failed'
  | 'precondition_required'
  | 'rate_limited'
  | 'internal'

const STATUS: Record<ErrorCode, number> = {
  invalid_input: 400,
  unauthorized: 401,
  forbidden_scope: 403,
  not_found: 404,
  conflict: 409,
  has_items: 409,
  merchant_mismatch: 409,
  validation_failed: 422,
  precondition_required: 428,
  rate_limited: 429,
  internal: 500,
}

export function err(req: Request, code: ErrorCode, message: string, details: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  return NextResponse.json(
    { error: { code, message, details } },
    { status: STATUS[code], headers: { 'Cache-Control': 'no-store', ...corsHeaders(req), ...headers } },
  )
}

/** Converte falha das mutações no envelope padrão. */
export function fromFail(req: Request, f: Fail) {
  const map: Record<Fail['code'], ErrorCode> = {
    invalid: 'validation_failed',
    not_found: 'not_found',
    conflict: 'conflict',
    has_items: 'has_items',
    forbidden: 'forbidden_scope',
    db: 'internal',
    merchant_mismatch: 'merchant_mismatch',
  }
  return err(req, map[f.code], f.message, f.current ? { current: f.current } : {})
}

export async function readJson(req: Request): Promise<unknown | undefined> {
  try {
    return await req.json()
  } catch {
    return undefined
  }
}
