import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import type {
  SubagentCapabilities, SubagentProvider, SubagentResult, SubagentRun, SubagentStartRequest,
} from '@deepseek-ai/dsh-subagent'
import WorkerThreadWorkflowEngine from '@deepseek-ai/dsh-workflow-worker-thread'
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
  apply as storageJsonApply,
  inject as storageJsonInject,
  name as storageJsonName,
} from '@deepseek-ai/dsh-storage-json'
import { SessionId } from '@deepseek-ai/dsh-session'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import { LoopDriver } from '../src/driver.ts'
import { reliabilityLoopDomainSpec } from '../src/spec.ts'
import ReliabilityLoopRuntime, { ReliabilityLoopId } from '../src/index.ts'
import { assertReliabilityLoopRecord } from '../src/checks.ts'
import type { ReliabilityLoopRecord, ReliabilityLoopStage } from '../src/index.ts'

// Allow cold worker startup on contended CI runners.
vi.setConfig({ testTimeout: 30_000 })

/** A minimal parent stand-in: the engine only threads it through to the provider. */
function fakeParent(): Agent {
  return { id: SessionId('reliability-parent'), options: {} } as unknown as Agent
}

/** Wait for an assertion over contended CI scheduling. */
function waitFor(assertion: () => void, timeout = 60_000): Promise<void> {
  return vi.waitFor(assertion, { timeout, interval: 20 })
}

/** One controllable child run the test settles by hand. */
interface ControlledRun {
  request: SubagentStartRequest
  settle(result: SubagentResult): void
  disposed: boolean
}

/** A manual in-test provider over the REAL SubagentRuntime registry: every child waits for the test. */
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
    terminal.promise.catch(() => { /* the test owns settlement */ })
    const controlled: ControlledRun = {
      request,
      settle: (result) => { terminal.resolve(result) },
      disposed: false,
    }
    this.runs.push(controlled)
    // Like the real in-process backends: a fired signal settles the run aborted.
    request.signal.addEventListener('abort', () => {
      terminal.resolve({ output: [], stopReason: 'aborted' })
    }, { once: true })
    return {
      id: SessionId(`stub-child-${this.runs.length - 1}`),
      localAgent: undefined,
      result: terminal.promise,
      dispose: () => {
        controlled.disposed = true
        return Promise.resolve()
      },
    }
  }
}

/**
 * A json backend whose Nth durable `putRecord` fails: the selected write is
 * rejected while every earlier write stays durable — the same medium a real
 * crash leaves behind.
 */
