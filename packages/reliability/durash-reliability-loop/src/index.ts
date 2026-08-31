/**
 * Host-owned DuraSH reliability runtime: detached start, durable version-2
 * state, suspension/resume, authenticated controls, and derived Session state.
 * @module @durash/dsh-reliability-loop
 */

import { randomUUID } from 'node:crypto'
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { assertReliabilityLoopRecord } from './checks.ts'
import { LoopDriver } from './driver.ts'
import type { LoopDriverOutcome } from './driver.ts'
import { reliabilityLoopProjectionDefinition } from './projection.ts'
import type { ReliabilityLoopProjectionState } from './projection.ts'
import { reliabilityLoopDomainSpec } from './spec.ts'
import { ReliabilityLoopId, isTerminalStage } from './types.ts'
import type {
  ReliabilityLoopDetails,
  ReliabilityLoopLane,
  ReliabilityLoopRecord,
  ReliabilityLoopRef,
  ReliabilityLoopStartAck,
  ReliabilityLoopStatusView,
  ReliabilityLoopTerminalNotice,
} from './types.ts'

export { assertReliabilityLoopRecord } from './checks.ts'
export { reliabilityLoopProjectionDefinition } from './projection.ts'
export { reliabilityLoopDomainSpec, reliabilityLoopRecord } from './spec.ts'
export { IMPLEMENT_SCRIPT, REVIEW_SCRIPT, StageReportError } from './scripts.ts'
export { ReliabilityLoopId, TERMINAL_STAGES, isTerminalStage } from './types.ts'
export type * from './types.ts'

/** Deployment-owned bounds. */
export interface Config {
  /** Maximum objective, report, and durable error characters. */
  maxHandoffChars?: number
}

export const Config: z<Config> = z.object({
  maxHandoffChars: z.natural().min(1).default(16_384),
})

/** Host-only detached start request. */
export interface ReliabilityLoopStartRequest {
  /** Exact live root Agent whose Session owns the loop. */
  readonly parent: Agent
  /** Complete bounded objective. */
  readonly objective: string
  /** Exact implementation lane snapshot. */
  readonly implementation: ReliabilityLoopLane
  /** Exact review lane snapshot. */
  readonly review: ReliabilityLoopLane
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    reliabilityLoopRuntime: ReliabilityLoopRuntime
  }
}

type DriverGuard = () => void | Promise<void>

interface LiveDriver {
  readonly driver: LoopDriver
  readonly parent: Agent
  readonly guard: DriverGuard
}

/** Detached, Host-owned reliability-loop runtime and Remote provider. */
export class ReliabilityLoopRuntime extends TypertRemoteService {
  static inject = ['workflowEngine', 'storageDomain', 'agents', 'sessionProjections']

  static Config: z<Config> = Config

  private table: KvTable<ReliabilityLoopId, ReliabilityLoopRecord> | undefined
  private readonly live = new Map<ReliabilityLoopId, LiveDriver>()
  private readonly activeBySession = new Map<SessionId, ReliabilityLoopId>()
  private readonly newestBySession = new Map<SessionId, ReliabilityLoopId>()
  private readonly tails = new Map<SessionId, Promise<void>>()
  private readonly maxHandoffChars: number
  private stopping = false

  /**
   * @param ctx - Host context carrying storage, workflow, Agent, and projection capabilities.
   * @param config - resolved deployment bounds.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'reliabilityLoopRuntime')
    this.maxHandoffChars = (config as Required<Config>).maxHandoffChars
    ctx.sessionProjections.register(reliabilityLoopProjectionDefinition)
  }

  /** Open and index the domain before adopting every existing root Agent. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(reliabilityLoopDomainSpec)
    this.table = domain.table('loops')
    this.buildIndexes()
    this.ctx.effect(() => this.domainLifecycle(domain), 'reliability-loop.domain')
    this.ctx.on('agent/created', ({ agent }) => {
      if (!this.isRoot(agent) || this.stopping) return
      void this.adopt(agent).catch((error: unknown) => {
        this.ctx.logger.error(`reliability loop adoption failed for Session '${agent.id}': ${String(error)}`)
      })
    })
    await Promise.all(this.ctx.agents.roots().map(agent => this.adopt(agent)))
  }

  /** Close after background drivers and queued mutations have stopped. */
  private *domainLifecycle(domain: Domain<typeof reliabilityLoopDomainSpec>): Generator<() => Promise<void>> {
    yield () => domain.close()
    yield async () => {
      this.stopping = true
      await this.stopLiveDrivers()
      await Promise.all([...this.tails.values()])
    }
  }

