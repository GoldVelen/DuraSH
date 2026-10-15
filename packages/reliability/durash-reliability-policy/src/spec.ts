/**
 * Reliability-policy domain declaration: one row per Session.
 * @module @durash/dsh-reliability-policy/src/spec
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { SessionId } from '@deepseek-ai/dsh-session/types'

/** Session id schema at the durable boundary; branding has no runtime representation. */
const sessionId = z.string().transform(SessionId)

/** Durable policy row. Catalog membership is not stored; each read rebuilds it. */
export const reliabilityPolicyRow = z.object({
  sessionId,
  revision: z.number().int().nonnegative(),
  enabled: z.boolean(),
  implementationModel: z.string().nullable(),
  implementationThinking: z.string().nullable(),
  reviewModel: z.string().nullable(),
  reviewThinking: z.string().nullable(),
  planningModel: z.string().nullable().optional(),
  planningThinking: z.string().nullable().optional(),
  frontendModel: z.string().nullable().optional(),
  frontendThinking: z.string().nullable().optional(),
  backendModel: z.string().nullable().optional(),
  backendThinking: z.string().nullable().optional(),
  testingModel: z.string().nullable().optional(),
  testingThinking: z.string().nullable().optional(),
  updatedAt: z.number().int().nonnegative(),
})

/** One persisted policy row. */
export type ReliabilityPolicyRow = z.infer<typeof reliabilityPolicyRow>

/**
 * The reliability-policy domain spec: one `sessions` table keyed by Session
 * id. The name uses the unit-name charset (underscores, no hyphens).
 */
export const reliabilityPolicyDomainSpec = defineDomain({
  name: 'reliability_policy',
  version: 1,
  tables: { sessions: domainTable<SessionId, ReliabilityPolicyRow>(reliabilityPolicyRow) },
})
