import { z } from 'zod'
import { PERIOD_KEYS } from './format'

const num = z.number().finite()
const kind = z.enum(['sales', 'messages', 'profile', 'traffic', 'engagement', 'leads', 'awareness', 'other'])
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const range = z.object({ since: day, until: day })

/** Validação do relatório vindo do navegador (salvar, enfileirar, gerar PNG). */
export const payloadSchema = z
  .object({
    version: z.literal(1),
    adAccountId: z.string().uuid(),
    clientId: z.string().uuid().nullable(),
    title: z.string().min(1).max(200),
    accountName: z.string().max(200),
    accountId: z.string().max(60),
    workspaceName: z.string().max(200),
    periodKey: z.enum(PERIOD_KEYS),
    period: range,
    previous: range.nullable(),
    periodLabel: z.string().max(40),
    previousLabel: z.string().max(40).nullable(),
    mode: z.enum(['merged', 'separate']),
    selected: z.array(z.string().max(40)).max(200),
    show: z.object({ general: z.boolean(), byObjective: z.boolean(), topCreatives: z.boolean(), balance: z.boolean() }),
    totals: z.object({ spend: num, reach: num, impressions: num, prevSpend: num.nullable(), spendDelta: num.nullable() }),
    blocks: z
      .array(
        z.object({
          key: z.string().max(60),
          kind,
          title: z.string().max(200),
          campaigns: z.array(z.string().max(200)).max(200),
          spend: num,
          result: num,
          resultLabel: z.string().max(60),
          costLabel: z.string().max(60),
          costPerResult: num.nullable(),
          revenue: num,
          roas: num.nullable(),
          deltaResult: num.nullable(),
          deltaCost: num.nullable(),
          metrics: z.record(z.string(), num).optional(),
        }),
      )
      .max(60),
    topAds: z
      .array(z.object({ id: z.string().max(40), name: z.string().max(200), campaignId: z.string().max(40), kind, spend: num, result: num, thumbnail: z.string().url().max(2000).nullable() }))
      .max(5),
    balance: z.object({ kind: z.enum(['pix', 'card', 'unknown']), available: num, debt: num, unbilled: num, daysLeft: num.nullable() }),
    campaigns: z.array(z.record(z.string(), z.unknown())).max(300),
    reach: num,
    impressions: num,
    generatedAt: z.string().max(40),
  })
  .passthrough()
