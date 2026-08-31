/**
 * Package-owned invariant companion for `@durash/dsh-reliability-policy`.
 * @module @durash/dsh-reliability-policy/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { DomainChanged } from '@deepseek-ai/dsh-storage-domain'

const PACKAGE_NAME = '@durash/dsh-reliability-policy'

/** Cordis companion plugin name. */
export const name = 'durash-reliability-policy-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Owned relationship: every durable `reliability_policy` row lives on the
 * `sessions` table and an enabled row names both lanes.
 */
const install: InvariantInstaller = Object.assign(
  (ctx: Context, fail: (message: string) => never) => {
    ctx.on('domain/changed', (change: DomainChanged) => {
      if (change.domain !== 'reliability_policy') return
      if (change.table !== 'sessions') {
        return fail(`reliability_policy domain changed on unexpected table '${change.table}'`)
      }
      const row = change.value as {
        enabled?: boolean
        implementationModel?: string | null
        reviewModel?: string | null
      }
      if (row.enabled === true
        && (typeof row.implementationModel !== 'string' || typeof row.reviewModel !== 'string')) {
        return fail(`enabled reliability policy '${change.key}' is missing an implementation or review model`)
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
