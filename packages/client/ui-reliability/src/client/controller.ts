/**
 * Browser-local object layer for per-session reliability-loop policy used by
 * the composer switch.
 * @module @durash/dsh-client-ui-reliability/client/controller
 */

import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  ReliabilityPolicyConfigureRequest,
  ReliabilityPolicySnapshot,
} from '@durash/dsh-reliability-policy/client'

/** Generated Host methods used by the browser policy controller. */
export interface ReliabilityPolicyRemote {
  policy: (request: { sessionId: SessionId }) => Promise<RemoteResult<ReliabilityPolicySnapshot>>
  ensurePolicy: (request: { sessionId: SessionId }) => Promise<RemoteResult<ReliabilityPolicySnapshot>>
  configure: (request: ReliabilityPolicyConfigureRequest) => Promise<RemoteResult<ReliabilityPolicySnapshot>>
}

/** Browser-local lifecycle for one Session policy read or write. */
export type ReliabilityLoadStatus = 'cold' | 'loading' | 'ready' | 'error' | 'configuring'

/** Policy controller state retained for one Session. */
export interface ReliabilitySessionState {
  readonly status: ReliabilityLoadStatus
  readonly error: string | null
  readonly policy: ReliabilityPolicySnapshot
}

/** Immutable aggregate exposed through the external-store interface. */
export interface ReliabilityControllerView {
  sessions: ReadonlyMap<SessionId, ReliabilitySessionState>
}

/** Classified outcome of one policy controller action. */
export type ReliabilityActionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

type ReliabilityActionFailure = Extract<ReliabilityActionResult, { readonly ok: false }>

const EMPTY_SESSIONS: ReadonlyMap<SessionId, ReliabilitySessionState> = new Map()
const INITIAL: ReliabilityControllerView = Object.freeze({ sessions: EMPTY_SESSIONS })
const OK: ReliabilityActionResult = Object.freeze({ ok: true })
const DISPOSED: ReliabilityActionFailure = Object.freeze({
  ok: false,
  error: Object.freeze({ code: 'disposed', message: 'Reliability policy controller is disposed' }),
})

function emptySnapshot(sessionId: SessionId): ReliabilityPolicySnapshot {
  return {
    sessionId,
    revision: 0,
    enabled: false,
    implementationModel: null,
    implementationThinking: null,
    reviewModel: null,
    reviewThinking: null,
    updatedAt: 0,
    models: [],
    validationError: null,
  }
}

function coldState(sessionId: SessionId): ReliabilitySessionState {
  return { status: 'cold', error: null, policy: emptySnapshot(sessionId) }
}

function transportFailure(error: unknown, fallback: string): ReliabilityActionFailure {
  return {
    ok: false,
    error: {
      code: 'transport',
      message: error instanceof Error ? error.message : fallback,
    },
  }
}

function failureMessage(result: ReliabilityActionResult, fallback: string): string {
  return result.ok ? fallback : result.error.message
}

/** Session-keyed policy controller shared by composer instances. */
export class ReliabilityPolicyController implements HostObservable<ReliabilityControllerView> {
  private view = INITIAL
  private readonly listeners = new Set<() => void>()
  private readonly loadPromises = new Map<SessionId, Promise<ReliabilityActionResult>>()
  private readonly ensurePromises = new Map<SessionId, Promise<ReliabilityActionResult>>()
  private readonly configurePromises = new Map<SessionId, Promise<ReliabilityActionResult>>()
  private disposed = false

  constructor(private readonly remote: ReliabilityPolicyRemote) {}

  getSnapshot = (): ReliabilityControllerView => this.view

  subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return () => {}
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Read the current browser-local state for one Session.
   * @param sessionId - exact Session identity.
   * @returns the retained state or a cold initial value.
   */
  sessionState(sessionId: SessionId): ReliabilitySessionState {
    return this.view.sessions.get(sessionId) ?? coldState(sessionId)
  }

  /**
   * Load one policy without creating a durable row.
   * @param sessionId - exact Session identity.
   * @returns classified read outcome.
   */
  loadPolicy(sessionId: SessionId): Promise<ReliabilityActionResult> {
    if (this.disposed) return Promise.resolve(DISPOSED)
    const state = this.sessionState(sessionId)
    if (state.status === 'ready') return Promise.resolve(OK)
    const pending = this.loadPromises.get(sessionId)
    if (pending !== undefined) return pending
    this.publishSession(sessionId, { ...state, status: 'loading', error: null })
    const request = this.readPolicy(sessionId, 'policy')
    this.loadPromises.set(sessionId, request)
    return request.finally(() => { this.loadPromises.delete(sessionId) })
  }

