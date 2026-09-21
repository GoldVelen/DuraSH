/**
 * Browser-local object layer for per-session reliability-loop policy used by
 * the composer switch.
 * @module @durash/dsh-client-ui-reliability/client/controller
 */

import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionEventSource } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  AcceptanceView,
  ReliabilityPolicyConfigureRequest,
  ReliabilityPolicySnapshot,
  ReliabilityThinking,
} from '@durash/dsh-reliability-policy/client'

/** Host RPC methods used to read and replace one Session's reliability policy. */
export interface ReliabilityPolicyRemote {
  /** Older Remote carriers may not expose acceptance yet. */
  acceptance?: (request: { sessionId: SessionId }) => Promise<RemoteResult<AcceptanceView | null>>
  policy: (request: { sessionId: SessionId }) => Promise<RemoteResult<ReliabilityPolicySnapshot>>
  ensurePolicy: (request: { sessionId: SessionId }) => Promise<RemoteResult<ReliabilityPolicySnapshot>>
  configure: (request: ReliabilityPolicyConfigureRequest) => Promise<RemoteResult<ReliabilityPolicySnapshot>>
}

/** Loading phase for one Session policy in the browser controller. */
export type ReliabilityLoadStatus = 'cold' | 'loading' | 'ready' | 'error' | 'configuring'

/** Current request state, failure message, and last policy snapshot for one Session. */
export interface ReliabilitySessionState {
  readonly status: ReliabilityLoadStatus
  readonly error: string | null
  readonly policy: ReliabilityPolicySnapshot
  readonly acceptance?: AcceptanceView | null
  readonly acceptanceError?: string | null
}

/** Immutable per-Session policy view published to renderer subscribers. */
export interface ReliabilityControllerView {
  sessions: ReadonlyMap<SessionId, ReliabilitySessionState>
}

/** Success or caller-visible failure returned by a controller action. */
export type ReliabilityActionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

type ReliabilityActionFailure = Extract<ReliabilityActionResult, { readonly ok: false }>

const ACCEPTANCE_EVENTS = new Set<string>(['tool/result', 'tool/ptc-dispatch', 'user/message', 'turn/end'])

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

/**
 * Browser-local Session policy cache and request coordinator. Each operation
 * shares one in-flight request per Session, and late results do not publish
 * after disposal.
 */
export class ReliabilityPolicyController implements HostObservable<ReliabilityControllerView> {
  private view = INITIAL
  private readonly listeners = new Set<() => void>()
  private readonly loadPromises = new Map<SessionId, Promise<ReliabilityActionResult>>()
  private readonly ensurePromises = new Map<SessionId, Promise<ReliabilityActionResult>>()
  private readonly configurePromises = new Map<SessionId, Promise<ReliabilityActionResult>>()
  private readonly acceptanceReads = new Map<SessionId, Promise<ReliabilityActionResult>>()
  private readonly acceptanceDirty = new Set<SessionId>()
  private readonly acceptanceSubscriptions = new Map<SessionId, { source: SessionEventSource; stop: () => void }>()
  private disposed = false

  constructor(private readonly remote: ReliabilityPolicyRemote) {}

  getSnapshot = (): ReliabilityControllerView => this.view

  subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return () => {}
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Read the current state for one Session.
   * @param sessionId - Session to inspect.
   * @returns the cached state, or a cold state when the Session has not loaded.
   */
  sessionState(sessionId: SessionId): ReliabilitySessionState {
    return this.view.sessions.get(sessionId) ?? coldState(sessionId)
  }

  /**
   * Load the Host policy unless a ready value or matching read is available.
   * @param sessionId - Session whose policy to load.
   * @returns the action result; concurrent loads for the Session share one promise.
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
   * Refresh recorded acceptance even when the workflow switch is off.
   * Concurrent invalidations schedule one further read so an older response
   * cannot hide a tool settlement that arrived while the request was pending.
   * @param sessionId - Session whose task to read.
   * @returns read success or the displayed failure; no model is invoked.
   */
  refreshAcceptance(sessionId: SessionId): Promise<ReliabilityActionResult> {
    if (this.disposed) return Promise.resolve(DISPOSED)
    const read = this.remote.acceptance
    if (read === undefined) return Promise.resolve(OK)
    const pending = this.acceptanceReads.get(sessionId)
    if (pending !== undefined) {
      this.acceptanceDirty.add(sessionId)
      return pending
    }
    const work = async (): Promise<ReliabilityActionResult> => {
      let result: ReliabilityActionResult
      do {
        this.acceptanceDirty.delete(sessionId)
        result = await this.readAcceptance(sessionId, read)
      } while (!this.disposed && this.acceptanceDirty.has(sessionId))
      return result
    }
    const request = work().finally(() => { this.acceptanceReads.delete(sessionId) })
    this.acceptanceReads.set(sessionId, request)
    return request
  }

  /**
   * Follow durable task-affecting events for one displayed Session.
   * @param sessionId - Session whose evidence changes.
   * @param source - its existing event-window observable.
   */
  observeAcceptance(sessionId: SessionId, source: SessionEventSource): void {
    if (this.disposed || this.remote.acceptance === undefined) return
    const current = this.acceptanceSubscriptions.get(sessionId)
    if (current?.source === source) return
    current?.stop()
    const stop = source.subscribe(() => {
      const change = source.getSnapshot().change
      if (change.kind === 'settle-assistant') return
      if (change.kind === 'replace' || change.entries.some(({ event }) =>
        ACCEPTANCE_EVENTS.has(event.type))) {
        void this.refreshAcceptance(sessionId)
      }
    })
    this.acceptanceSubscriptions.set(sessionId, { source, stop })
  }

