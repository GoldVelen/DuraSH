/**
 * Package-owned invariant companion for `@durash/dsh-reliability-loop`: every
 * durable record that lands in the `reliability_loop` domain — as observed on
 * the `domain/changed` event stream, not through the writer — must satisfy the
 * stage/round coherence of the shipped state machine. A violation
 * means a write path bypassed the driver's asserted transitions or the
 * medium was corrupted.
 *
 * The companion is deliberately self-contained (no shared runtime module with
 * the package index): the shipped bundle emits one file per entry, so this
 * check re-derives the stage/round relationships from the record shape itself
 * instead of importing them. The storage schema owns field structure and the
 * writer-side `assertReliabilityLoopRecord` additionally owns timestamp and
 * lane relationships.
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
 * Compact signature for the retained round reports.
 */
function roundSignature(rounds: readonly unknown[]): string {
  return rounds.map((value, index) => {
    const round = value as {
      readonly round?: number
      readonly implementation?: { readonly round?: number }
      readonly review?: { readonly round?: number; readonly verdict?: string }
    }
    if (round.round !== index + 1 || round.implementation?.round !== index + 1) return '?'
    if (round.review === undefined) return `i${String(round.round)}`
    if (round.review.round !== round.round) return '?'
    return `i${String(round.round)}+r${String(round.round)}:${round.review.verdict === 'approved' ? 'ok' : 'cr'}`
  }).join(',') || '-'
}

/** The signatures each stage can legally carry; stopped stages keep a coherent prefix. */
const STAGE_SHAPES: Readonly<Record<string, string>> = {
  accepted: '-',
  implementing: '-',
  reviewing: 'i1',
  'rework-implementing': 'i1+r1:cr',
  'rework-reviewing': 'i1+r1:cr,i2',
  completed: 'i1+r1:ok | i1+r1:cr,i2+r2:ok',
  blocked: 'i1+r1:cr,i2+r2:cr',
  failed: '- | i1 | i1+r1:cr | i1+r1:cr,i2',
  cancelled: '- | i1 | i1+r1:cr | i1+r1:cr,i2',
}

/**
 * Check one record's stage against its retained rounds, re-deriving the rules
 * of the shipped stage machine.
 * @returns an error message when the shape is illegal, `undefined` when legal.
 */
function coherenceProblem(record: Record<string, unknown>): string | undefined {
  const stage = String(record['stage'])
  const shapes = STAGE_SHAPES[stage]
  if (shapes === undefined) return `unknown stage '${stage}'`
  if (!Number.isSafeInteger(record['revision']) || Number(record['revision']) < 1) return 'revision is not positive'
  const terminal = ['completed', 'blocked', 'failed', 'cancelled'].includes(stage)
  if (terminal !== (typeof record['settledAt'] === 'string')) return `stage '${stage}' and settledAt disagree`
  if ((stage === 'failed') !== (typeof record['error'] === 'string')) return `stage '${stage}' and error disagree`
  if (record['dismissedAt'] !== undefined && !terminal) return `non-terminal stage '${stage}' is dismissed`
  const rounds = Array.isArray(record['rounds']) ? record['rounds'] : []
  const signature = roundSignature(rounds)
  const legal = shapes.split(' | ')
  if (!legal.includes(signature)) {
    return `stage '${stage}' cannot carry rounds '${signature}'`
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
