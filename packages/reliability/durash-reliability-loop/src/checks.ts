/**
 * Pure record checks shared by the runtime writer and the invariant companion:
 * the durable record's stage and its settled attempt slots must agree. The
 * stage machine's transitions are the only writer, so a record that violates
 * these relationships means the medium was corrupted or written by an
 * incompatible build — the runtime refuses it instead of resuming from a
 * state it cannot reconstruct.
 * @module @durash/dsh-reliability-loop/src/checks
 */

import { isTerminalStage } from './types.ts'
import type { ImplementAttempt, ReliabilityLoopRecord, ReviewAttempt } from './types.ts'

/**
 * Assert the record's stage matches its settled attempt slots.
 * @param record - the record read from or about to be written to the domain.
 * @throws when the stage and the attempt slots cannot come from any
 *   transition path of the shipped stage machine.
 */
export function assertReliabilityLoopRecord(record: ReliabilityLoopRecord): void {
  const settled = record.settledAt !== undefined
  if (isTerminalStage(record.stage) !== settled) {
    throw new Error(`loop '${record.loopId}': stage '${record.stage}' and settledAt presence disagree`)
  }
  if ((record.stage === 'failed') !== (record.error !== undefined)) {
    throw new Error(`loop '${record.loopId}': stage '${record.stage}' and error presence disagree`)
  }
  const { implement, review } = record
  switch (record.stage) {
    case 'implementing':
      if (implement !== undefined || review !== undefined) throw stageMismatch(record, 'implementing')
      return
    case 'reviewing':
      if (implement === undefined || implement.round !== 1 || review !== undefined) {
        throw stageMismatch(record, 'reviewing')
      }
      return
    case 'rework-implementing':
      if (!isChangesRequestedAt(implement, 1, review, 1)) throw stageMismatch(record, 'rework-implementing')
      return
    case 'rework-reviewing':
      if (implement === undefined || implement.round !== 2 || !isChangesRequestedAt(implement, 2, review, 1)) {
        throw stageMismatch(record, 'rework-reviewing')
      }
      return
    case 'completed':
      if (!isApprovedPair(implement, review)) throw stageMismatch(record, 'completed')
      return
    case 'blocked':
      if (implement === undefined || implement.round !== 2
        || review === undefined || review.round !== 2 || review.verdict !== 'changes-requested') {
        throw stageMismatch(record, 'blocked')
      }
      return
    case 'failed':
    case 'cancelled':
      // An aborted loop keeps whatever coherent prefix it had settled; every
      // prefix shape is exactly one of the non-terminal stage shapes.
      if (implement === undefined) {
        if (review !== undefined) throw stageMismatch(record, record.stage)
        return
      }
      if (implement.round === 1) {
        if (review !== undefined && !isChangesRequestedAt(implement, 1, review, 1)) {
          throw stageMismatch(record, record.stage)
        }
        return
      }
      if (review === undefined || review.round !== 1 || review.verdict !== 'changes-requested') {
        throw stageMismatch(record, record.stage)
      }
      return
    /* v8 ignore start -- ReliabilityLoopStage is a closed union; a future variant fails loudly */
    default:
      throw new Error(`loop '${record.loopId}': unknown stage '${String(record.stage satisfies never)}'`)
    /* v8 ignore stop */
  }
}

/** Round-1 implement followed by a round-1 `changes-requested` review. */
function isChangesRequestedAt(
  implement: ImplementAttempt | undefined,
  implementRound: 1 | 2,
  review: ReviewAttempt | undefined,
  reviewRound: 1 | 2,
): boolean {
  return implement !== undefined && implement.round === implementRound
    && review !== undefined && review.round === reviewRound && review.verdict === 'changes-requested'
}

/** The two approved shapes: original pass approved, or rework pass approved. */
function isApprovedPair(implement: ImplementAttempt | undefined, review: ReviewAttempt | undefined): boolean {
  return implement !== undefined && review !== undefined && review.verdict === 'approved'
    && ((implement.round === 1 && review.round === 1) || (implement.round === 2 && review.round === 2))
}

/** One mismatch message naming the stage and both attempt slots. */
function stageMismatch(record: ReliabilityLoopRecord, stage: string): Error {
  return new Error(
    `loop '${record.loopId}': stage '${stage}' disagrees with attempt slots `
    + `(implement round ${record.implement?.round ?? 'none'}, review round ${record.review?.round ?? 'none'} `
    + `${record.review?.verdict ?? ''})`,
  )
}