  /**
   * Persist and claim one background loop, then return before any stage settles.
   * A duplicate active start returns that loop's current ref and never creates
   * a second writer.
   * @param request - root Session, objective, and exact lane snapshots.
   * @returns durable acceptance acknowledgement.
   */
  startDetached(request: ReliabilityLoopStartRequest): Promise<ReliabilityLoopStartAck> {
    const sessionId = request.parent.session.id
    return this.queue(sessionId, async () => {
      this.assertLiveRoot(request.parent)
      this.assertStartRequest(request)
      const existingId = this.activeBySession.get(sessionId)
      if (existingId !== undefined) {
        const existing = this.requireRecord(existingId)
        if (!isTerminalStage(existing.stage)) {
          if (!this.live.has(existingId)) this.launch(this.claim(existing, request.parent))
          return { loopId: existing.loopId, revision: existing.revision, status: 'accepted' }
        }
        // A domain write precedes its derived index update. Reconcile the
        // terminal record here if a new handoff lands in that narrow window.
        this.index(existing)
      }

      const newestId = this.newestBySession.get(sessionId)
      const newestCreatedAt = newestId === undefined ? 0 : Date.parse(this.requireRecord(newestId).createdAt) + 1
      const now = new Date(Math.max(Date.now(), newestCreatedAt)).toISOString()
      const record: ReliabilityLoopRecord = {
        loopId: ReliabilityLoopId(randomUUID()),
        revision: 1,
        sessionId,
        objective: request.objective,
        stage: 'accepted',
        implementation: { ...request.implementation },
        review: { ...request.review },
        rounds: [],
        createdAt: now,
        updatedAt: now,
      }
      assertReliabilityLoopRecord(record)
      await this.requireTable().put(record.loopId, record)
      this.index(record)
      const live = this.claim(record, request.parent)
      await this.publish(request.parent)
      this.launch(live)
      return { loopId: record.loopId, revision: record.revision, status: 'accepted' }
    })
  }

  /**
   * Every durable record in storage order.
   * @returns record snapshots.
   */
  list(): ReliabilityLoopRecord[] {
    return [...this.requireTable().entries()].map(([, record]) => record)
  }

  /**
   * Read one durable record without granting cross-Session Remote access.
   * @param loopId - exact loop identity.
   * @returns the record or undefined.
   */
  get(loopId: ReliabilityLoopId): ReliabilityLoopRecord | undefined {
    return this.requireTable().get(loopId)
  }

  /**
   * Return the current full record for one loop in the caller's Session.
   * Read access is Session-authenticated but not revision-gated so a terminal
   * Conversation node remains useful after its status dock is dismissed.
   * @param agent - exact live Agent resolved by Typert.
   * @param ref - loop identity plus the caller's observed revision.
   * @returns bounded objective and every settled report.
   */
  @Remote('details')
  details(agent: Agent, ref: ReliabilityLoopRef): ReliabilityLoopDetails {
    this.assertLive(agent)
    return detailsOf(this.ownedRecord(agent, ref.loopId))
  }

  /**
   * Explicitly cancel one active loop and wait for stage resources to stop.
   * @param agent - exact live Agent resolved by Typert.
   * @param ref - expected current revision.
   * @returns terminal status after quiescence.
   */
  @Remote('cancel')
  cancel(agent: Agent, ref: ReliabilityLoopRef): Promise<ReliabilityLoopStatusView> {
    return this.queue(agent.session.id, async () => {
      this.assertLive(agent)
      const record = this.expectOwnedRecord(agent, ref)
      if (isTerminalStage(record.stage)) throw new Error(`reliability loop '${record.loopId}' is already settled`)
      const owned = this.live.get(record.loopId)
      if (owned !== undefined) {
        owned.driver.cancel()
        const outcome = await owned.driver.result
        return statusOf(outcome.record)
      }
      const now = nextInstant(record)
      const cancelled: ReliabilityLoopRecord = {
        ...record,
        revision: record.revision + 1,
        stage: 'cancelled',
        updatedAt: now,
        settledAt: now,
      }
      await this.commit(agent, cancelled)
      return statusOf(cancelled)
    })
  }

