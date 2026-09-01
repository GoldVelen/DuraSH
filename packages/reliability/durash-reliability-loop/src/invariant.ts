/**
 * Package-owned invariant companion for `@durash/dsh-reliability-loop`: every
 * durable record that lands in the `reliability_loop` domain — as observed on
 * the `domain/changed` event stream, not through the writer — must satisfy the
 * stage/attempt-slot coherence of the shipped stage machine. A violation
 * means a write path bypassed the driver's asserted transitions or the
 * medium was corrupted.
 *
 * The companion is deliberately self-contained (no shared runtime module with
 * the package index): the shipped bundle emits one file per entry, so this
 * check re-derives the stage/slot rules from the record shape itself instead
 * of importing them. The rule table and `assertReliabilityLoopRecord` in
 * `src/checks.ts` must stay semantically equal.
 * @module @durash/dsh-reliability-loop/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { DomainChanged } from '@deepseek-ai/dsh-storage-domain'

const PACKAGE_NAME = '@durash/dsh-reliability-loop'

/** Cordis companion plugin name. */
export const name = 'durash-reliability-loop-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Slot signature of one attempt pair: the implement round, the review round,
 * and the review verdict, joined as a compact string. Every legal record
 * shape maps to exactly one signature per stage.
 */
function slotSignature(
  implement: { readonly round?: number } | undefined,
  review: { readonly round?: number; readonly verdict?: string } | undefined,
): string {
  if (implement === undefined) return review === undefined ? '-' : '?'
  if (review === undefined) return `i${implement.round}+?:?`
  return `i${implement.round}+r${review.round}:${review.verdict === 'approved' ? 'ok' : 'cr'}`
}

/** The signatures each stage can legally carry (aborted stages keep any prefix shape). */
const STAGE_SHAPES: Readonly<Record<string, string>> = {
  implementing: '-',
  reviewing: 'i1+?:?',
  'rework-implementing': 'i1+r1:cr',
  'rework-reviewing': 'i2+r1:cr',
  completed: 'i1+r1:ok | i2+r2:ok',
  blocked: 'i2+r2:cr',
  failed: '- | i1+?:? | i1+r1:cr | i2+r1:cr',
  cancelled: '- | i1+?:? | i1+r1:cr | i2+r1:cr',
}

/**
 * Check one record's stage against its attempt slots, re-deriving the rules
 * of the shipped stage machine.
 * @returns an error message when the shape is illegal, `undefined` when legal.
 */
function coherenceProblem(record: Record<string, unknown>): string | undefined {
  const stage = String(record['stage'])
  const shapes = STAGE_SHAPES[stage]
  if (shapes === undefined) return `unknown stage '${stage}'`
  const implement = record['implement'] as { readonly round?: number } | undefined
  const review = record['review'] as { readonly round?: number; readonly verdict?: string } | undefined
  const signature = slotSignature(implement, review)
  const legal = shapes.split(' | ')
  if (!legal.includes(signature)) {
    return `stage '${stage}' cannot carry slots '${signature}'`
  }
  if (implement !== undefined && implement.round === 2 && signature !== 'i2+r1:cr' && signature !== 'i2+r2:cr') {
    return 'round-2 implementation without the rework precondition'
  }
  return undefined
}

/**
 * Owned relationship: every durable `reliability_loop` record agrees with the
 * stage machine. The check runs on the event stream, independent of the
 * driver's own read/write assertions.
 */
const install: InvariantInstaller = Object.assign(
  (ctx: Context, fail: (message: string) => never) => {
    ctx.on('domain/changed', (change: DomainChanged) => {
      if (change.domain !== 'reliability_loop') return
      if (change.table !== 'loops') {
        return fail(`reliability_loop domain changed on unexpected table '${change.table}'`)
      }
      const problem = coherenceProblem(change.value as Record<string, unknown>)
      if (problem !== undefined) {
        return fail(`durable reliability-loop record '${change.key}' violates the stage machine: ${problem}`)
      }
    }, { global: true })
  },
  { inject: [] },
)

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