  /**
   * Ask the Host to fill missing lane selections when cached policy is incomplete.
   * @param sessionId - Session whose policy to ensure.
   * @returns the action result; concurrent ensures for the Session share one promise.
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
   * Replace one Session policy after validating the fields required for enablement.
   * @param request - complete policy replacement.
   * @returns the action result; a concurrent replacement for the Session joins the in-flight action.
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

  /**
   * Read the thinking efforts for a model from the cached Session catalogs.
   * @param selector - persisted model selector, or `null` for no selection.
   * @returns the matching effort list, or an empty list when no cached model matches.
   */
  thinkingLevels(selector: string | null): readonly ReliabilityThinking[] {
    if (selector === null) return []
    for (const state of this.view.sessions.values()) {
      const match = state.policy.models.find(model => model.selector === selector)
      if (match !== undefined) return match.thinkingLevels
    }
    return []
  }

  /** Stop listener delivery and ignore late Remote results without cancelling their requests. */
  dispose(): void {
    this.disposed = true
    this.listeners.clear()
    this.loadPromises.clear()
    this.ensurePromises.clear()
    this.configurePromises.clear()
    this.acceptanceDirty.clear()
    for (const subscription of this.acceptanceSubscriptions.values()) subscription.stop()
    this.acceptanceSubscriptions.clear()
  }

  private async readAcceptance(
    sessionId: SessionId,
    read: NonNullable<ReliabilityPolicyRemote['acceptance']>,
  ): Promise<ReliabilityActionResult> {
    try {
      const response = await read.call(this.remote, { sessionId })
      if (this.acceptanceDirty.has(sessionId)) return response.ok ? OK : response
      if (!response.ok) {
        this.publishSession(sessionId, {
          ...this.sessionState(sessionId), acceptance: null, acceptanceError: response.error.message,
        })
        return response
      }
      this.publishSession(sessionId, {
        ...this.sessionState(sessionId), acceptance: response.value, acceptanceError: null,
      })
      return OK
    } catch (error) {
      const result = transportFailure(error, 'Acceptance read failed')
      this.publishSession(sessionId, {
        ...this.sessionState(sessionId), acceptance: null, acceptanceError: result.error.message,
      })
      return result
    }
  }

  private async readPolicy(sessionId: SessionId, method: 'policy' | 'ensurePolicy'): Promise<ReliabilityActionResult> {
    let failure: ReliabilityActionFailure
    try {
      const carried = await this.remote[method]({ sessionId })
      if (!carried.ok) failure = { ok: false, error: carried.error }
      else if (carried.value.sessionId !== sessionId) {
        failure = { ok: false, error: { code: 'reliability_policy_session_mismatch', message: 'Host returned a workflow policy for another session' } }
      } else {
        if (!this.disposed) this.publishSnapshot(sessionId, carried.value)
        return OK
      }
    } catch (error) {
      failure = transportFailure(error, 'Workflow policy read failed')
    }
    if (!this.disposed) {
      const current = this.sessionState(sessionId)
      this.publishSession(sessionId, { ...current, status: 'error', error: failure.error.message })
    }
    return failure
  }

  private async writePolicy(request: ReliabilityPolicyConfigureRequest): Promise<ReliabilityActionResult> {
    if (request.enabled && (request.implementationModel === null || request.implementationThinking === null
      || request.reviewModel === null || request.reviewThinking === null)) {
      const incomplete: ReliabilityActionFailure = {
        ok: false,
        error: { code: 'reliability_policy_incomplete', message: 'Select both models and efforts before enabling the workflow' },
      }
      const current = this.sessionState(request.sessionId)
      this.publishSession(request.sessionId, { ...current, status: 'error', error: incomplete.error.message })
      return incomplete
    }
    let failure: ReliabilityActionFailure
    try {
      const carried = await this.remote.configure(request)
      if (!carried.ok) failure = { ok: false, error: carried.error }
      else if (carried.value.sessionId !== request.sessionId) {
        failure = { ok: false, error: { code: 'reliability_policy_session_mismatch', message: 'Host returned a workflow policy for another session' } }
      } else {
        if (!this.disposed) this.publishSnapshot(request.sessionId, carried.value)
        return OK
      }
    } catch (error) {
      failure = transportFailure(error, 'Workflow policy update failed')
    }
    if (!this.disposed) {
      const current = this.sessionState(request.sessionId)
      this.publishSession(request.sessionId, { ...current, status: 'error', error: failure.error.message })
    }
    return failure
  }

  private publishSnapshot(sessionId: SessionId, snapshot: ReliabilityPolicySnapshot): void {
    const current = this.sessionState(sessionId)
    const older = snapshot.revision < current.policy.revision
      || (snapshot.revision === current.policy.revision && snapshot.updatedAt < current.policy.updatedAt)
    this.publishSession(sessionId, older
      ? { ...current, status: 'ready', error: null }
      : { ...current, status: 'ready', error: null, policy: snapshot })
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