  /**
   * Hide the currently visible terminal dock without deleting durable history.
   * @param agent - exact live Agent resolved by Typert.
   * @param ref - expected current terminal revision.
   * @returns the new tombstone revision.
   */
  @Remote('dismiss')
  dismiss(agent: Agent, ref: ReliabilityLoopRef): Promise<ReliabilityLoopRef> {
    return this.queue(agent.session.id, async () => {
      this.assertLive(agent)
      const record = this.expectOwnedRecord(agent, ref)
      const selected = this.selectedRecord(agent.session.id)
      if (!isTerminalStage(record.stage) || selected?.loopId !== record.loopId || record.dismissedAt !== undefined) {
        throw new Error(`reliability loop '${record.loopId}' is not the visible terminal loop`)
      }
      const now = nextInstant(record)
      const dismissed: ReliabilityLoopRecord = {
        ...record,
        revision: record.revision + 1,
        updatedAt: now,
        dismissedAt: now,
      }
      await this.commit(agent, dismissed)
      return { loopId: dismissed.loopId, revision: dismissed.revision }
    })
  }

  /** Scan storage once and fail on two active loops for one Session. */
  private buildIndexes(): void {
    for (const [, record] of this.requireTable().entries()) {
      assertReliabilityLoopRecord(record)
      this.index(record)
    }
  }

  /** Apply one committed record to the process-local Session indexes. */
  private index(record: ReliabilityLoopRecord): void {
    const active = this.activeBySession.get(record.sessionId)
    if (isTerminalStage(record.stage)) {
      if (active === record.loopId) this.activeBySession.delete(record.sessionId)
    } else if (active !== undefined && active !== record.loopId) {
      throw new Error(
        `Session '${record.sessionId}' has multiple active reliability loops ('${active}' and '${record.loopId}')`,
      )
    } else {
      this.activeBySession.set(record.sessionId, record.loopId)
    }
    const newestId = this.newestBySession.get(record.sessionId)
    if (newestId === undefined || newer(record, this.requireRecord(newestId))) {
      this.newestBySession.set(record.sessionId, record.loopId)
    }
  }

  /** Reconcile missing derived events and resume the unique active record. */
  private adopt(agent: Agent): Promise<void> {
    return this.queue(agent.session.id, async () => {
      if (this.stopping || !this.isRoot(agent) || this.ctx.agents.get(agent.id) !== agent) return
      const records = this.recordsFor(agent.session.id)
      for (const record of records) {
        if (isTerminalStage(record.stage) && !terminalDelivered(agent, record.loopId)) {
          await this.publish(agent, record)
        }
      }
      await this.publish(agent)
      const activeId = this.activeBySession.get(agent.session.id)
      if (activeId === undefined || this.live.has(activeId)) return
      this.launch(this.claim(this.requireRecord(activeId), agent))
    })
  }

  /** Claim process-local ownership and install an Agent-scoped suspend guard. */
  private claim(record: ReliabilityLoopRecord, parent: Agent): LiveDriver {
    if (this.live.has(record.loopId)) throw new Error(`reliability loop '${record.loopId}' already has a live owner`)
    const driver = new LoopDriver(
      this.ctx.workflowEngine,
      this.requireTable(),
      parent,
      this.maxHandoffChars,
      record.loopId,
      committed => this.afterDriverCommit(parent, committed),
    )
    const guard = parent.ctx.effect(() => async () => {
      driver.suspend(`owning Agent '${parent.id}' disposed`)
      await driver.result.catch(() => { /* the runtime observer reports durable faults */ })
      const live = this.live.get(record.loopId)
      if (live?.driver === driver) this.live.delete(record.loopId)
    }, `reliability-loop.driver(${record.loopId})`)
    const live = { driver, parent, guard }
    this.live.set(record.loopId, live)
    return live
  }

  /** Attach the sole result observer before starting the driver. */
  private launch(live: LiveDriver): void {
    void this.observe(live)
    void live.driver.drive()
  }

  /** Contain driver settlement/rejection and release its exact ownership slot. */
  private async observe(live: LiveDriver): Promise<void> {
    let outcome: LoopDriverOutcome | undefined
    try {
      outcome = await live.driver.result
    } catch (error) {
      this.ctx.logger.error(`reliability loop '${live.driver.loopId}' stopped after a durable-state fault: ${String(error)}`)
    } finally {
      if (this.live.get(live.driver.loopId) === live) this.live.delete(live.driver.loopId)
      await Promise.resolve(live.guard()).catch((error: unknown) => {
        this.ctx.logger.warn(`reliability loop '${live.driver.loopId}' guard cleanup failed: ${String(error)}`)
      })
    }
    if (outcome?.kind === 'terminal') await this.publish(live.parent, outcome.record)
  }

  /** Update indexes and publish after the driver's authoritative domain commit. */
  private async afterDriverCommit(parent: Agent, record: ReliabilityLoopRecord): Promise<void> {
    this.index(record)
    await this.publish(parent, isTerminalStage(record.stage) ? record : undefined)
  }

