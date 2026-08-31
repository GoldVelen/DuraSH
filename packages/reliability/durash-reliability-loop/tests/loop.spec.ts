import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import Storage from '@deepseek-ai/dsh-storage'
import { storageBackendServiceKey } from '@deepseek-ai/dsh-storage'
import type { StorageBackend } from '@deepseek-ai/dsh-storage'
import {
  Config as storageDomainConfig,
  apply as storageDomainApply,
  inject as storageDomainInject,
  name as storageDomainName,
} from '@deepseek-ai/dsh-storage-domain'
import {
  Config as storageJsonConfig,
  JsonStorageBackend,
  apply as storageJsonApply,
  inject as storageJsonInject,
  name as storageJsonName,
} from '@deepseek-ai/dsh-storage-json'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import type {
  SubagentCapabilities,
  SubagentProvider,
  SubagentResult,
  SubagentRun,
  SubagentStartRequest,
} from '@deepseek-ai/dsh-subagent'
import WorkerThreadWorkflowEngine from '@deepseek-ai/dsh-workflow-worker-thread'
import ReliabilityLoopRuntime, {
  ReliabilityLoopId,
  statusOf,
} from '../src/index.ts'
import { applyReliabilityLoopProjection } from '../src/projection.ts'
import type {
  ReliabilityLoopRecord,
  ReliabilityLoopStage,
  ReliabilityLoopStatusView,
} from '../src/types.ts'

vi.setConfig({ testTimeout: 30_000 })

interface ControlledRun {
  readonly request: SubagentStartRequest
  readonly disposed: boolean
  settle(result: SubagentResult): void
}

class ManualProvider implements SubagentProvider {
  readonly name = 'stub'
  readonly capabilities: SubagentCapabilities = {
    agentOptions: true,
    outputSchema: true,
    depthLimit: true,
    toolFilter: true,
    persona: false,
  }
  readonly inheritsParentContext = false
  readonly runs: ControlledRun[] = []

  async start(request: SubagentStartRequest): Promise<SubagentRun> {
    const terminal = Promise.withResolvers<SubagentResult>()
    let disposed = false
    const run: ControlledRun = {
      request,
      get disposed() { return disposed },
      settle: (result) => { terminal.resolve(result) },
    }
    this.runs.push(run)
    request.signal.addEventListener('abort', () => {
      terminal.resolve({ output: [], stopReason: 'aborted' })
    }, { once: true })
    return {
      id: SessionId(`stub-child-${this.runs.length}`),
      localAgent: undefined,
      result: terminal.promise,
      dispose: () => { disposed = true; return Promise.resolve() },
    }
  }
}

interface Harness {
  readonly ctx: Context
  readonly manual: ManualProvider
  readonly parent: Agent
  runtime: ReliabilityLoopRuntime
  runtimeFiber: { dispose(): Promise<void> }
}

interface HarnessOptions {
  readonly failPutAt?: number
  readonly root?: string
}

const contexts: Context[] = []
const roots: string[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function harness(options: HarnessOptions = {}): Promise<Harness> {
  const root = options.root ?? await mkdtemp(join(tmpdir(), 'durash-loop-v2-'))
  if (!roots.includes(root)) roots.push(root)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SubagentRuntime)
  const manual = new ManualProvider()
  ctx.subagents.registerProvider(manual)
  await ctx.plugin(WorkerThreadWorkflowEngine, { provider: 'stub', maxConcurrentAgents: 8 })
  await ctx.plugin(Storage)
  if (options.failPutAt === undefined) {
    await ctx.plugin(
      { name: storageJsonName, inject: storageJsonInject, apply: storageJsonApply, Config: storageJsonConfig },
      { root },
    )
  } else {
    const backend = backendFailingAt(new JsonStorageBackend(root), options.failPutAt)
    ctx.storage.backend.register('json', backend)
    ctx.provide(storageBackendServiceKey('json'), backend)
  }
  await ctx.plugin(
    { name: storageDomainName, inject: storageDomainInject, apply: storageDomainApply, Config: storageDomainConfig },
    { backend: 'json' },
  )
  const session = ctx.sessions.create(SessionId('reliability-parent'))
  const parent = {
    id: session.id,
    session,
    ctx,
    options: {},
    status: 'idle',
  } as unknown as Agent
  ctx.agents.register(parent)
  const runtimeFiber = await ctx.plugin(ReliabilityLoopRuntime, {})
  return { ctx, manual, parent, runtime: ctx.reliabilityLoopRuntime, runtimeFiber }
}