function backendFailingAt(inner: StorageBackend, putIndex: number): StorageBackend {
  let puts = 0
  const innerKv = inner.kv
  if (innerKv === undefined) throw new Error('the json backend must serve the kv facet')
  return {
    kv: {
      open: async (descriptor) => {
        const unit = await innerKv.open(descriptor)
        return {
          loadAll: () => unit.loadAll(),
          putRecord: async (table, key, value) => {
            puts += 1
            if (puts === putIndex) throw new Error('selected put failure: simulated crash')
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

/** The scripted child reply values. */
function implementReply(summary: string): SubagentResult {
  return { output: [], structured: { summary }, stopReason: 'completed' }
}

function reviewReply(verdict: 'approved' | 'changes-requested', feedback: string): SubagentResult {
  return { output: [], structured: { verdict, feedback }, stopReason: 'completed' }
}

function childPrompt(request: SubagentStartRequest): string {
  const first = request.prompt[0]
  return first !== undefined && first.type === 'text' ? first.text : ''
}

interface HarnessOptions {
  failPutAt?: number
}

const roots = new Set<string>()
const contexts: Context[] = []

/** Drop a context the test already disposed itself, so afterEach never double-disposes. */
function dropContext(ctx: Context): void {
  const at = contexts.indexOf(ctx)
  if (at >= 0) contexts.splice(at, 1)
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(async (ctx) => { await ctx.fiber.dispose() }))
  const ownedRoots = [...roots]
  roots.clear()
  await Promise.all(ownedRoots.map(root => rm(root, { recursive: true, force: true })))
})

interface HarnessOptions {
  failPutAt?: number
  maxHandoffChars?: number
  /** Reuse a prior harness's storage root: the restart equivalent of opening the same medium. */
  root?: string
}

/** Boot the real composition: subagent registry, worker-thread engine, storage family, loop runtime. */
async function harness(options: HarnessOptions = {}): Promise<{
  ctx: Context
  runtime: ReliabilityLoopRuntime
  runtimeFiber: { dispose(): Promise<void> }
  manual: ManualProvider
  parent: Agent
  root: string
  loopId: () => ReliabilityLoopId
}> {
  const root = options.root ?? await mkdtemp(join(tmpdir(), 'durash-reliability-loop-'))
  roots.add(root)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SubagentRuntime)
  const manual = new ManualProvider()
  ctx.subagents.registerProvider(manual)
  // A fixed concurrency ceiling: the auto-resolved default is machine-derived.
  await ctx.plugin(WorkerThreadWorkflowEngine, { provider: 'stub', maxConcurrentAgents: 8 })
  await ctx.plugin(Storage)
  if (options.failPutAt === undefined) {
    await ctx.plugin({ name: storageJsonName, inject: storageJsonInject, apply: storageJsonApply, Config: storageJsonConfig }, { root })
  } else {
    // Register the injected backend the way the json plugin's apply does: hub
    // registration plus the per-backend service the domain form waits on.
    const backend = backendFailingAt(new JsonStorageBackend(root), options.failPutAt)
    ctx.storage.backend.register('json', backend)
    ctx.provide(storageBackendServiceKey('json'), backend)
  }
  await ctx.plugin({ name: storageDomainName, inject: storageDomainInject, apply: storageDomainApply, Config: storageDomainConfig }, { backend: 'json' })
  const runtimeConfig = options.maxHandoffChars === undefined ? {} : { maxHandoffChars: options.maxHandoffChars }
  const runtimeFiber = await ctx.plugin(ReliabilityLoopRuntime, runtimeConfig)
  const parent = fakeParent()
  return {
    ctx,
    runtime: ctx.reliabilityLoopRuntime,
    runtimeFiber,
    manual,
    parent,
    root,
    loopId: () => {
      const records = ctx.reliabilityLoopRuntime.list()
      expect(records).toHaveLength(1)
      return records[0]!.loopId
    },
  }
}

/** Settle one manual child and wait for the record to name the expected stage. */
async function settleAndAwaitStage(
  runtime: ReliabilityLoopRuntime,
  run: ControlledRun,
  result: SubagentResult,
  stage: ReliabilityLoopStage,
): Promise<void> {
  run.settle(result)
  await waitFor(() => { expect(runtime.list().map(record => record.stage)).toContain(stage) })
}

/** Storage family only: an open reliability-loop domain table for driver-level unit tests. */
async function bareDomain(): Promise<Domain<typeof reliabilityLoopDomainSpec>> {
  const root = await mkdtemp(join(tmpdir(), 'durash-reliability-loop-bare-'))
  roots.add(root)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Storage)
  await ctx.plugin({ name: storageJsonName, inject: storageJsonInject, apply: storageJsonApply, Config: storageJsonConfig }, { root })
  await ctx.plugin({ name: storageDomainName, inject: storageDomainInject, apply: storageDomainApply, Config: storageDomainConfig }, { backend: 'json' })
  return ctx.storageDomain.open(reliabilityLoopDomainSpec)
}

/** Wait until the manual provider has produced the Nth child. */
async function awaitChild(manual: ManualProvider, count: number): Promise<ControlledRun> {
  await waitFor(() => { expect(manual.runs.length).toBeGreaterThanOrEqual(count) })
  return manual.runs[count - 1]!
}

describe('durash-reliability-loop', () => {
  it('drives implement then review to `completed` and keeps every transition durable', async () => {
    const { runtime, manual, loopId } = await harness()
    const handle = await runtime.start({ parent: fakeParent(), objective: 'ship the widget' })
    const id = loopId()

    // The durable record exists before any child starts.
    expect(runtime.get(id)?.stage).toBe('implementing')

    const implement = await awaitChild(manual, 1)
    expect(childPrompt(implement.request)).toContain('ship the widget')
    await settleAndAwaitStage(runtime, implement, implementReply('did the work'), 'reviewing')

    const review = await awaitChild(manual, 2)
    const prompt = childPrompt(review.request)
    expect(prompt).toContain('ship the widget')
    expect(prompt).toContain('did the work')
    await settleAndAwaitStage(runtime, review, reviewReply('approved', 'evidence checked'), 'completed')

    const outcome = await handle.result
    expect(outcome.stage).toBe('completed')
    expect(outcome.implement).toMatchObject({ round: 1, summary: 'did the work' })
    expect(outcome.review).toMatchObject({ round: 1, verdict: 'approved' })
    expect(outcome.settledAt).toBeDefined()
    expect(manual.runs).toHaveLength(2)
    expect(manual.runs.every(run => run.disposed)).toBe(true)
  })

  it('passes stored implementation and review routes to the stage children', async () => {
    const { runtime, manual } = await harness()
    await runtime.start({
      parent: fakeParent(),
      objective: 'ship the widget',
      implementation: { provider: 'deepseek-official', model: 'deepseek-v4-pro' },
      review: { provider: 'openai-codex', model: 'gpt-5' },
    })
    const implement = await awaitChild(manual, 1)
    expect(implement.request.agentOptions).toEqual({ provider: 'deepseek-official', model: 'deepseek-v4-pro' })
    await settleAndAwaitStage(runtime, implement, implementReply('did the work'), 'reviewing')
    const review = await awaitChild(manual, 2)
    expect(review.request.agentOptions).toEqual({ provider: 'openai-codex', model: 'gpt-5' })
  })

  it('runs exactly one bounded rework when the first review requests changes, then blocks', async () => {
    const { runtime, manual } = await harness()
    const handle = await runtime.start({ parent: fakeParent(), objective: 'ship the widget' })

    await settleAndAwaitStage(runtime, await awaitChild(manual, 1), implementReply('v1 work'), 'reviewing')
    await settleAndAwaitStage(runtime, await awaitChild(manual, 2), reviewReply('changes-requested', 'fix the flaky check'), 'rework-implementing')

    // The rework implement prompt carries the reviewer's feedback.
    const rework = await awaitChild(manual, 3)
    expect(childPrompt(rework.request)).toContain('fix the flaky check')
    await settleAndAwaitStage(runtime, rework, implementReply('v2 work'), 'rework-reviewing')

    const reReview = await awaitChild(manual, 4)
    const reReviewPrompt = childPrompt(reReview.request)
    expect(reReviewPrompt).toContain('v2 work')
    expect(reReviewPrompt).toContain('fix the flaky check')
    await settleAndAwaitStage(runtime, reReview, reviewReply('changes-requested', 'still broken'), 'blocked')

    const outcome = await handle.result
    expect(outcome.stage).toBe('blocked')
    expect(outcome.implement).toMatchObject({ round: 2, summary: 'v2 work' })
    expect(outcome.review).toMatchObject({ round: 2, verdict: 'changes-requested', feedback: 'still broken' })
    // Exactly one child per executed stage: no duplicated attempts anywhere.
    expect(manual.runs).toHaveLength(4)
  })

  it('completes after a rework when the second review approves', async () => {
    const { runtime, manual } = await harness()
    const handle = await runtime.start({ parent: fakeParent(), objective: 'ship the widget' })

    await settleAndAwaitStage(runtime, await awaitChild(manual, 1), implementReply('v1 work'), 'reviewing')
    await settleAndAwaitStage(runtime, await awaitChild(manual, 2), reviewReply('changes-requested', 'rename the export'), 'rework-implementing')
    await settleAndAwaitStage(runtime, await awaitChild(manual, 3), implementReply('v2 work'), 'rework-reviewing')
    await settleAndAwaitStage(runtime, await awaitChild(manual, 4), reviewReply('approved', 'verified the rename'), 'completed')

    const outcome = await handle.result
    expect(outcome.stage).toBe('completed')
    expect(outcome.review).toMatchObject({ round: 2, verdict: 'approved' })
  })

  it('fails the loop loud when a child fails or reports an unusable summary', async () => {
    const { runtime, manual } = await harness()
    const handle = await runtime.start({ parent: fakeParent(), objective: 'ship the widget' })
    // A child that fails resolves agent() null; the fixed script throws; the run ends 'error'.
    await settleAndAwaitStage(runtime, await awaitChild(manual, 1), { output: [], stopReason: 'error' }, 'failed')
    const outcome = await handle.result
    expect(outcome.stage).toBe('failed')
    expect(outcome.error).toContain('implementation child failed')
  })

  it('fails the loop loud when the implement summary is empty or over the handoff bound', async () => {
    const bounded = await harness({ maxHandoffChars: 32 })
    const over = await bounded.runtime.start({ parent: fakeParent(), objective: 'tight bound' })
    await settleAndAwaitStage(bounded.runtime, await awaitChild(bounded.manual, 1), implementReply('x'.repeat(40)), 'failed')
    const overOutcome = await over.result
    expect(overOutcome.stage).toBe('failed')
    expect(overOutcome.error).toContain('over the 32 handoff bound')

    const empty = await bounded.runtime.start({ parent: fakeParent(), objective: 'empty summary' })
    await settleAndAwaitStage(bounded.runtime, await awaitChild(bounded.manual, 2), implementReply(''), 'failed')
    expect((await empty.result).error).toContain('empty or missing')
  })

  it('fails the loop loud when the review feedback is empty or over the handoff bound', async () => {
    const bounded = await harness({ maxHandoffChars: 32 })
    const handle = await bounded.runtime.start({ parent: fakeParent(), objective: 'tight bound' })
    await settleAndAwaitStage(bounded.runtime, await awaitChild(bounded.manual, 1), implementReply('work'), 'reviewing')
    await settleAndAwaitStage(bounded.runtime, await awaitChild(bounded.manual, 2), reviewReply('changes-requested', 'x'.repeat(40)), 'failed')
    expect((await handle.result).error).toContain('over the 32 handoff bound')

    const second = await bounded.runtime.start({ parent: fakeParent(), objective: 'empty feedback' })
    await settleAndAwaitStage(bounded.runtime, await awaitChild(bounded.manual, 3), implementReply('work'), 'reviewing')
    await settleAndAwaitStage(bounded.runtime, await awaitChild(bounded.manual, 4), reviewReply('approved', ''), 'failed')
    expect((await second.result).error).toContain('empty or missing')
  })

  it('fails the stage loud when the stage run cannot start', async () => {
    const domain = await bareDomain()
    const table = domain.table('loops')
    const record: ReliabilityLoopRecord = {
      loopId: ReliabilityLoopId('loop-cannot-start'),
      objective: 'obj',
      createdAt: '2026-08-30T00:00:00.000Z',
      stage: 'implementing',
    }
    await table.put(record.loopId, record)
    const failingEngine = { start: () => { throw new Error('no provider route') } }
    const driver = new LoopDriver(failingEngine as never, table, fakeParent(), 16_384, record.loopId)
    void driver.drive()
    const outcome = await driver.result
    expect(outcome.stage).toBe('failed')
    expect(outcome.error).toContain('implement stage run could not start')
    await driver.dispose()
  })

  it('keeps a settled terminal stage when cancellation lands during its transition write', async () => {
    const domain = await bareDomain()
    const table = domain.table('loops')
    const record: ReliabilityLoopRecord = {
      loopId: ReliabilityLoopId('loop-cancel-during-write'),
      objective: 'obj',
      createdAt: '2026-08-30T00:00:00.000Z',
      stage: 'implementing',
    }
    await table.put(record.loopId, record)
    // Gate the terminal transition write so the cancel request lands mid-write.
    const gate = Promise.withResolvers<undefined>()
    const completedRun = {
      result: Promise.resolve({ value: { summary: 'done' }, stopReason: 'completed', agentsStarted: 1 }),
      cancel: () => {},
      dispose: () => Promise.resolve(),
    }
    const approvedRun = {
      result: Promise.resolve({ value: { verdict: 'approved', feedback: 'ok' }, stopReason: 'completed', agentsStarted: 1 }),
      cancel: () => {},
      dispose: () => Promise.resolve(),
    }
    let starts = 0
    let terminalWriteReached = false
    const gatedTable = {
      get: (key: ReliabilityLoopId) => table.get(key),
      put: async (key: ReliabilityLoopId, value: ReliabilityLoopRecord) => {
        if (value.stage === 'completed') {
          terminalWriteReached = true
          await gate.promise
        }
        await table.put(key, value)
      },
    }
    const driver = new LoopDriver(
      { start: () => (starts++ === 0 ? completedRun : approvedRun) } as never,
      gatedTable as never,
      fakeParent(),
      16_384,
      record.loopId,
    )
    void driver.drive()
    // Wait until the terminal transition write is inside the gate, then cancel mid-write.
    await waitFor(() => { expect(terminalWriteReached).toBe(true) })
    driver.cancel()
    gate.resolve(undefined)
    // The completed transition was durably kept; the cancel did not overwrite it.
    const outcome = await driver.result
    expect(outcome.stage).toBe('completed')
    await driver.dispose()
  })

  it('rejects a driver whose durable record vanishes mid-loop', async () => {
    const domain = await bareDomain()
    const table = domain.table('loops')
    const record: ReliabilityLoopRecord = {
      loopId: ReliabilityLoopId('loop-vanishing'),
      objective: 'obj',
      createdAt: '2026-08-30T00:00:00.000Z',
      stage: 'implementing',
    }
    await table.put(record.loopId, record)
    // The run's result only settles after the record is durably deleted, so
    // the driver's next read observes the vanished record deterministically.
    const deleted = Promise.withResolvers<undefined>()
    const vanishingRun = {
      result: deleted.promise.then(() => ({ value: { summary: 's' }, stopReason: 'completed', agentsStarted: 1 })),
      cancel: () => {},
      dispose: () => Promise.resolve(),
    }
    const vanishingEngine = {
      start: () => {
        void table.delete(record.loopId).then(() => { deleted.resolve(undefined) })
        return vanishingRun
      },
    }
    const driver = new LoopDriver(vanishingEngine as never, table, fakeParent(), 16_384, record.loopId)
    void driver.drive()
    await expect(driver.result).rejects.toThrow('absent from the durable store')
    await driver.dispose()
  })

  it('fails the loop loud when a run settles error without detail', async () => {
    const domain = await bareDomain()
    const table = domain.table('loops')
    const record: ReliabilityLoopRecord = {
      loopId: ReliabilityLoopId('loop-bare-error'),
      objective: 'obj',
      createdAt: '2026-08-30T00:00:00.000Z',
      stage: 'implementing',
    }
    await table.put(record.loopId, record)
    const bareRun = {
      result: Promise.resolve({ value: null, stopReason: 'error', agentsStarted: 0 }),
      cancel: () => {},
      dispose: () => Promise.resolve(),
    }
    const driver = new LoopDriver({ start: () => bareRun } as never, table, fakeParent(), 16_384, record.loopId)
    void driver.drive()
    const outcome = await driver.result
    expect(outcome.stage).toBe('failed')
    expect(outcome.error).toBe('implement stage run failed')
    await driver.dispose()
  })

  it('fails the loop loud when a run settles cancelled without a local cancel request', async () => {
    const domain = await bareDomain()
    const table = domain.table('loops')
    const record: ReliabilityLoopRecord = {
      loopId: ReliabilityLoopId('loop-phantom-cancel'),
      objective: 'obj',
      createdAt: '2026-08-30T00:00:00.000Z',
      stage: 'implementing',
    }
    await table.put(record.loopId, record)
    const phantomRun = {
      result: Promise.resolve({ value: null, stopReason: 'cancelled', agentsStarted: 0 }),
      cancel: () => {},
      dispose: () => Promise.resolve(),
    }
    const phantomEngine = { start: () => phantomRun }
    const driver = new LoopDriver(phantomEngine as never, table, fakeParent(), 16_384, record.loopId)
    void driver.drive()
    const outcome = await driver.result
    expect(outcome.stage).toBe('failed')
    expect(outcome.error).toContain('without a local cancel request')
    await driver.dispose()
  })

  it('refuses service calls before the domain opened', () => {
    const cold = new ReliabilityLoopRuntime(new Context(), { maxHandoffChars: 1 })
    expect(() => cold.list()).toThrow(/not started yet/)
    expect(() => cold.get(ReliabilityLoopId('missing'))).toThrow(/not started yet/)
  })

  it('restart recovery resumes from the first unsettled stage without re-running settled work', async () => {
    // The third durable write is the post-review transition: the crash lands
    // after the review settled but before the loop could record it.
    const first = await harness({ failPutAt: 3 })
    const handle = await first.runtime.start({ parent: first.parent, objective: 'migrate the schema' })
    const id = first.loopId()
    await settleAndAwaitStage(first.runtime, await awaitChild(first.manual, 1), implementReply('migrated tables'), 'reviewing')
    const review = await awaitChild(first.manual, 2)
    expect(childPrompt(review.request)).toContain('migrated tables')
    // The post-review transition is the injected failure: the write fails, the
    // record stays 'reviewing', and the loop rejects instead of settling.
    review.settle(reviewReply('approved', 'checked'))
    await expect(handle.result).rejects.toThrow('selected put failure')
    await handle.dispose()
    expect(first.runtime.get(id)?.stage).toBe('reviewing')
    await first.ctx.fiber.dispose()
    dropContext(first.ctx)

    // Fresh process equivalent: a new context over the same storage root.
    const second = await harness({ root: first.root })
    const records = second.runtime.list()
    expect(records).toHaveLength(1)
    const recovered = records[0]!
    expect(recovered.loopId).toBe(id)
    expect(recovered.stage).toBe('reviewing')
    expect(recovered.implement).toMatchObject({ round: 1, summary: 'migrated tables' })

    const resumed = second.runtime.resume(id, fakeParent())
    // Exactly one child appears — the review; the settled implementation is never re-run.
    const reReview = await awaitChild(second.manual, 1)
    expect(childPrompt(reReview.request)).toContain('migrated tables')
    await settleAndAwaitStage(second.runtime, reReview, reviewReply('approved', 'rechecked'), 'completed')

    const outcome = await resumed.result
    expect(outcome.stage).toBe('completed')
    expect(outcome.implement).toMatchObject({ round: 1, summary: 'migrated tables' })
    expect(outcome.review).toMatchObject({ round: 1, verdict: 'approved' })
    expect(second.manual.runs).toHaveLength(1)
  })

  it('repeated interruption and recovery never duplicates a task beyond its stage', { timeout: 120_000 }, async () => {
    // Crash #1: after the rework implement settled but before its transition write.
    const first = await harness({ failPutAt: 4 })
    const handle = await first.runtime.start({ parent: first.parent, objective: 'harden the parser' })
    const id = first.loopId()
    await settleAndAwaitStage(first.runtime, await awaitChild(first.manual, 1), implementReply('v1'), 'reviewing')
    await settleAndAwaitStage(first.runtime, await awaitChild(first.manual, 2), reviewReply('changes-requested', 'add fuzz tests'), 'rework-implementing')
    const rework = await awaitChild(first.manual, 3)
    expect(childPrompt(rework.request)).toContain('add fuzz tests')
    // The post-rework transition is the injected failure: the v2 summary is
    // lost with the crash and the record stays 'rework-implementing'.
    rework.settle(implementReply('v2 with fuzz'))
    await expect(handle.result).rejects.toThrow('selected put failure')
    await handle.dispose()
    expect(first.runtime.get(id)?.stage).toBe('rework-implementing')
    await first.ctx.fiber.dispose()
    dropContext(first.ctx)

    // Recovery #1 is itself interrupted before recording the rework outcome:
    // the rework attempt re-runs, and the record still names one rework slot.
    const second = await harness({ root: first.root, failPutAt: 1 })
    const resumedOnce = second.runtime.resume(id, fakeParent())
    const reworkRerun = await awaitChild(second.manual, 1)
    expect(childPrompt(reworkRerun.request)).toContain('add fuzz tests')
    reworkRerun.settle(implementReply('v2 with fuzz'))
    await expect(resumedOnce.result).rejects.toThrow('selected put failure')
    await resumedOnce.dispose()
    expect(second.runtime.get(id)?.stage).toBe('rework-implementing')
    expect(second.manual.runs).toHaveLength(1)
    await second.ctx.fiber.dispose()
    dropContext(second.ctx)

    // Recovery #2 completes: review round 1 is still settled and never re-created.
    const third = await harness({ root: first.root })
    const resumedTwice = third.runtime.resume(id, fakeParent())
    const reworkRerun2 = await awaitChild(third.manual, 1)
    expect(childPrompt(reworkRerun2.request)).toContain('add fuzz tests')
    await settleAndAwaitStage(third.runtime, reworkRerun2, implementReply('v2 with fuzz'), 'rework-reviewing')
    const reReview = await awaitChild(third.manual, 2)
    expect(childPrompt(reReview.request)).toContain('add fuzz tests')
    await settleAndAwaitStage(third.runtime, reReview, reviewReply('changes-requested', 'still flaky'), 'blocked')

    const outcome = await resumedTwice.result
    expect(outcome.stage).toBe('blocked')
    expect(outcome.implement).toMatchObject({ round: 2, summary: 'v2 with fuzz' })
    expect(outcome.review).toMatchObject({ round: 2, verdict: 'changes-requested', feedback: 'still flaky' })
    // Across all three owners the settled round-1 review ran exactly once.
    expect(first.manual.runs).toHaveLength(3)
    expect(third.manual.runs).toHaveLength(2)
  })

  it('cancellation settles the record, disposes the child, and leaves a quiescent owner', async () => {
    const { runtime, manual } = await harness()
    const handle = await runtime.start({ parent: fakeParent(), objective: 'audit the tree' })
    await settleAndAwaitStage(runtime, await awaitChild(manual, 1), implementReply('audit plan'), 'reviewing')
    // Wait for the review run to be in flight before cancelling, so the
    // cancel lands on a started stage rather than before it.
    await awaitChild(manual, 2)

    handle.cancel('user stopped')
    const outcome = await handle.result
    expect(outcome.stage).toBe('cancelled')
    expect(manual.runs).toHaveLength(2)
    expect(manual.runs[1]!.disposed).toBe(true)

    // The owner is quiescent: after disposal the durable record never changes again.
    await handle.dispose()
    const frozen: ReliabilityLoopRecord = outcome
    await new Promise((resolve) => { setTimeout(resolve, 50) })
    expect(runtime.get(outcome.loopId)).toEqual(frozen)
    expect(manual.runs).toHaveLength(2)

    // The loop is terminal: resume refuses, and a second cancel is a no-op.
    expect(() => { runtime.resume(outcome.loopId, fakeParent()) }).toThrow(/settled/)
    expect(() => { handle.cancel('again') }).not.toThrow()
    expect(runtime.get(outcome.loopId)).toEqual(frozen)
  })

  it('runtime teardown cancels every live loop to quiescence before the runtime closes its domain', async () => {
    const { ctx, runtime, runtimeFiber, manual } = await harness()
    const handle = await runtime.start({ parent: fakeParent(), objective: 'audit the tree' })
    const inFlight = handle.result
    await settleAndAwaitStage(runtime, await awaitChild(manual, 1), implementReply('audit plan'), 'reviewing')
    await awaitChild(manual, 2)

    // Disposing the runtime's own fiber is the ordered teardown: the driver
    // settles `cancelled` durably, then the runtime closes its domain.
    await runtimeFiber.dispose()
    dropContext(ctx)
    expect((await inFlight).stage).toBe('cancelled')
    expect(manual.runs).toHaveLength(2)
    expect(manual.runs[1]!.disposed).toBe(true)
  })

  it('refuses to start with an empty or oversized objective, and refuses double ownership', async () => {
    const { runtime, manual } = await harness({ maxHandoffChars: 32 })
    await expect(runtime.start({ parent: fakeParent(), objective: '' })).rejects.toThrow(/empty/)
    await expect(runtime.start({ parent: fakeParent(), objective: 'y'.repeat(33) })).rejects.toThrow(/handoff bound/)

    const handle = await runtime.start({ parent: fakeParent(), objective: 'small objective' })
    // Let the first stage's child start so the cancel below lands mid-flight.
    await awaitChild(manual, 1)
    expect(() => { runtime.resume(handle.loopId, fakeParent()) }).toThrow(/live owner/)

    handle.cancel()
    await handle.result
    expect(() => { runtime.resume(handle.loopId, fakeParent()) }).toThrow(/settled/)
    expect(() => { runtime.resume(ReliabilityLoopId('missing'), fakeParent()) }).toThrow(/unknown/)
    expect(manual.runs).toHaveLength(1)
  })

  it('rejects a stored record whose stage and attempt slots disagree', () => {
    const base: ReliabilityLoopRecord = {
      loopId: ReliabilityLoopId('loop-1'),
      objective: 'obj',
      createdAt: '2026-08-30T00:00:00.000Z',
      stage: 'implementing',
    }
    expect(() => { assertReliabilityLoopRecord(base) }).not.toThrow()

    const settled: ReliabilityLoopRecord = { ...base, stage: 'completed', settledAt: '2026-08-30T01:00:00.000Z', implement: { round: 1, summary: 's', agentsStarted: 1 }, review: { round: 1, verdict: 'approved', feedback: 'ok', agentsStarted: 1 } }
    expect(() => { assertReliabilityLoopRecord(settled) }).not.toThrow()

    const mismatch: [string, ReliabilityLoopRecord][] = [
      ['non-terminal carries settledAt', { ...base, settledAt: '2026-08-30T01:00:00.000Z' }],
      ['terminal lacks settledAt', { ...base, stage: 'completed', implement: { round: 1, summary: 's', agentsStarted: 1 }, review: { round: 1, verdict: 'approved', feedback: 'ok', agentsStarted: 1 } }],
      ['failed without error', { ...base, stage: 'failed', settledAt: 'x' }],
      ['failed carries error', { ...base, error: 'boom' }],
      ['reviewing without implement', { ...base, stage: 'reviewing' }],
      ['reviewing before review settles', { ...base, stage: 'reviewing', implement: { round: 1, summary: 's', agentsStarted: 1 }, review: { round: 1, verdict: 'approved', feedback: 'ok', agentsStarted: 1 } }],
      ['rework without changes-requested review', { ...base, stage: 'rework-implementing', implement: { round: 1, summary: 's', agentsStarted: 1 } }],
      ['rework review on round-1 implement', { ...base, stage: 'rework-reviewing', implement: { round: 1, summary: 's', agentsStarted: 1 }, review: { round: 1, verdict: 'changes-requested', feedback: 'f', agentsStarted: 1 } }],
      ['review without implement', { ...base, review: { round: 1, verdict: 'approved', feedback: 'ok', agentsStarted: 1 } }],
      ['round-2 implement without rework precondition', { ...base, stage: 'reviewing', implement: { round: 2, summary: 's', agentsStarted: 1 } }],
      ['blocked on round-1 review', { ...base, stage: 'blocked', settledAt: 'x', implement: { round: 1, summary: 's', agentsStarted: 1 }, review: { round: 1, verdict: 'changes-requested', feedback: 'f', agentsStarted: 1 } }],
      ['completed on mismatched rounds', { ...base, stage: 'completed', settledAt: 'x', implement: { round: 2, summary: 's', agentsStarted: 1 }, review: { round: 1, verdict: 'approved', feedback: 'ok', agentsStarted: 1 } }],
      ['completed on reversed rounds', { ...base, stage: 'completed', settledAt: 'x', implement: { round: 1, summary: 's', agentsStarted: 1 }, review: { round: 2, verdict: 'approved', feedback: 'ok', agentsStarted: 1 } }],
      ['completed without attempts', { ...base, stage: 'completed', settledAt: 'x' }],
      ['completed without review', { ...base, stage: 'completed', settledAt: 'x', implement: { round: 1, summary: 's', agentsStarted: 1 } }],
      ['completed with unapproved verdict', { ...base, stage: 'completed', settledAt: 'x', implement: { round: 1, summary: 's', agentsStarted: 1 }, review: { round: 1, verdict: 'changes-requested', feedback: 'f', agentsStarted: 1 } }],
      ['aborted with orphan review', { ...base, stage: 'cancelled', settledAt: 'x', review: { round: 1, verdict: 'approved', feedback: 'ok', agentsStarted: 1 } }],
    ]
    for (const [name, record] of mismatch) {
      expect(() => { assertReliabilityLoopRecord(record) }, name).toThrow()
    }

    // Every stage prefix the machine can be cancelled or failed from is valid.
    const abortedValid: [string, ReliabilityLoopRecord][] = [
      ['before any attempt', { ...base, stage: 'cancelled', settledAt: 'x' }],
      ['after round-1 implement', { ...base, stage: 'failed', settledAt: 'x', error: 'e', implement: { round: 1, summary: 's', agentsStarted: 1 } }],
      ['after the round-1 changes-requested review', { ...base, stage: 'cancelled', settledAt: 'x', implement: { round: 1, summary: 's', agentsStarted: 1 }, review: { round: 1, verdict: 'changes-requested', feedback: 'f', agentsStarted: 1 } }],
      ['after the round-2 implement', { ...base, stage: 'failed', settledAt: 'x', error: 'e', implement: { round: 2, summary: 's', agentsStarted: 1 }, review: { round: 1, verdict: 'changes-requested', feedback: 'f', agentsStarted: 1 } }],
    ]
    for (const [name, record] of abortedValid) {
      expect(() => { assertReliabilityLoopRecord(record) }, name).not.toThrow()
    }

    // Aborted records cannot carry shapes no transition path produces.
    const abortedInvalid: [string, ReliabilityLoopRecord][] = [
      ['approved review under an aborted stage', { ...base, stage: 'cancelled', settledAt: 'x', implement: { round: 1, summary: 's', agentsStarted: 1 }, review: { round: 1, verdict: 'approved', feedback: 'ok', agentsStarted: 1 } }],
      ['round-2 review under an aborted stage', { ...base, stage: 'failed', settledAt: 'x', error: 'e', implement: { round: 2, summary: 's', agentsStarted: 1 }, review: { round: 2, verdict: 'changes-requested', feedback: 'f', agentsStarted: 1 } }],
    ]
    for (const [name, record] of abortedInvalid) {
      expect(() => { assertReliabilityLoopRecord(record) }, name).toThrow()
    }
  })
})