  /** Commit a non-driver mutation and then publish its derived whole value. */
  private async commit(agent: Agent, record: ReliabilityLoopRecord): Promise<void> {
    assertReliabilityLoopRecord(record)
    await this.requireTable().put(record.loopId, record)
    this.index(record)
    await this.publish(agent, isTerminalStage(record.stage) ? record : undefined)
  }

  /** Append the selected Session status and optional once-per-loop terminal notice. */
  private publish(agent: Agent, terminal?: ReliabilityLoopRecord): Promise<void> {
    if (this.ctx.agents.get(agent.id) !== agent) return Promise.resolve()
    const state = this.projectionState(agent)
    const selected = this.selectedRecord(agent.session.id)
    const current = selected === undefined ? null : statusOf(selected)
    const includeTerminal = terminal !== undefined
      && isTerminalStage(terminal.stage)
      && !terminalDelivered(agent, terminal.loopId)
    if (sameRef(state.current, current) && !includeTerminal) return Promise.resolve()
    const notice = includeTerminal ? terminalNotice(terminal) : undefined
    try {
      agent.session.append('reliability-loop/change', {
        version: 1,
        turn: null,
        current,
        ...notice === undefined ? {} : { terminal: notice },
      })
    } catch (error) {
      this.ctx.logger.warn(
        `reliability loop '${terminal?.loopId ?? current?.loopId ?? 'none'}' derived Session publish failed: ${String(error)}`,
      )
    }
    return Promise.resolve()
  }

  /** Current host projection state, rejecting an already-corrupt owned stream. */
  private projectionState(agent: Agent): ReliabilityLoopProjectionState {
    const state = this.ctx.sessionProjections.stateOf(agent.session, 'reliabilityLoop')
    if (state === undefined) throw new Error('reliabilityLoop projection is not registered')
    if (state.failure !== null) throw new Error(state.failure)
    return state
  }

  /** Active record, otherwise newest terminal unless that exact record was dismissed. */
  private selectedRecord(sessionId: SessionId): ReliabilityLoopRecord | undefined {
    const selectedId = this.activeBySession.get(sessionId) ?? this.newestBySession.get(sessionId)
    if (selectedId === undefined) return undefined
    const record = this.requireRecord(selectedId)
    return record.dismissedAt === undefined ? record : undefined
  }

  /** Records for one Session in creation order. */
  private recordsFor(sessionId: SessionId): ReliabilityLoopRecord[] {
    return this.list()
      .filter(record => record.sessionId === sessionId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.loopId.localeCompare(right.loopId))
  }

  /** Reject forged or cross-Session loop refs. */
  private expectOwnedRecord(agent: Agent, ref: ReliabilityLoopRef): ReliabilityLoopRecord {
    const record = this.ownedRecord(agent, ref.loopId)
    if (record.revision !== ref.revision) {
      throw new Error(
        `stale reliability loop '${ref.loopId}' revision ${ref.revision}; current revision is ${record.revision}`,
      )
    }
    return record
  }

  /** Authenticate one loop identity against the caller's Session. */
  private ownedRecord(agent: Agent, loopId: ReliabilityLoopId): ReliabilityLoopRecord {
    const record = this.requireRecord(loopId)
    if (record.sessionId !== agent.session.id) throw new Error(`reliability loop '${loopId}' does not belong to this Session`)
    return record
  }

  /** Validate root authority and exact Agent registry identity. */
  private assertLiveRoot(agent: Agent): void {
    this.assertLive(agent)
    if (!this.isRoot(agent)) throw new Error(`agent '${agent.id}' is not a live root Agent`)
  }

  /** Validate exact live Agent identity. */
  private assertLive(agent: Agent): void {
    if (this.ctx.agents.get(agent.id) !== agent) throw new Error(`agent '${agent.id}' is not live in this registry`)
  }

  private isRoot(agent: Agent): boolean {
    return this.ctx.agents.roots().includes(agent)
  }

  /** Validate bounded objective and complete immutable lanes. */
  private assertStartRequest(request: ReliabilityLoopStartRequest): void {
    if (request.objective.length === 0) throw new Error('reliability loop objective must not be empty')
    if (request.objective.length > this.maxHandoffChars) {
      throw new Error(
        `reliability loop objective is ${request.objective.length} characters, over the ${this.maxHandoffChars} handoff bound`,
      )
    }
    assertLane('implementation', request.implementation)
    assertLane('review', request.review)
  }

  /** Serialize Session mutations without coupling background stage writes to the caller. */
  private queue<T>(sessionId: SessionId, work: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(sessionId) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(work)
    const tail = current.then(() => undefined, () => undefined)
    this.tails.set(sessionId, tail)
    void tail.finally(() => {
      if (this.tails.get(sessionId) === tail) this.tails.delete(sessionId)
    })
    return current
  }