function backendFailingAt(inner: StorageBackend, putIndex: number): StorageBackend {
  let puts = 0
  const innerKv = inner.kv
  if (innerKv === undefined) throw new Error('json backend has no kv facet')
  return {
    kv: {
      open: async (descriptor) => {
        const unit = await innerKv.open(descriptor)
        return {
          loadAll: () => unit.loadAll(),
          putRecord: async (table, key, value) => {
            puts += 1
            if (puts === putIndex) throw new Error('selected put failure')
            return unit.putRecord(table, key, value)
          },
          deleteRecord: (table, key) => unit.deleteRecord(table, key),
          setGlobal: value => unit.setGlobal(value),
          close: () => unit.close(),
        }
      },
    },
    close: () => inner.close(),
  }
}

function start(runtime: ReliabilityLoopRuntime, parent: Agent, objective = 'ship the widget') {
  return runtime.startDetached({
    parent,
    objective,
    implementation: { provider: 'xai', model: 'grok-4.6', reasoningEffort: 'high' as never },
    review: { provider: 'xai', model: 'grok-4.6', reasoningEffort: 'xhigh' as never },
  })
}

function implementReply(summary: string): SubagentResult {
  return { output: [], structured: { summary }, stopReason: 'completed' }
}

function reviewReply(verdict: 'approved' | 'changes-requested', feedback: string): SubagentResult {
  return { output: [], structured: { verdict, feedback }, stopReason: 'completed' }
}

async function child(manual: ManualProvider, number: number): Promise<ControlledRun> {
  await vi.waitFor(() => { expect(manual.runs.length).toBeGreaterThanOrEqual(number) }, { timeout: 20_000 })
  return manual.runs[number - 1]!
}

async function stage(runtime: ReliabilityLoopRuntime, expected: ReliabilityLoopStage): Promise<ReliabilityLoopRecord> {
  let record: ReliabilityLoopRecord | undefined
  await vi.waitFor(() => {
    const failed = runtime.list().find(candidate => candidate.stage === 'failed')
    if (failed !== undefined && expected !== 'failed') throw new Error(failed.error)
    record = runtime.list().find(candidate => candidate.stage === expected)
    expect(runtime.list().map(candidate => candidate.stage)).toContain(expected)
  }, { timeout: 20_000 })
  return record as ReliabilityLoopRecord
}

function terminalEvents(parent: Agent, loopId: string): number {
  return parent.session.events.filter(event =>
    event.type === 'reliability-loop/change' && event.data.terminal?.loopId === loopId).length
}

