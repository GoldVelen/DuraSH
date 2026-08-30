/**
 * The reliability-loop domain declaration: record schema and the
 * `defineDomain` spec the runtime opens. The zod schema validates the shipped
 * format at the durability boundary; structural stage coherence is owned by
 * the `./invariant` companion, not by this schema.
 * @module @durash/dsh-reliability-loop/src/spec
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { ReliabilityLoopId } from './types.ts'
import type { ReliabilityLoopRecord } from './types.ts'

/** Loop id schema at the durable boundary; branding has no runtime representation. */
const loopId = z.string().transform(ReliabilityLoopId)

/** The two attempt rounds. */
const loopRound = z.union([z.literal(1), z.literal(2)])

/** The reviewer verdicts. */
const reviewVerdict = z.union([z.literal('approved'), z.literal('changes-requested')])

/** The closed stage vocabulary, mirrored from {@link ReliabilityLoopStage}. */
const loopStage = z.enum([
  'implementing',
  'reviewing',
  'rework-implementing',
  'rework-reviewing',
  'completed',
  'blocked',
  'failed',
  'cancelled',
])

/** One settled implementation attempt. */
export const implementAttempt = z.object({
  round: loopRound,
  summary: z.string(),
  agentsStarted: z.number().int().nonnegative(),
})

/** One settled review attempt. */
export const reviewAttempt = z.object({
  round: loopRound,
  verdict: reviewVerdict,
  feedback: z.string(),
  agentsStarted: z.number().int().nonnegative(),
})

/** Durable shape of one loop record (see {@link ReliabilityLoopRecord}). */
export const reliabilityLoopRecord = z.object({
  loopId,
  objective: z.string(),
  createdAt: z.string(),
  stage: loopStage,
  implement: implementAttempt.optional(),
  review: reviewAttempt.optional(),
  settledAt: z.string().optional(),
  error: z.string().optional(),
}) satisfies z.ZodType<ReliabilityLoopRecord>

/**
 * The reliability-loop domain spec: one `loops` table keyed by
 * {@link ReliabilityLoopId}. The spec object is the single source of the
 * domain's identity, version, and schemas; one record holds a loop's whole
 * state machine, so every transition is a single-record write. The domain
 * name uses the unit-name charset (underscores, no hyphens).
 */
export const reliabilityLoopDomainSpec = defineDomain({
  name: 'reliability_loop',
  version: 1,
  tables: { loops: domainTable<ReliabilityLoopId, ReliabilityLoopRecord>(reliabilityLoopRecord) },
})