  /** Suspend every driver before its storage domain closes. */
  private async stopLiveDrivers(): Promise<void> {
    const drivers = [...this.live.values()]
    for (const { driver } of drivers) driver.suspend('reliability-loop runtime stopping')
    await Promise.all(drivers.map(({ driver }) => driver.result.catch(() => undefined)))
    this.live.clear()
  }

  private requireRecord(loopId: ReliabilityLoopId): ReliabilityLoopRecord {
    const record = this.requireTable().get(loopId)
    if (record === undefined) throw new Error(`unknown reliability loop '${loopId}'`)
    assertReliabilityLoopRecord(record)
    return record
  }

  private requireTable(): KvTable<ReliabilityLoopId, ReliabilityLoopRecord> {
    if (this.table === undefined) throw new Error('reliability loop runtime is not started yet')
    return this.table
  }
}

/** Validate one exact lane without provider-specific assumptions. */
function assertLane(label: string, lane: ReliabilityLoopLane): void {
  if (lane.provider.length === 0 || lane.model.length === 0 || lane.reasoningEffort === '') {
    throw new Error(`reliability loop ${label} lane is incomplete`)
  }
}

/** Compare records by creation, then stable id for equal clocks. */
function newer(candidate: ReliabilityLoopRecord, current: ReliabilityLoopRecord): boolean {
  const compared = candidate.createdAt.localeCompare(current.createdAt)
  return compared > 0 || (compared === 0 && candidate.loopId.localeCompare(current.loopId) > 0)
}

/**
 * Convert one record to the bounded client projection.
 * @param record - authoritative durable record.
 * @returns complete bounded status view.
 */
export function statusOf(record: ReliabilityLoopRecord): ReliabilityLoopStatusView {
  const terminalSummary = isTerminalStage(record.stage) ? summaryOf(record) : undefined
  return {
    loopId: record.loopId,
    revision: record.revision,
    stage: record.stage,
    objectiveSummary: record.objective.slice(0, 160),
    implementation: { ...record.implementation },
    review: { ...record.review },
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...record.settledAt === undefined ? {} : { settledAt: record.settledAt },
    ...record.error === undefined ? {} : { error: record.error },
    ...terminalSummary === undefined ? {} : { terminalSummary },
  }
}

/** Convert one owned record to full authenticated details. */
function detailsOf(record: ReliabilityLoopRecord): ReliabilityLoopDetails {
  return { ...statusOf(record), objective: record.objective, rounds: record.rounds.map(round => ({ ...round })) }
}

/** Deterministic terminal summary, independently bounded from full reports. */
function summaryOf(record: ReliabilityLoopRecord): string {
  let summary: string
  switch (record.stage) {
    case 'completed':
      summary = record.rounds.at(-1)?.implementation?.summary ?? 'Completed after independent review.'
      break
    case 'blocked':
      summary = record.rounds.at(-1)?.review?.feedback ?? 'The bounded rework still requires changes.'
      break
    case 'failed':
      summary = record.error ?? 'The reliability workflow failed.'
      break
    case 'cancelled':
      summary = 'Cancelled by the user.'
      break
    /* v8 ignore start -- callers guard terminality. */
    default:
      return ''
    /* v8 ignore stop */
  }
  return summary.slice(0, 800)
}

/** Build one stable terminal notification. */
function terminalNotice(record: ReliabilityLoopRecord): ReliabilityLoopTerminalNotice {
  if (!isTerminalStage(record.stage) || record.settledAt === undefined) {
    throw new Error(`loop '${record.loopId}' has no terminal notice`)
  }
  return {
    loopId: record.loopId,
    revision: record.revision,
    stage: record.stage,
    settledAt: record.settledAt,
    summary: summaryOf(record),
  }
}

/** Whether this Session already committed one terminal notification for the loop. */
function terminalDelivered(agent: Agent, loopId: ReliabilityLoopId): boolean {
  return agent.session.events.some(event => event.type === 'reliability-loop/change' && event.data.terminal?.loopId === loopId)
}

/** Ref equality used to skip redundant reconciliation events. */
function sameRef(left: ReliabilityLoopStatusView | null, right: ReliabilityLoopStatusView | null): boolean {
  if (left === null || right === null) return left === right
  return left.loopId === right.loopId && left.revision === right.revision
}

/** Monotonic next mutation instant. */
function nextInstant(record: ReliabilityLoopRecord): string {
  return new Date(Math.max(Date.now(), Date.parse(record.updatedAt))).toISOString()
}

export default ReliabilityLoopRuntime
