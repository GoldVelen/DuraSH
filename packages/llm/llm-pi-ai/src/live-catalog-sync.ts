/** Coalesced native model catalog refreshes with source epochs and awaited teardown. */

import type { Api, Model } from '@earendil-works/pi-ai'
import { deadline } from '@deepseek-ai/dsh-timeout'

/** Host-owned routes, timing, transport, and catalog publication. */
export interface LiveCatalogSyncOptions {
  /** @returns current routes eligible for automatic refresh. */
  providers(): readonly string[]
  /** @returns validated positive timer-safe request deadline. */
  timeoutMs(): number
  /** @returns validated positive timer-safe refresh interval. */
  refreshMs(): number
  /**
   * Fetch complete native model descriptors for one route.
   * @param provider - configured route key.
   * @param signal - shared refresh cancellation and deadline.
   * @returns the authoritative model descriptors, including an empty directory.
   */
  fetch(provider: string, signal: AbortSignal): Promise<readonly Model<Api>[]>
  /**
   * Publish a successful refresh while its route source is current.
   * @param provider - refreshed route key.
   * @param models - complete native model descriptors.
   */
  publish(provider: string, models: readonly Model<Api>[]): void
  /**
   * Report an active refresh failure without replacing the Host's catalog.
   * @param provider - failed route key.
   * @param error - transport or deadline failure.
   */
  failure(provider: string, error: unknown): void
}

interface PendingRefresh {
  readonly controller: AbortController
  readonly result: Promise<readonly Model<Api>[]>
  readonly done: Promise<void>
}

/** Preserve Error cancellation reasons without exposing arbitrary abort payloads. */
function abortError(signal: AbortSignal): Error {
  const reason: unknown = signal.reason
  return reason instanceof Error ? reason : new Error('model catalog wait aborted')
}

/** Race a caller's wait without cancelling the shared operation. */
function waitFor<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return operation
  if (signal.aborted) return Promise.reject(abortError(signal))
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => { reject(abortError(signal)) }
    signal.addEventListener('abort', onAbort, { once: true })
    void operation.then((value) => {
      signal.removeEventListener('abort', onAbort)
      resolve(value)
    }, (error: unknown) => {
      signal.removeEventListener('abort', onAbort)
      reject(error instanceof Error ? error : new Error('model catalog request failed'))
    })
  })
}

/** Own refresh requests and timers while the Host owns catalog data and diagnostics. */
export class LiveCatalogSync {
  private readonly epochs = new Map<string, number>()
  private readonly pending = new Map<string, PendingRefresh>()
  private readonly inFlight = new Set<PendingRefresh>()
  private readonly scheduled = new Set<string>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private queued = false
  private started = false
  private closed = false
  private closing: Promise<void> | undefined

  /** @param options - Host callbacks and validated timing budgets. */
  constructor(private readonly options: LiveCatalogSyncOptions) {}

  /**
   * Refresh one route, sharing its request with concurrent callers.
   * @param provider - route key to refresh.
   * @param callerSignal - cancels only this caller's wait.
   * @returns the refreshed descriptors, or the caller's cancellation or refresh failure.
   */
  refresh(provider: string, callerSignal?: AbortSignal): Promise<readonly Model<Api>[]> {
    if (this.closed) return Promise.reject(new Error('live model catalog sync is closed'))
    if (callerSignal?.aborted) return Promise.reject(abortError(callerSignal))
    const task = this.pending.get(provider) ?? this.begin(provider)
    return waitFor(task.result, callerSignal)
  }

  private begin(provider: string): PendingRefresh {
    const epoch = this.epochs.get(provider) ?? 0
    const controller = new AbortController()
    const timeout = deadline(controller.signal, this.options.timeoutMs(), 'MODEL_CATALOG_TIMEOUT')
    const current = (): boolean => !this.closed && (this.epochs.get(provider) ?? 0) === epoch
    const operation = Promise.resolve().then(() => {
      timeout.signal.throwIfAborted()
      return this.options.fetch(provider, timeout.signal)
    }).then((models) => {
      timeout.signal.throwIfAborted()
      if (current()) this.options.publish(provider, models)
      return models
    })
    const result = waitFor(operation, timeout.signal).catch((error: unknown) => {
      if (current() && !controller.signal.aborted) {
        try {
          this.options.failure(provider, error)
        } catch (_observerError: unknown) {
          // A diagnostic observer cannot replace the refresh failure returned to callers.
        }
      }
      throw error
    }).finally(() => {
      if (this.pending.get(provider) === task) this.pending.delete(provider)
    })
    const done = operation.then(() => undefined, () => undefined).finally(() => {
      timeout[Symbol.dispose]()
      this.inFlight.delete(task)
    })
    const task: PendingRefresh = { controller, result, done }
    this.pending.set(provider, task)
    this.inFlight.add(task)
    return task
  }

  /**
   * Cancel an obsolete route source and schedule its current source.
   * @param provider - route whose account or endpoint changed.
   */
  invalidate(provider: string): void {
    if (this.closed) return
    this.epochs.set(provider, (this.epochs.get(provider) ?? 0) + 1)
    this.pending.get(provider)?.controller.abort(new Error('model catalog source changed'))
    this.pending.delete(provider)
    this.schedule(provider)
  }

  /** Schedule current routes and apply the latest refresh interval to the periodic timer. */
  notify(): void {
    if (this.closed) return
    for (const provider of this.options.providers()) this.schedule(provider)
    if (!this.started) return
    clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.notify()
    }, this.options.refreshMs())
    this.timer.unref()
  }

  private schedule(provider: string): void {
    this.scheduled.add(provider)
    if (this.queued) return
    this.queued = true
    queueMicrotask(() => {
      this.queued = false
      if (this.closed) return
      const providers = new Set(this.options.providers())
      const scheduled = [...this.scheduled]
      this.scheduled.clear()
      for (const route of scheduled) {
        if (!providers.has(route)) continue
        void this.refresh(route).catch(() => {
          // Active failures were reported by begin(); background callers have no result consumer.
        })
      }
    })
  }

  /** Begin the first refresh and periodic synchronization; repeated starts are harmless. */
  start(): void {
    if (this.started || this.closed) return
    this.started = true
    this.notify()
  }

  /**
   * Stop scheduling, cancel requests, and wait for every underlying fetch to settle.
   * @returns completion once no request can publish or report a failure.
   */
  close(): Promise<void> {
    if (this.closing !== undefined) return this.closing
    this.closed = true
    clearTimeout(this.timer)
    this.timer = undefined
    this.scheduled.clear()
    const tasks = [...this.inFlight]
    for (const task of tasks) task.controller.abort(new Error('live model catalog sync closed'))
    this.closing = Promise.all(tasks.map(task => task.done)).then(() => undefined)
    return this.closing
  }
}
