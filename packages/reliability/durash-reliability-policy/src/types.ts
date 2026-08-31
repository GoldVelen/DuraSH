/**
 * Per-session reliability-loop policy vocabulary shared by Host RPC and the
 * composer switch. Types only, so the generated Remote client never imports
 * Host runtime code.
 * @module @durash/dsh-reliability-policy/types
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ReasoningEffortId } from '@deepseek-ai/dsh-llm/brand'

/** Adapter-owned reasoning effort stored on one lane. */
export type ReliabilityThinking = string

/** Channel grouping used by the composer model picker. */
export type ReliabilityModelChannel = 'default' | 'cursor'

/** One catalog badge rendered next to a model option. */
export interface ReliabilityModelBadge {
  readonly kind: 'channel' | 'provider'
  readonly label: string
}

/** One adapter-owned effort exposed for an exact provider/model route. */
export interface ReliabilityReasoningEffortOption {
  /** Opaque effort id passed unchanged to the child model request. */
  readonly id: ReliabilityThinking
  /** Adapter-owned display name. */
  readonly name: string
  /** Optional adapter-owned explanation. */
  readonly description?: string
  /** Whether the adapter materializes this value when callers omit an effort. */
  readonly isDefault: boolean
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
  /** Exact-model reasoning efforts in adapter-preferred display order. */
  readonly reasoningEfforts: readonly ReliabilityReasoningEffortOption[]
}

/** Parsed provider/model override for one loop lane. */
export interface ReliabilityLaneRoute {
  readonly provider: string
  readonly model: string
  /** Omitted only when the exact model exposes no reasoning controls. */
  readonly reasoningEffort?: ReasoningEffortId
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
  /** Current catalog mismatch retained without rewriting the saved selection. */
  readonly validationError: string | null
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
