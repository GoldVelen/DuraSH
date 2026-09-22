/** Browser registry for read-only Cordis capability providers. */

import type { Context } from '@deepseek-ai/cordis'
import type {
  CordisInspectProviderManifest, CordisInspectQueryRequest, CordisInspectQueryResolution,
  CordisInspectRequestId, SessionId,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/** Context supplied to a Client inspect provider query. */
export interface ClientCordisInspectQueryContext {
  /** Cancellation broadcast by the Host or caused by plugin disposal. */
  signal: AbortSignal
  /** Session whose model requested the query. */
  sessionId: SessionId
}

/** Client provider registration retained beside its serializable manifest. */
export interface ClientCordisInspectProviderRegistration {
  /** Provider and explicit query directory. */
  manifest: CordisInspectProviderManifest
  /** Execute one declared read-only method. */
  query(method: string, input: JsonValue | undefined, context: ClientCordisInspectQueryContext): Promise<JsonValue>
}

/** Remote operations needed by the Client registry. */
export interface ClientCordisInspectHost {
  /** Replace the Host's mirrored Client manifest. */
  sync(providers: readonly CordisInspectProviderManifest[]): Promise<void>
  /** Submit one query result; the first accepted page wins. */
  resolve(
    sessionId: SessionId,
    requestId: CordisInspectRequestId,
    resolution: CordisInspectQueryResolution,
  ): Promise<void>
}

/** Client provider registry, manifest publisher, and live query dispatcher. */
export class ClientCordisInspectRegistry {
  private readonly providers = new Map<string, ClientCordisInspectProviderRegistration>()
  private readonly lifetime = new AbortController()
  private readonly active = new Map<CordisInspectRequestId, { controller: AbortController; done: Promise<void> }>()
  private publishQueued = false
  private syncChain = Promise.resolve()

  /** @param host - folded manifest and query result transport. */
  constructor(private readonly host: ClientCordisInspectHost) {}

  /**
   * Register one Client provider and publish a new complete manifest.
   * @param registration - provider manifest and local handler.
   * @returns idempotent disposer.
   */
  register(registration: ClientCordisInspectProviderRegistration): () => void {
    this.lifetime.signal.throwIfAborted()
    const { manifest } = registration
    if (manifest.id.trim() === '') throw new Error('Client Cordis inspect provider id must not be empty')
    if (this.providers.has(manifest.id)) throw new Error(`Client Cordis inspect provider "${manifest.id}" is already registered`)
    const names = new Set<string>()
    for (const method of manifest.methods) {
      if (names.has(method.name)) throw new Error(`Client Cordis inspect provider "${manifest.id}" repeats method "${method.name}"`)
      names.add(method.name)
    }
    this.providers.set(manifest.id, registration)
    this.publish()
    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      if (this.providers.get(manifest.id) === registration) {
        this.providers.delete(manifest.id)
        this.publish()
      }
    }
  }

  /** Publish the current complete manifest, including after reconnect. */
  publish(): void {
    if (this.lifetime.signal.aborted || this.publishQueued) return
    this.publishQueued = true
    queueMicrotask(() => {
      this.publishQueued = false
      if (this.lifetime.signal.aborted) return
      const manifests = [...this.providers.values()].map(provider => provider.manifest)
      this.syncChain = this.syncChain.then(async () => {
        if (this.lifetime.signal.aborted) return
        await this.host.sync(manifests)
      }).catch((error: unknown) => {
        if (!this.lifetime.signal.aborted) {
          console.error('[cordis-client-runner] syncing inspect providers failed:', error)
        }
      })
    })
  }

  /**
   * Execute and answer one Host-broadcast query.
   * @param request - exact provider query and Session correlation received from Host.
   * @returns after the result is sent, or cancellation ends the local work.
   */
  query(request: CordisInspectQueryRequest): Promise<void> {
    if (this.lifetime.signal.aborted || this.active.has(request.requestId)) return Promise.resolve()
    const controller = new AbortController()
    const done = Promise.resolve().then(async () => {
      if (controller.signal.aborted) return
      await this.executeQuery(request, controller.signal)
    }).finally(() => {
      this.active.delete(request.requestId)
    })
    this.active.set(request.requestId, { controller, done })
    return done
  }

  private async executeQuery(request: CordisInspectQueryRequest, signal: AbortSignal): Promise<void> {
    let resolution: CordisInspectQueryResolution
    try {
      const provider = this.providers.get(request.provider)
      if (provider === undefined) {
        resolution = { ok: false, reason: 'provider-missing', message: `Client inspect provider "${request.provider}" is unavailable` }
      } else if (!provider.manifest.methods.some(method => method.name === request.method)) {
        resolution = { ok: false, reason: 'method-missing', message: `Client inspect provider "${request.provider}" has no method "${request.method}"` }
      } else {
        const data = await provider.query(request.method, request.input, {
          signal,
          sessionId: request.agentId,
        })
        resolution = signal.aborted
          ? { ok: false, reason: 'cancelled', message: 'Client inspect query was cancelled' }
          : { ok: true, data }
      }
    } catch (error) {
      resolution = signal.aborted
        ? { ok: false, reason: 'cancelled', message: 'Client inspect query was cancelled' }
        : { ok: false, reason: 'provider-error', message: error instanceof Error ? error.message : String(error) }
    }
    if (signal.aborted) return
    await this.host.resolve(request.agentId, request.requestId, resolution).catch((error: unknown) => {
      if (!signal.aborted) throw error
    })
  }

  /**
   * Cancel local work after another page answered or the Tool call ended.
   * @param requestId - query correlation that is no longer answerable.
   */
  close(requestId: CordisInspectRequestId): void {
    this.active.get(requestId)?.controller.abort()
  }

  /**
   * Stop publication and queries, abort live work, and wait for it to settle.
   * @returns after in-flight provider queries and remote calls have ended.
   */
  async dispose(): Promise<void> {
    this.lifetime.abort()
    this.providers.clear()
    for (const { controller } of this.active.values()) controller.abort()
    await Promise.allSettled([this.syncChain, ...[...this.active.values()].map(query => query.done)])
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Browser registry for pre-definition Cordis capability discovery. */
    cordisInspect: ClientCordisInspectRegistry
  }
}

/**
 * Provide the registry as a normal Client service.
 * @param ctx - Client Cordis context receiving the service.
 * @param registry - page-local inspect registry to publish.
 */
export function provideClientCordisInspect(ctx: Context, registry: ClientCordisInspectRegistry): void {
  ctx.provide('cordisInspect', registry)
}
