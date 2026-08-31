/**
 * Version-2 reliability-loop storage domain declaration.
 * @module @durash/dsh-reliability-loop/src/spec
 */

import { z } from 'zod'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { ReliabilityLoopId } from './types.ts'
import type { ReliabilityLoopRecord } from './types.ts'

const loopId = z.string().min(1).transform(ReliabilityLoopId)
const sessionId = z.string().min(1).transform(SessionId)
const loopRound = z.union([z.literal(1), z.literal(2)])
const reviewVerdict = z.union([z.literal('approved'), z.literal('changes-requested')])
const loopStage = z.enum([
  'accepted',
  'implementing',
  'reviewing',
  'rework-implementing',
  'rework-reviewing',
  'completed',
  'blocked',
  'failed',
  'cancelled',
])

/** One exact stage route persisted before background work starts. */
export const reliabilityLoopLane = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  reasoningEffort: z.string().min(1).transform(ReasoningEffortId).optional(),
})

/** One settled implementation report. */
export const implementAttempt = z.object({
  round: loopRound,
  summary: z.string(),
  agentsStarted: z.number().int().nonnegative(),
})

/** One settled review report. */
export const reviewAttempt = z.object({
  round: loopRound,
  verdict: reviewVerdict,
  feedback: z.string(),
  agentsStarted: z.number().int().nonnegative(),
})

/** Reports retained for one pass. */
export const reliabilityLoopRoundRecord = z.object({
  round: loopRound,
  implementation: implementAttempt.optional(),
  review: reviewAttempt.optional(),
})

/** Durable version-2 record shape. */
export const reliabilityLoopRecord = z.object({
  loopId,
  revision: z.number().int().positive(),
  sessionId,
  objective: z.string().min(1),
  stage: loopStage,
  implementation: reliabilityLoopLane,
  review: reliabilityLoopLane,
  rounds: z.array(reliabilityLoopRoundRecord).max(2),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  settledAt: z.string().min(1).optional(),
  error: z.string().optional(),
  dismissedAt: z.string().min(1).optional(),
}) satisfies z.ZodType<ReliabilityLoopRecord>

/**
 * One-record-per-loop storage domain. Version 1 is deliberately unsupported:
 * it lacks Session ownership, revisions, complete lanes, and separate rounds.
 */
export const reliabilityLoopDomainSpec = defineDomain({
  name: 'reliability_loop',
  version: 2,
  tables: { loops: domainTable<ReliabilityLoopId, ReliabilityLoopRecord>(reliabilityLoopRecord) },
})
