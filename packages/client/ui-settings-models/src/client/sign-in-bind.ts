/**
 * Optional Client binding of the Models sign-in Remote. The page cannot list
 * `remote.authorization` in its required inject: a composition or fixture that
 * never mounts the namespace would park the whole Models plugin. The
 * uninjected accessor `ctx.remote.authorization` still throws when the
 * namespace *is* mounted — Cordis requires inject to read a declared service —
 * so the page forwards through this handle, reads the store with `ctx.get`,
 * and rebinds when `ctx.inject(['remote.authorization'])` starts.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ModelsAuthorization } from './sign-in-store.ts'

/**
 * Empty snapshot used while no authorization namespace is bound.
 * @returns a wire whose describe lists no flows and whose actions succeed as no-ops.
 */
export function absentSignInWire(): ModelsAuthorization {
  return {
    describe: () => Promise.resolve({ ok: true as const, value: { flows: [], attempts: [] } }),
    begin: () => Promise.resolve({ ok: true as const, value: { started: true } }),
    respond: () => Promise.resolve({ ok: true as const, value: undefined }),
    cancel: () => Promise.resolve({ ok: true as const, value: undefined }),
  }
}

/** A forwarding wire plus the attach that points it at `remote.authorization`. */
export interface SignInAuthorizationHandle {
  /** The wire the sign-in store and page share. */
  readonly wire: ModelsAuthorization
  /**
   * Bind `remote.authorization` when the Client mounts it; unwind to the empty
   * wire if that namespace later unloads.
   * @param ctx - the Models plugin context.
   */
  attach(ctx: ClientContext): void
}

/**
 * Create a sign-in wire that starts empty and follows `remote.authorization`.
 * @returns the shared wire and the attach hook `apply` calls once.
 */
export function createSignInAuthorizationHandle(): SignInAuthorizationHandle {
  let live: ModelsAuthorization = absentSignInWire()
  return {
    wire: {
      describe: () => live.describe(),
      begin: request => live.begin(request),
      respond: request => live.respond(request),
      cancel: request => live.cancel(request),
    },
    attach(ctx) {
      const bind = (): void => {
        live = (ctx.get('remote.authorization') as ModelsAuthorization | undefined)
          ?? absentSignInWire()
      }
      bind()
      // `ctx.get` reads the store without inject. The uninjected accessor
      // `ctx.remote.authorization` throws even when the namespace is mounted.
      ctx.inject(['remote.authorization'], () => {
        bind()
        return () => { live = absentSignInWire() }
      })
    },
  }
}
