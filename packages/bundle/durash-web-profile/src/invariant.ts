/** Package-owned invariant companion for the DuraSH Web profile. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@durash/dsh-web-profile'

/** Cordis companion plugin name. */
export const name = 'durash-web-profile-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

// No runtime invariant: the package carries only a static overlay. The brand
// package owns its profile guard, and the profile-composition test owns activation.
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
