/**
 * Client-safe reliability-loop vocabulary: durable identity, lane snapshots,
 * status projection, terminal delivery, and authenticated Remote results.
 * @module @durash/dsh-reliability-loop/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { ReasoningEffortId } from '@deepseek-ai/dsh-llm/brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Identifies one reliability loop across Host restarts. */
export type ReliabilityLoopId = Branded<'ReliabilityLoopId'>

/**
 * Brand a persisted string as a reliability-loop id.
 * @param id - raw persisted or freshly minted id.
 * @returns the same string with the loop-id brand.
 */
export function ReliabilityLoopId(id: string): ReliabilityLoopId {
  return id as ReliabilityLoopId
}

/** Compare-and-set identity for one exact durable loop revision. */
export interface ReliabilityLoopRef {
  readonly loopId: ReliabilityLoopId
  readonly revision: number
}

/** One attempt's round: the original pass or the single bounded rework. */
export type LoopRound = 1 | 2

/** Why a review accepted or rejected one implementation attempt. */
export type ReviewVerdict = 'approved' | 'changes-requested'

/** Durable workflow stage. */
export type ReliabilityLoopStage =
  | 'accepted'
  | 'implementing'
  | 'reviewing'
  | 'rework-implementing'
  | 'rework-reviewing'
  | 'completed'
  | 'blocked'
  | 'failed'
  | 'cancelled'

/** Terminal workflow stages. */
export type TerminalReliabilityLoopStage = Extract<
  ReliabilityLoopStage,
  'completed' | 'blocked' | 'failed' | 'cancelled'
>

/** Closed terminal-stage list in display order. */
export const TERMINAL_STAGES: readonly TerminalReliabilityLoopStage[] = [
  'completed', 'blocked', 'failed', 'cancelled',
]

/**
 * Test a stage for terminality.
 * @param stage - stage to classify.
 * @returns whether the stage is final.
 */
export function isTerminalStage(stage: ReliabilityLoopStage): stage is TerminalReliabilityLoopStage {
  return (TERMINAL_STAGES as readonly string[]).includes(stage)
}

/** Exact provider/model/effort snapshot for one stage lane. */
export interface ReliabilityLoopLane {
  /** Provider route used by the stage child. */
  readonly provider: string
  /** Exact model id used by the stage child. */
  readonly model: string
  /** Adapter-owned effort id; omitted for models without reasoning controls. */
  readonly reasoningEffort?: ReasoningEffortId | undefined
}

/** One settled implementation report. */
export interface ImplementAttempt {
  /** Pass that produced this report. */
  readonly round: LoopRound
  /** Bounded implementation summary. */
  readonly summary: string
  /** Number of workflow `agent()` calls accepted by the stage. */
  readonly agentsStarted: number
}

/** One settled review report. */
export interface ReviewAttempt {
  /** Pass that produced this report. */
  readonly round: LoopRound
  /** Review decision. */
  readonly verdict: ReviewVerdict
  /** Bounded evidence or required modifications. */
  readonly feedback: string
  /** Number of workflow `agent()` calls accepted by the stage. */
  readonly agentsStarted: number
}

/** Durable reports retained for one pass without overwriting another pass. */
export interface ReliabilityLoopRoundRecord {
  /** Pass represented by this record. */
  readonly round: LoopRound
  /** Settled implementation report, when that stage committed. */
  readonly implementation?: ImplementAttempt | undefined
  /** Settled review report, when that stage committed. */
  readonly review?: ReviewAttempt | undefined
}

/** Version-2 durable execution record and sole workflow state authority. */
export interface ReliabilityLoopRecord extends ReliabilityLoopRef {
  /** Owning root Session. */
  readonly sessionId: SessionId
  /** Complete objective supplied by the handoff call. */
  readonly objective: string
  /** Current durable stage. */
  readonly stage: ReliabilityLoopStage
  /** Immutable implementation route snapshot. */
  readonly implementation: ReliabilityLoopLane
  /** Immutable review route snapshot. */
  readonly review: ReliabilityLoopLane
  /** Settled reports for round one and, when reached, round two. */
  readonly rounds: readonly ReliabilityLoopRoundRecord[]
  /** Creation instant in ISO-8601 form. */
  readonly createdAt: string
  /** Latest durable mutation instant in ISO-8601 form. */
  readonly updatedAt: string
  /** Settlement instant, present exactly for terminal stages. */
  readonly settledAt?: string | undefined
  /** Bounded failure detail, present exactly for `failed`. */
  readonly error?: string | undefined
  /** User dismissal instant; present only on a terminal record. */
  readonly dismissedAt?: string | undefined
}

/** Compact Session projection used by the composer status dock. */
export interface ReliabilityLoopStatusView extends ReliabilityLoopRef {
  /** Current durable stage. */
  readonly stage: ReliabilityLoopStage
  /** At most 160 characters from the objective. */
  readonly objectiveSummary: string
  /** Immutable implementation route snapshot. */
  readonly implementation: ReliabilityLoopLane
  /** Immutable review route snapshot. */
  readonly review: ReliabilityLoopLane
  /** Creation instant in ISO-8601 form. */
  readonly createdAt: string
  /** Latest durable mutation instant in ISO-8601 form. */
  readonly updatedAt: string
  /** Settlement instant for terminal stages. */
  readonly settledAt?: string | undefined
  /** At most the configured handoff bound for a failed loop. */
  readonly error?: string | undefined
  /** At most 800 characters, derived deterministically for terminal stages. */
  readonly terminalSummary?: string | undefined
}

/** Full authenticated details returned on demand. */
export interface ReliabilityLoopDetails extends ReliabilityLoopStatusView {
  /** Complete bounded objective. */
  readonly objective: string
  /** Every settled round report. */
  readonly rounds: readonly ReliabilityLoopRoundRecord[]
}

/** Once-per-loop terminal Conversation notification. */
export interface ReliabilityLoopTerminalNotice extends ReliabilityLoopRef {
  /** Final stage. */
  readonly stage: TerminalReliabilityLoopStage
  /** Settlement instant. */
  readonly settledAt: string
  /** Deterministic bounded result summary. */
  readonly summary: string
}

/** Whole-value Session projection change derived from the durable domain. */
export interface ReliabilityLoopChange {
  readonly version: 1
  /** Reliability work is background work and does not belong to a chat turn. */
  readonly turn: null
  /** Selected current status, or null after the latest terminal loop is dismissed. */
  readonly current: ReliabilityLoopStatusView | null
  /** Present only on the first committed terminal delivery for one loop. */
  readonly terminal?: ReliabilityLoopTerminalNotice | undefined
}

/** Durable start acknowledgement returned before any stage completes. */
export interface ReliabilityLoopStartAck extends ReliabilityLoopRef {
  readonly status: 'accepted'
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Complete client status plus an optional once-per-loop terminal notice.
     * @param data - whole-value reliability-loop projection change.
     */
    'reliability-loop/change': ReliabilityLoopChange
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Current reliability status for this Session, or null when no dock is visible. */
    reliabilityLoop: ReliabilityLoopStatusView | null
  }
}
