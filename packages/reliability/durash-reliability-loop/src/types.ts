/**
 * Reliability-loop vocabulary: loop identity, the durable stage machine, and
 * the handle types a caller holds. Types only (plus the id-brand factory),
 * per the package convention.
 * @module @durash/dsh-reliability-loop/types
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Identifies one reliability loop across restarts (runtime-minted UUID). */
export type ReliabilityLoopId = Branded<'ReliabilityLoopId'>

/**
 * Brand a string as a {@link ReliabilityLoopId}.
 * @param id - the raw id string (the runtime mints UUIDs; tests may pass fixtures).
 * @returns the same string, branded.
 */
export function ReliabilityLoopId(id: string): ReliabilityLoopId {
  return id as ReliabilityLoopId
}

/** One attempt's round: `1` is the original pass, `2` the single bounded rework. */
export type LoopRound = 1 | 2

/** Why a reviewer's report accepted or rejected an implementation. */
export type ReviewVerdict = 'approved' | 'changes-requested'

/**
 * Durable loop stage. CLOSED union (runtime-owned, callers may exhaust). The
 * four `-ing` stages each name one workflow run the loop is — or was, before
 * a restart — executing; the four terminal stages are final. `blocked` stops
 * the loop after the bounded rework still drew `changes-requested`; the
 * settled round-2 review attempt carries the durable blocker.
 */
export type ReliabilityLoopStage =
  | 'implementing'
  | 'reviewing'
  | 'rework-implementing'
  | 'rework-reviewing'
  | 'completed'
  | 'blocked'
  | 'failed'
  | 'cancelled'

/** The terminal members of {@link ReliabilityLoopStage}. */
export type TerminalReliabilityLoopStage = Extract<
  ReliabilityLoopStage,
  'completed' | 'blocked' | 'failed' | 'cancelled'
>

/** The terminal members of {@link ReliabilityLoopStage}. */
export const TERMINAL_STAGES: readonly [
  'completed', 'blocked', 'failed', 'cancelled',
] = ['completed', 'blocked', 'failed', 'cancelled']

/**
 * Test a stage for terminality.
 * @param stage - the stage to test.
 * @returns whether the stage is terminal (a settled loop).
 */
export function isTerminalStage(stage: ReliabilityLoopStage): stage is TerminalReliabilityLoopStage {
  return (TERMINAL_STAGES as readonly string[]).includes(stage)
}

/** One settled implementation attempt. */
export interface ImplementAttempt {
  /** Which pass produced it. */
  readonly round: LoopRound
  /** The implementer's bounded work summary. */
  readonly summary: string
  /** How many `agent()` calls the stage run accepted. */
  readonly agentsStarted: number
}

/** One settled review attempt. */
export interface ReviewAttempt {
  /** Which pass produced it. */
  readonly round: LoopRound
  /** The reviewer's decision. */
  readonly verdict: ReviewVerdict
  /** The reviewer's evidence; a `changes-requested` verdict names the required modifications. */
  readonly feedback: string
  /** How many `agent()` calls the stage run accepted. */
  readonly agentsStarted: number
}

/**
 * The durable record of one loop — the single authoritative state. Optional
 * slots name `| undefined` explicitly because the zod durable-boundary schema
 * produces that shape and the repo compiles with `exactOptionalPropertyTypes`.
 * Stage semantics (which attempt slots must be settled for which stage) are
 * owned by the runtime and asserted by the `./invariant` companion.
 */
export interface ReliabilityLoopRecord {
  /** The loop's id. */
  readonly loopId: ReliabilityLoopId
  /** What the implementation must achieve, verbatim from the caller. */
  readonly objective: string
  /** Creation instant, ISO-8601. */
  readonly createdAt: string
  /** Current stage. */
  readonly stage: ReliabilityLoopStage
  /** The settled implementation attempt, when one has completed. */
  readonly implement?: ImplementAttempt | undefined
  /** The settled review attempt, when one has completed. */
  readonly review?: ReviewAttempt | undefined
  /** Settlement instant, ISO-8601; present iff `stage` is terminal. */
  readonly settledAt?: string | undefined
  /** Failure detail; present iff `stage` is `failed`. */
  readonly error?: string | undefined
  /** Implementation-stage provider route, when the caller selected one. */
  readonly implementationProvider?: string | undefined
  /** Implementation-stage model id, when the caller selected one. */
  readonly implementationModel?: string | undefined
  /** Review-stage provider route, when the caller selected one. */
  readonly reviewProvider?: string | undefined
  /** Review-stage model id, when the caller selected one. */
  readonly reviewModel?: string | undefined
}

/**
 * A caller-owned live loop. `result` settles once the loop has durably
 * reached a terminal stage AND the last stage run's resources are released;
 * after that point the loop writes nothing and owns nothing.
 */
export interface ReliabilityLoopHandle {
  /** The loop's id. */
  readonly loopId: ReliabilityLoopId
  /**
   * Settles with the terminal durable record. Never rejects for loop-internal
   * failures (those land in the record as `failed`); it rejects only when the
   * durable record itself cannot be maintained (a storage fault), because no
   * terminal record can be delivered then.
   */
  readonly result: Promise<ReliabilityLoopRecord>
  /**
   * Request cancellation: the in-flight stage run is cancelled and the loop
   * settles `cancelled`. Idempotent; the first reason wins. A stage that
   * already settled is kept.
   * @param reason - human-readable cause (default `'reliability loop cancelled'`).
   */
  cancel(reason?: string): void
  /**
   * Cancel if needed and await durable settlement plus resource quiescence.
   * Never rejects; idempotent; safe on every path.
   */
  dispose(): Promise<void>
}

/** Optional provider/model override for one stage lane. */
export interface ReliabilityLoopLane {
  /** Provider route for that lane's child. */
  readonly provider: string
  /** Model id for that lane's child. */
  readonly model: string
}

/** What a caller asks for when starting one loop. */
export interface ReliabilityLoopStartRequest {
  /** The agent on whose behalf the loop runs (parent of every stage child). */
  parent: Agent
  /** What the implementation must achieve; bounded by `maxHandoffChars`. */
  objective: string
  /** Implementation-stage child route; omitted children inherit the parent. */
  implementation?: ReliabilityLoopLane
  /** Review-stage child route; omitted children inherit the parent. */
  review?: ReliabilityLoopLane
}
