/**
 * Pure fold for the client-visible reliability-loop Session projection.
 * Execution recovery never reads this projection; the storage domain remains
 * the sole workflow authority.
 * @module @durash/dsh-reliability-loop/src/projection
 */

import { z } from 'zod'
import type { ZodType } from 'zod'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm/brand'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { ReliabilityLoopId } from './types.ts'
import type { ReliabilityLoopStatusView } from './types.ts'

/** Checkpoint-safe fold state, including stale-revision detection facts. */
export interface ReliabilityLoopProjectionState {
  /** Current dock value. */
  readonly current: ReliabilityLoopStatusView | null
  /** Greatest accepted revision per loop id. */
  readonly seenRevisions: Readonly<Record<string, number>>
  /** First invalid owned event, or null while replay remains valid. */
  readonly failure: string | null
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    reliabilityLoop: ReliabilityLoopProjectionState
  }
}

const laneSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  reasoningEffort: z.string().min(1).transform(ReasoningEffortId).optional(),
}).strict()

const stageSchema = z.enum([
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

/** Wire schema for the compact status view. */
export const reliabilityLoopStatusSchema: ZodType<ReliabilityLoopStatusView> = z.object({
  loopId: z.string().min(1).transform(ReliabilityLoopId),
  revision: z.number().int().positive(),
  stage: stageSchema,
  objectiveSummary: z.string().max(160),
  implementation: laneSchema,
  review: laneSchema,
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  settledAt: z.string().min(1).optional(),
  error: z.string().optional(),
  terminalSummary: z.string().max(800).optional(),
}).strict() satisfies ZodType<ReliabilityLoopStatusView>

const projectionStateSchema: ZodType<ReliabilityLoopProjectionState> = z.object({
  current: reliabilityLoopStatusSchema.nullable(),
  seenRevisions: z.record(z.string(), z.number().int().positive()),
  failure: z.string().min(1).nullable(),
}).strict() satisfies ZodType<ReliabilityLoopProjectionState>

/**
 * Fold one committed event without allowing a same-loop revision rollback.
 * @param state - state covering all earlier events.
 * @param event - next committed Session event.
 * @returns the next state, or the same reference for unrelated events.
 */
export function applyReliabilityLoopProjection(
  state: ReliabilityLoopProjectionState,
  event: SessionEvent,
): ReliabilityLoopProjectionState {
  if (state.failure !== null || event.type !== 'reliability-loop/change') return state
  const current = event.data.current
  if (current === null) {
    if (state.current === null) return state
    return { ...state, current: null }
  }
  const previous = state.seenRevisions[current.loopId] ?? 0
  if (current.revision < previous) {
    return {
      ...state,
      failure: `reliability loop '${current.loopId}' revision ${current.revision} follows revision ${previous}`,
    }
  }
  if (current.revision === previous) return state
  return {
    current,
    seenRevisions: { ...state.seenRevisions, [current.loopId]: current.revision },
    failure: null,
  }
}

/** Client-visible reliability-loop projection definition. */
export const reliabilityLoopProjectionDefinition = {
  key: 'reliabilityLoop',
  stateSchema: projectionStateSchema,
  init: (): ReliabilityLoopProjectionState => ({ current: null, seenRevisions: {}, failure: null }),
  apply: applyReliabilityLoopProjection,
  wire: { viewSchema: reliabilityLoopStatusSchema.nullable(), view: state => state.current },
  stateVersion: 1,
} satisfies ProjectionDefinition<'reliabilityLoop', ReliabilityLoopProjectionState>