  /**
   * Load one policy and create its disabled row when absent.
   * @param sessionId - exact Session identity.
   * @returns classified read or creation outcome.
   */
  ensurePolicy(sessionId: SessionId): Promise<ReliabilityActionResult> {
    if (this.disposed) return Promise.resolve(DISPOSED)
    const state = this.sessionState(sessionId)
    if (state.status === 'ready' && state.policy.models.length > 0
      && state.policy.implementationModel !== null && state.policy.reviewModel !== null) {
      return Promise.resolve(OK)
    }
    const pending = this.ensurePromises.get(sessionId)
    if (pending !== undefined) return pending
    this.publishSession(sessionId, { ...state, status: 'loading', error: null })
    const request = this.readPolicy(sessionId, 'ensurePolicy')
    this.ensurePromises.set(sessionId, request)
    return request.finally(() => { this.ensurePromises.delete(sessionId) })
  }

  /**
   * Replace one Session's policy through the Host.
   * @param request - complete policy replacement.
   * @returns classified write outcome.
   */
  configure(request: ReliabilityPolicyConfigureRequest): Promise<ReliabilityActionResult> {
    if (this.disposed) return Promise.resolve(DISPOSED)
    const current = this.configurePromises.get(request.sessionId)
    if (current !== undefined) return current
    const state = this.sessionState(request.sessionId)
    this.publishSession(request.sessionId, { ...state, status: 'configuring', error: null })
    const pending = this.writePolicy(request)
    this.configurePromises.set(request.sessionId, pending)
    return pending.finally(() => { this.configurePromises.delete(request.sessionId) })
  }

  /** Stop publishing and release browser-local listeners and requests. */
  dispose(): void {
    this.disposed = true
    this.listeners.clear()
    this.loadPromises.clear()
    this.ensurePromises.clear()
    this.configurePromises.clear()
  }

  private async readPolicy(sessionId: SessionId, method: 'policy' | 'ensurePolicy'): Promise<ReliabilityActionResult> {
    let result: ReliabilityActionResult
    let snapshot: ReliabilityPolicySnapshot | undefined
    try {
      const carried = await this.remote[method]({ sessionId })
      if (!carried.ok) result = { ok: false, error: carried.error }
      else if (carried.value.sessionId !== sessionId) {
        result = { ok: false, error: { code: 'reliability_policy_session_mismatch', message: 'Host returned a workflow policy for another session' } }
      } else {
        snapshot = carried.value
        result = OK
      }
    } catch (error) {
      result = transportFailure(error, 'Workflow policy read failed')
    }
    if (!this.disposed) {
      const current = this.sessionState(sessionId)
      if (result.ok && snapshot !== undefined) this.publishSnapshot(sessionId, snapshot)
      else this.publishSession(sessionId, { ...current, status: 'error', error: failureMessage(result, 'Host returned no workflow policy') })
    }
    return result
  }

  private async writePolicy(request: ReliabilityPolicyConfigureRequest): Promise<ReliabilityActionResult> {
    if (request.enabled && (request.implementationModel === null || request.reviewModel === null)) {
      const incomplete: ReliabilityActionFailure = {
        ok: false,
        error: { code: 'reliability_policy_incomplete', message: 'Select both workflow models before enabling the workflow' },
      }
      if (!this.disposed) {
        const current = this.sessionState(request.sessionId)
        this.publishSession(request.sessionId, { ...current, status: 'error', error: incomplete.error.message })
      }
      return incomplete
    }
    let result: ReliabilityActionResult
    let snapshot: ReliabilityPolicySnapshot | undefined
    try {
      const carried = await this.remote.configure(request)
      if (!carried.ok) result = { ok: false, error: carried.error }
      else if (carried.value.sessionId !== request.sessionId) {
        result = { ok: false, error: { code: 'reliability_policy_session_mismatch', message: 'Host returned a workflow policy for another session' } }
      } else {
        snapshot = carried.value
        result = OK
      }
    } catch (error) {
      result = transportFailure(error, 'Workflow policy update failed')
    }
    if (!this.disposed) {
      const current = this.sessionState(request.sessionId)
      if (result.ok && snapshot !== undefined) this.publishSnapshot(request.sessionId, snapshot)
      else this.publishSession(request.sessionId, { ...current, status: 'error', error: failureMessage(result, 'Host returned no workflow policy') })
    }
    return result
  }

  private publishSnapshot(sessionId: SessionId, snapshot: ReliabilityPolicySnapshot): void {
    const current = this.sessionState(sessionId)
    const older = snapshot.revision < current.policy.revision
      || (snapshot.revision === current.policy.revision && snapshot.updatedAt < current.policy.updatedAt)
    this.publishSession(sessionId, older
      ? { ...current, status: 'ready', error: null }
      : { status: 'ready', error: null, policy: snapshot })
  }

  private publishSession(sessionId: SessionId, state: ReliabilitySessionState): void {
    const sessions = new Map(this.view.sessions)
    sessions.set(sessionId, state)
    this.publish({ sessions })
  }

  private publish(view: ReliabilityControllerView): void {
    if (this.disposed) return
    this.view = Object.freeze(view)
    for (const listener of this.listeners) {
      try {
        listener()
      } catch {
        // One renderer cannot prevent the other subscribers seeing the revision.
      }
    }
  }
}
