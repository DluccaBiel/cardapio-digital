import { z } from 'zod'

const MAX_PNG_BYTES = 2_500_000
export const optimizationSchema = z.object({
  client_id: z.string().uuid(),
  plan_hash: z.string().min(3).max(64),
  version: z.number().int().min(1).max(99),
  summary: z.string().max(2000),
  aborted: z.boolean(),
  approved: z
    .array(
      z.object({
        id: z.string().max(200),
        kind: z.string().max(40),
        item_name: z.string().max(200),
        before: z.unknown(),
        after: z.unknown(),
        reason: z.string().max(600),
        source: z.string().max(40),
      }),
    )
    .max(200),
  results: z.array(z.object({ action_id: z.string().max(200), status: z.string().max(40), message: z.string().max(600) })).max(200),
  evidence: z
    .array(z.object({ name: z.string().regex(/^[A-Za-z0-9 ._()-]{1,76}\.png$/) /* total ≤ 80 = check do banco */, content_base64: z.string().max(Math.ceil(MAX_PNG_BYTES * 1.4)) }))
    .max(6),
})
export type OptimizationInput = z.infer<typeof optimizationSchema>

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
export function decodePng(b64: string): Buffer | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return null
  const buf = Buffer.from(b64, 'base64')
  if (buf.length < 16 || buf.length > MAX_PNG_BYTES || !buf.subarray(0, 8).equals(PNG_SIG)) return null
  return buf
}