describe('detached reliability-loop runtime', () => {
  it('returns a durable acknowledgement while the first child is still unresolved', async () => {
    const h = await harness()
    const acknowledgement = await start(h.runtime, h.parent)
    expect(acknowledgement).toMatchObject({ revision: 1, status: 'accepted' })
    const run = await child(h.manual, 1)
    expect(run.disposed).toBe(false)
    expect(run.request.agentOptions).toEqual({ provider: 'xai', model: 'grok-4.6', reasoningEffort: 'high' })
    expect(h.parent.session.events.some(event => event.type === 'reliability-loop/change')).toBe(true)
  })

  it('returns the existing active ref for concurrent starts and owns one child', async () => {
    const h = await harness()
    const [first, second] = await Promise.all([start(h.runtime, h.parent), start(h.runtime, h.parent, 'duplicate')])
    expect(second.loopId).toBe(first.loopId)
    await child(h.manual, 1)
    expect(h.manual.runs).toHaveLength(1)
    expect(h.runtime.list()).toHaveLength(1)
  })

  it('admits a new loop after a terminal domain write even before its derived index update', async () => {
    const h = await harness()
    const first = await start(h.runtime, h.parent)
    const terminalCommit = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const runtime = h.runtime as unknown as {
      afterDriverCommit(parent: Agent, record: ReliabilityLoopRecord): Promise<void>
    }
    const afterDriverCommit = runtime.afterDriverCommit.bind(h.runtime)
    runtime.afterDriverCommit = async (parent, record) => {
      if (record.stage === 'completed') {
        terminalCommit.resolve(undefined)
        await release.promise
      }
      await afterDriverCommit(parent, record)
    }

    ;(await child(h.manual, 1)).settle(implementReply('done'))
    await stage(h.runtime, 'reviewing')
    ;(await child(h.manual, 2)).settle(reviewReply('approved', 'ok'))
    await terminalCommit.promise

    const second = await start(h.runtime, h.parent, 'next objective')
    expect(second.loopId).not.toBe(first.loopId)
    release.resolve(undefined)
    await child(h.manual, 3)
  })

  it('completes in the background and publishes one terminal notice', async () => {
    const h = await harness()
    const ack = await start(h.runtime, h.parent)
    ;(await child(h.manual, 1)).settle(implementReply('implemented and tested'))
    await stage(h.runtime, 'reviewing')
    const review = await child(h.manual, 2)
    expect(review.request.agentOptions).toEqual({ provider: 'xai', model: 'grok-4.6', reasoningEffort: 'xhigh' })
    review.settle(reviewReply('approved', 'independent evidence checked'))
    const outcome = await stage(h.runtime, 'completed')
    expect(outcome.rounds).toMatchObject([
      { round: 1, implementation: { summary: 'implemented and tested' }, review: { verdict: 'approved' } },
    ])
    expect(terminalEvents(h.parent, ack.loopId)).toBe(1)
    expect(h.ctx.sessionProjections.snapshot(h.parent.session).values.reliabilityLoop)
      .toMatchObject({ loopId: ack.loopId, stage: 'completed' })
  })

  it('retains both rounds and blocks after exactly one bounded rework', async () => {
    const h = await harness()
    await start(h.runtime, h.parent)
    ;(await child(h.manual, 1)).settle(implementReply('version one'))
    await stage(h.runtime, 'reviewing')
    ;(await child(h.manual, 2)).settle(reviewReply('changes-requested', 'fix the race'))
    await stage(h.runtime, 'rework-implementing')
    ;(await child(h.manual, 3)).settle(implementReply('version two'))
    await stage(h.runtime, 'rework-reviewing')
    ;(await child(h.manual, 4)).settle(reviewReply('changes-requested', 'race remains'))
    const outcome = await stage(h.runtime, 'blocked')
    expect(outcome.rounds).toHaveLength(2)
    expect(outcome.rounds[0]?.review?.feedback).toBe('fix the race')
    expect(outcome.rounds[1]?.implementation?.summary).toBe('version two')
    expect(outcome.rounds[1]?.review?.feedback).toBe('race remains')
    expect(h.manual.runs).toHaveLength(4)
  })

  it('explicit cancellation waits for child disposal and writes one terminal', async () => {
    const h = await harness()
    const ack = await start(h.runtime, h.parent)
    const run = await child(h.manual, 1)
    const current = h.runtime.get(ack.loopId)!
    const view = await h.runtime.cancel(h.parent, { loopId: current.loopId, revision: current.revision })
    expect(view.stage).toBe('cancelled')
    expect(run.disposed).toBe(true)
    expect(terminalEvents(h.parent, ack.loopId)).toBe(1)
  })

  it('Host teardown suspends without writing cancelled, then resumes the first unsettled stage', async () => {
    const h = await harness()
    const ack = await start(h.runtime, h.parent)
    const firstRun = await child(h.manual, 1)
    await h.runtimeFiber.dispose()
    expect(firstRun.disposed).toBe(true)

    h.runtimeFiber = await h.ctx.plugin(ReliabilityLoopRuntime, {})
    h.runtime = h.ctx.reliabilityLoopRuntime
    expect(h.runtime.get(ack.loopId)?.stage).toBe('implementing')
    const resumed = await child(h.manual, 2)
    resumed.settle(implementReply('resumed implementation'))
    await stage(h.runtime, 'reviewing')
    ;(await child(h.manual, 3)).settle(reviewReply('approved', 'resume verified'))
    expect((await stage(h.runtime, 'completed')).rounds[0]?.implementation?.summary)
      .toBe('resumed implementation')
  })

  it('contains a transition storage fault as a failed loop and keeps the Host usable', async () => {
    const h = await harness({ failPutAt: 2 })
    await start(h.runtime, h.parent)
    const failed = await stage(h.runtime, 'failed')
    expect(failed.error).toContain('selected put failure')

    const next = await start(h.runtime, h.parent, 'second objective')
    expect(next.loopId).not.toBe(failed.loopId)
    await child(h.manual, 1)
  })

  it('contains a failed workflow child and keeps the Host usable', async () => {
    const h = await harness()
    await start(h.runtime, h.parent)
    ;(await child(h.manual, 1)).settle({
      output: [],
      stopReason: 'error',
      diagnostic: 'provider failed before producing a report',
    })
    const failed = await stage(h.runtime, 'failed')
    expect(failed.error).toContain('implementation child failed')

    const next = await start(h.runtime, h.parent, 'second objective')
    expect(next.loopId).not.toBe(failed.loopId)
    await child(h.manual, 2)
  })

  it('does not duplicate a terminal notice after runtime recreation', async () => {
    const h = await harness()
    const ack = await start(h.runtime, h.parent)
    ;(await child(h.manual, 1)).settle(implementReply('done'))
    await stage(h.runtime, 'reviewing')
    ;(await child(h.manual, 2)).settle(reviewReply('approved', 'ok'))
    await stage(h.runtime, 'completed')
    expect(terminalEvents(h.parent, ack.loopId)).toBe(1)
    await h.runtimeFiber.dispose()
    h.runtimeFiber = await h.ctx.plugin(ReliabilityLoopRuntime, {})
    h.runtime = h.ctx.reliabilityLoopRuntime
    expect(terminalEvents(h.parent, ack.loopId)).toBe(1)
  })

  it('dismisses only the visible terminal and never resurfaces an older loop', async () => {
    const h = await harness()
    const ack = await start(h.runtime, h.parent)
    ;(await child(h.manual, 1)).settle(implementReply('done'))
    await stage(h.runtime, 'reviewing')
    ;(await child(h.manual, 2)).settle(reviewReply('approved', 'ok'))
    const terminal = await stage(h.runtime, 'completed')
    await h.runtime.dismiss(h.parent, { loopId: ack.loopId, revision: terminal.revision })
    expect(h.ctx.sessionProjections.snapshot(h.parent.session).values.reliabilityLoop).toBeNull()
    expect(h.runtime.details(h.parent, { loopId: ack.loopId, revision: terminal.revision }).rounds)
      .toEqual(terminal.rounds)

    const next = await start(h.runtime, h.parent, 'new objective')
    expect(next.loopId).not.toBe(ack.loopId)
    expect(h.ctx.sessionProjections.snapshot(h.parent.session).values.reliabilityLoop)
      .toMatchObject({ loopId: next.loopId })
  })

  it('allows stale same-Session reads while mutations and cross-Session reads fail closed', async () => {
    const h = await harness()
    const ack = await start(h.runtime, h.parent)
    await child(h.manual, 1)
    expect(h.runtime.details(h.parent, ack).revision).toBeGreaterThan(ack.revision)
    await expect(h.runtime.cancel(h.parent, ack)).rejects.toThrow(/stale/)

    const session = h.ctx.sessions.create(SessionId('other-root'))
    const other = { id: session.id, session, ctx: h.ctx, options: {}, status: 'idle' } as unknown as Agent
    h.ctx.agents.register(other)
    const current = h.runtime.get(ack.loopId)!
    expect(() => h.runtime.details(other, { loopId: current.loopId, revision: current.revision }))
      .toThrow(/does not belong/)
  })
})

