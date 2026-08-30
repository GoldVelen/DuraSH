/**
 * Sign-in store for the Models page: the registered authorization flows and
 * their live attempts, polled from the Host-owned attempt state.
 *
 * The attempts move without settings events (a flow waiting on a phone), so
 * the section polls `describe` on a fixed cadence while mounted and refreshes
 * once after every action. The store never owns attempt state; it renders the
 * Host's answer, and a page that closes and reopens rejoins the same attempt.
 *
 * @module ui-settings-models/sign-in-store
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type {
  AuthorizationAttemptView, AuthorizationFlowView,
} from '@deepseek-ai/dsh-api-remotes/client'

/** The authorization Remote methods the sign-in area drives. */
export type ModelsAuthorization = Pick<ClientRemote['authorization'], 'begin' | 'cancel' | 'describe' | 'respond'>

/** Poll cadence while the sign-in area is mounted. */
const POLL_MS = 1500

/** Sign-in area snapshot. */
export interface SignInState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** Whole-area failure text; per-action failures stay in the component. */
  error: string | null
  /** Every registered flow, in Host registration order. */
  flows: readonly AuthorizationFlowView[]
  /** Every tracked attempt, terminal ones included. */
  attempts: readonly AuthorizationAttemptView[]
}

/** Human text for a rejected wire call, shared with the page's other stores. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The sign-in area controller (one per settings surface). */
export class SignInStore {
  /** The snapshot the section renders from (uSES-safe store). */
  readonly store: SnapshotStore<SignInState> = createSnapshotStore<SignInState>({
    status: 'idle', error: null, flows: [], attempts: [],
  })

  /** Latest poll wins; an older response never overwrites a newer one. */
  private generation = 0
  private timer: ReturnType<typeof setInterval> | undefined

  /** @param api - the authorization Remote methods the area drives. */
  constructor(private readonly api: ModelsAuthorization) {}

  /**
   * Refresh the flows and attempts snapshot.
   * @returns nothing; the snapshot carries the outcome.
   */
  async refresh(): Promise<void> {
    const generation = ++this.generation
    this.store.update((s) => { if (s.status === 'idle') s.status = 'loading' })
    try {
      const described = await this.api.describe()
      if (!described.ok) throw new Error(described.error.message)
      if (generation !== this.generation) return
      this.store.update((s) => {
        s.status = 'ready'
        s.error = null
        s.flows = described.value.flows
        s.attempts = described.value.attempts
      })
    } catch (error) {
      if (generation !== this.generation) return
      this.store.update((s) => {
        s.status = 'error'
        s.error = messageOf(error)
      })
    }
  }

  /**
   * Poll on the section's cadence until stopped. Immediate first refresh, so
   * the area renders from facts rather than waiting one interval.
   * @returns the stopper; the section's dispose effect calls it.
   */
  startPolling(): () => void {
    // A pre-warmed store (the surface refreshed before mount) skips the
    // immediate fetch; the cadence alone keeps it current from here.
    if (this.store.getSnapshot().status === 'idle') void this.refresh()
    this.timer = setInterval(() => { void this.refresh() }, POLL_MS)
    return () => { this.stopPolling() }
  }

  /** Stop the poll cadence; a stopped store restarts through {@link startPolling}. */
  stopPolling(): void {
    if (this.timer !== undefined) clearInterval(this.timer)
    this.timer = undefined
  }

  /**
   * Start one authorization attempt.
   * @param key - the flow's credential key, in its joined form.
   * @param method - the flow method to run; defaults to the flow's first.
   * @returns the failure message, or undefined once the attempt started.
   */
  async begin(key: string, method?: string): Promise<string | undefined> {
    try {
      const response = await this.api.begin(method === undefined ? { key } : { key, method })
      if (!response.ok) return response.error.message
    } catch (error) {
      return messageOf(error)
    }
    await this.refresh()
    return undefined
  }

  /**
   * Answer one pending prompt.
   * @param key - the attempt's credential key.
   * @param promptId - the id `describe` named for the pending prompt.
   * @param answer - the typed value, the chosen option id, or a decline.
   * @returns the failure message, or undefined once the answer landed.
   */
  async respond(
    key: string,
    promptId: string,
    answer: { value: string } | { declined: true },
  ): Promise<string | undefined> {
    try {
      const response = await this.api.respond({ key, promptId, ...answer })
      if (!response.ok) return response.error.message
    } catch (error) {
      return messageOf(error)
    }
    await this.refresh()
    return undefined
  }

  /**
   * Withdraw the running attempt for a key.
   * @param key - the credential key whose attempt should stop.
   * @returns the failure message, or undefined once the withdrawal landed.
   */
  async cancel(key: string): Promise<string | undefined> {
    try {
      const response = await this.api.cancel({ key })
      if (!response.ok) return response.error.message
    } catch (error) {
      return messageOf(error)
    }
    await this.refresh()
    return undefined
  }

  /** Stop the poll cadence; the settings surface owns the store lifetime. */
  dispose(): void {
    this.stopPolling()
    this.generation += 1
  }
}

export default SignInStore
