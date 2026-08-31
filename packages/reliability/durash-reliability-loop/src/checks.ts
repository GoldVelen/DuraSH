/**
 * Structural invariants for the version-2 reliability-loop record.
 * @module @durash/dsh-reliability-loop/src/checks
 */

import { isTerminalStage } from './types.ts'
import type { ReliabilityLoopRecord, ReliabilityLoopRoundRecord } from './types.ts'

type Prefix = 'none' | 'implementation-1' | 'changes-1' | 'implementation-2'

/**
 * Assert that one durable record can be produced by the shipped bounded state
 * machine.
 * @param record - record read from or about to enter the storage domain.
 * @throws when identity, time, stage, terminal, or round relationships disagree.
 */
export function assertReliabilityLoopRecord(record: ReliabilityLoopRecord): void {
  if (!Number.isSafeInteger(record.revision) || record.revision < 1) {
    throw mismatch(record, 'revision must be a positive safe integer')
  }
  if (record.sessionId.length === 0 || record.objective.length === 0) {
    throw mismatch(record, 'sessionId and objective must be non-empty')
  }
  assertLane(record, 'implementation')
  assertLane(record, 'review')
  const created = instant(record, 'createdAt', record.createdAt)
  const updated = instant(record, 'updatedAt', record.updatedAt)
  if (updated < created) throw mismatch(record, 'updatedAt precedes createdAt')

  const terminal = isTerminalStage(record.stage)
  if (terminal !== (record.settledAt !== undefined)) {
    throw mismatch(record, `stage '${record.stage}' and settledAt presence disagree`)
  }
  if ((record.stage === 'failed') !== (record.error !== undefined)) {
    throw mismatch(record, `stage '${record.stage}' and error presence disagree`)
  }
  if (record.dismissedAt !== undefined && !terminal) {
    throw mismatch(record, 'a non-terminal loop cannot be dismissed')
  }
  if (record.settledAt !== undefined) {
    const settled = instant(record, 'settledAt', record.settledAt)
    if (settled < created || settled > updated) throw mismatch(record, 'settledAt falls outside the record lifetime')
    if (record.dismissedAt !== undefined) {
      const dismissed = instant(record, 'dismissedAt', record.dismissedAt)
      if (dismissed < settled || dismissed > updated) throw mismatch(record, 'dismissedAt falls outside the terminal lifetime')
    }
  }

  const prefix = prefixOf(record)
  switch (record.stage) {
    case 'accepted':
    case 'implementing':
      if (prefix !== 'none') throw stageMismatch(record, prefix)
      return
    case 'reviewing':
      if (prefix !== 'implementation-1') throw stageMismatch(record, prefix)
      return
    case 'rework-implementing':
      if (prefix !== 'changes-1') throw stageMismatch(record, prefix)
      return
    case 'rework-reviewing':
      if (prefix !== 'implementation-2') throw stageMismatch(record, prefix)
      return
    case 'completed':
      if (!approvedAt(record.rounds, 1) && !approvedAt(record.rounds, 2)) throw stageMismatch(record, prefix)
      return
    case 'blocked':
      if (!changesAt(record.rounds, 1) || !changesAt(record.rounds, 2)) throw stageMismatch(record, prefix)
      return
    case 'failed':
    case 'cancelled':
      return
    /* v8 ignore start -- closed union drift must fail at this invariant. */
    default:
      throw mismatch(record, `unknown stage '${String(record.stage satisfies never)}'`)
    /* v8 ignore stop */
  }
}

/** Validate a required lane without assuming provider-specific values. */
function assertLane(record: ReliabilityLoopRecord, key: 'implementation' | 'review'): void {
  const lane = record[key]
  if (lane.provider.length === 0 || lane.model.length === 0 || lane.reasoningEffort === '') {
    throw mismatch(record, `${key} lane is incomplete`)
  }
}

/** Parse one required ISO timestamp. */
function instant(record: ReliabilityLoopRecord, key: string, value: string): number {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw mismatch(record, `${key} is not a valid instant`)
  return parsed
}

/** Classify every coherent unsettled prefix and reject malformed round arrays. */
function prefixOf(record: ReliabilityLoopRecord): Prefix {
  const rounds = record.rounds
  if (rounds.length === 0) return 'none'
  const first = rounds[0]
  if (first?.round !== 1 || (first.implementation !== undefined && first.implementation.round !== 1)
    || (first.review !== undefined && first.review.round !== 1)) {
    throw mismatch(record, 'round one fields do not carry round 1')
  }
  if (first.implementation === undefined) throw mismatch(record, 'round one review cannot precede implementation')
  if (rounds.length === 1) {
    if (first.review === undefined) return 'implementation-1'
    if (first.review.verdict === 'approved') {
      if (record.stage !== 'completed') throw mismatch(record, 'an approved round one must complete the loop')
      return 'implementation-1'
    }
    return 'changes-1'
  }
  if (rounds.length !== 2) throw mismatch(record, 'the bounded loop permits at most two rounds')
  if (first.review?.verdict !== 'changes-requested') {
    throw mismatch(record, 'round two requires round-one changes-requested')
  }
  const second = rounds[1]
  if (second?.round !== 2 || (second.implementation !== undefined && second.implementation.round !== 2)
    || (second.review !== undefined && second.review.round !== 2)) {
    throw mismatch(record, 'round two fields do not carry round 2')
  }
  if (second.implementation === undefined) throw mismatch(record, 'round two review cannot precede implementation')
  if (second.review?.verdict === 'approved' && record.stage !== 'completed') {
    throw mismatch(record, 'an approved round two must complete the loop')
  }
  if (second.review?.verdict === 'changes-requested' && record.stage !== 'blocked') {
    throw mismatch(record, 'round-two changes-requested must block the loop')
  }
  return 'implementation-2'
}

/** Whether one round settled approved. */
function approvedAt(rounds: readonly ReliabilityLoopRoundRecord[], round: 1 | 2): boolean {
  return rounds[round - 1]?.review?.verdict === 'approved'
}

/** Whether one round settled changes-requested. */
function changesAt(rounds: readonly ReliabilityLoopRoundRecord[], round: 1 | 2): boolean {
  return rounds[round - 1]?.review?.verdict === 'changes-requested'
}

function stageMismatch(record: ReliabilityLoopRecord, prefix: Prefix): Error {
  return mismatch(record, `stage '${record.stage}' disagrees with report prefix '${prefix}'`)
}

function mismatch(record: ReliabilityLoopRecord, problem: string): Error {
  return new Error(`loop '${record.loopId}': ${problem}`)
}