describe('reliability-loop Session projection', () => {
  it('rejects a same-loop revision rollback without changing the current value', () => {
    const base = recordFixture()
    const first = applyReliabilityLoopProjection(
      { current: null, seenRevisions: {}, failure: null },
      eventFor({ ...statusOf(base), revision: 3 }, 0),
    )
    const next = applyReliabilityLoopProjection(first, eventFor({ ...statusOf(base), revision: 2 }, 1))
    expect(next.current?.revision).toBe(3)
    expect(next.failure).toContain('follows revision 3')
  })
})

function recordFixture(): ReliabilityLoopRecord {
  return {
    loopId: ReliabilityLoopId('loop-projection'),
    revision: 1,
    sessionId: SessionId('projection'),
    objective: 'projection objective',
    stage: 'accepted',
    implementation: { provider: 'xai', model: 'grok-4.6' },
    review: { provider: 'xai', model: 'grok-4.6' },
    rounds: [],
    createdAt: '2026-08-31T00:00:00.000Z',
    updatedAt: '2026-08-31T00:00:00.000Z',
  }
}

function eventFor(current: ReliabilityLoopStatusView, seq: number) {
  return {
    type: 'reliability-loop/change' as const,
    seq,
    time: 0,
    data: { version: 1 as const, turn: null, current },
  }
}
