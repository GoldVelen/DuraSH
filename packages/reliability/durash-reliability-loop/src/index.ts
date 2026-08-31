/**
 * The DuraSH reliability loop runtime (`ctx.reliabilityLoopRuntime`): one
 * bounded implement-review-rework cycle over `ctx.workflowEngine` with
 * product-owned durable state in the `reliability-loop` storage domain. The
 * domain record is the single authoritative state; the runtime never
 * reconstructs a loop from anything else, and every stage transition is one
 * durable record write. A restart resumes from the first unsettled stage
 * through `resume()`, which never re-runs a settled attempt and never lets
 * two live drivers own one loop; cancellation reaches quiescence because the
 * per-loop driver owns no timers and no global listeners.
 * @module @durash/dsh-reliability-loop
 */

import { randomUUID } from 'node:crypto'
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { LoopDriver } from './driver.ts'
import { reliabilityLoopDomainSpec } from './spec.ts'
import { ReliabilityLoopId, isTerminalStage } from './types.ts'
import type { ReliabilityLoopHandle, ReliabilityLoopRecord, ReliabilityLoopStartRequest } from './types.ts'

export { assertReliabilityLoopRecord } from './checks.ts'
export { reliabilityLoopDomainSpec, reliabilityLoopRecord } from './spec.ts'
export {
  IMPLEMENT_SCRIPT,
  REVIEW_SCRIPT,
  StageReportError,
} from './scripts.ts'
export * from './types.ts'

/** Config: the deployment-owned loop bounds. */
export interface Config {
  /**
   * Maximum characters of any artifact crossing a stage boundary — the
   * objective, an implementation summary, reviewer feedback. A longer
   * artifact fails the stage loud (default 16384).
   */
  maxHandoffChars?: number
}

export const Config: z<Config> = z.object({
  maxHandoffChars: z.natural().min(1).default(16_384),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    reliabilityLoopRuntime: ReliabilityLoopRuntime
  }
}

/**
 * The reliability-loop runtime. One live driver owns one loop; the runtime
 * enforces that single ownership and cancels every live loop to quiescence
 * before its domain closes at teardown.
 */
export class ReliabilityLoopRuntime extends Service {
  static inject = ['workflowEngine', 'storageDomain']

  static Config: z<Config> = Config

  private table: KvTable<ReliabilityLoopId, ReliabilityLoopRecord> | undefined
  private readonly live = new Map<ReliabilityLoopId, LoopDriver>()
  private readonly maxHandoffChars: number

  constructor(ctx: Context, config: Config) {
    super(ctx, 'reliabilityLoopRuntime')
    // Schemastery (the exported Config schema) has already filled the defaulted
    // fields; the assertion records that resolution, not a hidden fallback.
    this.maxHandoffChars = (config as Required<Config>).maxHandoffChars
  }

  /** Open the durable domain and order its close after live-loop quiescence. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(reliabilityLoopDomainSpec)
    this.table = domain.table('loops')
    // One generator effect: fiber teardown runs a fiber's separate effects in
    // parallel, but ONE effect's disposers unwind sequentially in reverse
    // yield order — live loops reach quiescence BEFORE the domain closes, so
    // no terminal write lands on a closed medium.
    this.ctx.effect(() => this.domainLifecycle(domain), 'reliability-loop.domain')
  }

  /** Yield the domain close first, then live-loop quiescence; unwind runs them in the reverse order. */
  private *domainLifecycle(domain: Domain<typeof reliabilityLoopDomainSpec>): Generator<() => Promise<void>> {
    yield () => domain.close()
    yield () => this.stopLiveLoops()
  }

  /**
   * Start one loop: write its durable record first, then drive the first
   * stage. The caller owns the returned handle and defines its own interval
   * over `result`.
   * @param request - the parent agent and the bounded objective.
   * @returns the live loop handle.
   * @throws when the objective is empty or over the handoff bound.
   */
  async start(request: ReliabilityLoopStartRequest): Promise<ReliabilityLoopHandle> {
    const table = this.requireTable()
    if (request.objective.length === 0) throw new Error('reliability loop objective must not be empty')
    if (request.objective.length > this.maxHandoffChars) {
      throw new Error(`reliability loop objective is ${request.objective.length} characters, over the ${this.maxHandoffChars} handoff bound`)
    }
    const loopId = ReliabilityLoopId(randomUUID())
    const record: ReliabilityLoopRecord = {
      loopId,
      objective: request.objective,
      createdAt: new Date().toISOString(),
      stage: 'implementing',
      ...request.implementation === undefined ? {} : {
        implementationProvider: request.implementation.provider,
        implementationModel: request.implementation.model,
      },
      ...request.review === undefined ? {} : {
        reviewProvider: request.review.provider,
        reviewModel: request.review.model,
      },
    }
    // Durable before any run exists: a crash after this write is recoverable.
    await table.put(loopId, record)
    return this.own(loopId, request.parent)
  }

  /**
   * Resume one interrupted loop after a restart: drive the state machine from
   * its record's current stage. Settled attempts are never re-run; the first
   * unsettled stage re-runs exactly once because the driver owns the loop
   * exclusively.
   * @param loopId - the interrupted loop's id.
   * @param parent - the agent on whose behalf the resumed stages run.
   * @returns the live loop handle.
   * @throws when the loop is unknown, already settled, or already owned by a
   *   live driver.
   */
  resume(loopId: ReliabilityLoopId, parent: Agent): ReliabilityLoopHandle {
    const record = this.requireTable().get(loopId)
    if (record === undefined) throw new Error(`cannot resume unknown reliability loop '${loopId}'`)
    if (isTerminalStage(record.stage)) throw new Error(`cannot resume settled reliability loop '${loopId}' (stage '${record.stage}')`)
    return this.own(loopId, parent)
  }

  /**
   * Every durable loop record, in storage order.
   * @returns the record snapshot.
   */
  list(): ReliabilityLoopRecord[] {
    return [...this.requireTable().entries()].map(([, record]) => record)
  }

  /**
   * Read one loop's durable record.
   * @param loopId - the loop's id.
   * @returns the record, or `undefined` when unknown.
   */
  get(loopId: ReliabilityLoopId): ReliabilityLoopRecord | undefined {
    return this.requireTable().get(loopId)
  }

  /** Bind one loop to a fresh driver and hand out its handle. */
  private own(loopId: ReliabilityLoopId, parent: Agent): ReliabilityLoopHandle {
    if (this.live.has(loopId)) throw new Error(`reliability loop '${loopId}' already has a live owner`)
    const driver = new LoopDriver(this.ctx.workflowEngine, this.requireTable(), parent, this.maxHandoffChars, loopId)
    this.live.set(loopId, driver)
    void driver.drive()
    return {
      loopId,
      result: driver.result,
      cancel: (reason) => { driver.cancel(reason) },
      dispose: () => this.releaseDriver(driver),
    }
  }

  /** Dispose one driver and free its single-ownership slot. */
  private async releaseDriver(driver: LoopDriver): Promise<void> {
    try {
      await driver.dispose()
    } finally {
      this.live.delete(driver.loopId)
    }
  }

  /** Teardown: cancel every live loop and await quiescence (bounded per loop by the engine's grace). */
  private async stopLiveLoops(): Promise<void> {
    await Promise.all([...this.live.values()].map(driver => driver.dispose()))
    this.live.clear()
  }

  private requireTable(): KvTable<ReliabilityLoopId, ReliabilityLoopRecord> {
    if (this.table === undefined) throw new Error('reliability loop runtime is not started yet')
    return this.table
  }
}

export default ReliabilityLoopRuntime
