/**
 * Per-session reliability-loop policy vocabulary shared by Host RPC and the
 * composer switch. Types only, so the generated Remote client never imports
 * Host runtime code.
 * @module @durash/dsh-reliability-policy/types
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Thinking effort stored on a lane; the worker-thread engine does not yet apply it to children. */
export type ReliabilityThinking = string

/** Channel grouping used by the composer model picker. */
export type ReliabilityModelChannel = 'default' | 'cursor'

/** One catalog badge rendered next to a model option. */
export interface ReliabilityModelBadge {
  readonly kind: 'channel' | 'provider'
  readonly label: string
}

/** One selectable implementation or review model. */
export interface ReliabilityModelOption {
  /** `provider/model` selector persisted on the policy row. */
  readonly selector: string
  /** Human-readable model name. */
  readonly label: string
  /** Provider route that owns the model. */
  readonly provider: string
  /** Model id passed to the stage child. */
  readonly model: string
  /** Channel and provider badges for the picker. */
  readonly badges: readonly ReliabilityModelBadge[]
  /** Effort levels the switch offers for this model. */
  readonly thinkingLevels: readonly ReliabilityThinking[]
}

/** Parsed provider/model override for one loop lane. */
export interface ReliabilityLaneRoute {
  readonly provider: string
  readonly model: string
}

/** Session-bound policy the composer switch reads and writes. */
export interface ReliabilityPolicySnapshot {
  readonly sessionId: SessionId
  readonly revision: number
  readonly enabled: boolean
  readonly implementationModel: string | null
  readonly implementationThinking: ReliabilityThinking | null
  readonly reviewModel: string | null
  readonly reviewThinking: ReliabilityThinking | null
  readonly updatedAt: number
  readonly models: readonly ReliabilityModelOption[]
}

/** Session identity for a policy read. */
export interface ReliabilityPolicyRequest {
  readonly sessionId: SessionId
}

/** Session policy replacement from the composer switch. */
export interface ReliabilityPolicyConfigureRequest {
  readonly sessionId: SessionId
  readonly enabled: boolean
  readonly implementationModel: string | null
  readonly implementationThinking: ReliabilityThinking | null
  readonly reviewModel: string | null
  readonly reviewThinking: ReliabilityThinking | null
}
