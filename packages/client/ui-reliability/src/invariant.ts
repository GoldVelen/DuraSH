/**
 * Package-owned invariant companion for `@durash/dsh-client-ui-reliability`.
 * @module @durash/dsh-client-ui-reliability/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@durash/dsh-client-ui-reliability'

/** Cordis companion plugin name. */
export const name = 'durash-client-ui-reliability-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: policy state is audited by the Host policy service,
 * while the switch is a slot effect whose registration and teardown are
 * exercised by this package.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
