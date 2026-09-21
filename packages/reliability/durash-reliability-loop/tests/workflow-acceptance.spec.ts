import { describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { WorkflowEngine, WorkflowStartRequest } from '@deepseek-ai/dsh-workflow'
import { LoopDriver } from '../src/driver.ts'
import { ReliabilityLoopId } from '../src/types.ts'
import type { ReliabilityLoopRecord, RuntimeAcceptanceGate } from '../src/types.ts'
import type { AcceptanceTaskId } from '../src/acceptance-schema.ts'

const taskId = 'task' as AcceptanceTaskId
const approved = { verdict: 'approved', feedback: 'Reviewed original diff and evidence' }
const passing = { checksPassed: true, candidateKey: 'candidate-a', reasons: [], index: 'diff: /evidence/diff; results: /evidence/checks; test changes: new skip' }

function harness(gate?: RuntimeAcceptanceGate, maxHandoffChars = 16_384) {
  let record: ReliabilityLoopRecord = {
    loopId: ReliabilityLoopId('acceptance-loop'), objective: 'Show the saved item in the Widget',
    createdAt: '2026-09-21T00:00:00.000Z', stage: 'implementing', acceptanceTaskId: taskId,
  }
  const table = {
    get: () => record,
    put: (_key: ReliabilityLoopId, value: ReliabilityLoopRecord) => { record = value; return Promise.resolve() },
  } as unknown as KvTable<ReliabilityLoopId, ReliabilityLoopRecord>
  const start = vi.fn((request: WorkflowStartRequest) => ({
    result: Promise.resolve({
      value: (request.args as { label: string }).label === 'implement' ? { summary: 'Changed Widget code' } : approved,
      stopReason: 'completed', agentsStarted: 1,
    }),
    cancel: () => {}, dispose: () => Promise.resolve(),
  }))
  const driver = new LoopDriver({ start } as unknown as WorkflowEngine, table, {} as Agent, maxHandoffChars, record.loopId, gate)
  return { driver, start }
}

describe('workflow acceptance enforcement', () => {
  it('rejects model approval when required evidence fails and stops after one rework', async () => {
    const rejected = { ...passing, checksPassed: false, reasons: ['Final full-suite result failed'] }
    const gate = { inspect: vi.fn(async () => rejected), review: vi.fn(async () => rejected) }
    const { driver, start } = harness(gate)
    await driver.drive()
    const result = await driver.result
    expect(result.stage).toBe('blocked')
    expect(start).toHaveBeenCalledTimes(4)
    expect(result.review).toMatchObject({ verdict: 'changes-requested', modelVerdict: 'approved' })
    expect(result.review?.feedback).toContain('Final full-suite result failed')
    expect(result.diagnostic).toContain('candidate-a')
    expect(result.diagnostic).toContain('Unknown')
    expect(result.diagnostic).toContain(result.objective)
  })

  it('supplies raw evidence and test changes to the reviewer and binds approval to that candidate', async () => {
    const gate = { inspect: vi.fn(async () => passing), review: vi.fn(async () => passing) }
    const { driver, start } = harness(gate)
    await driver.drive()
    expect((await driver.result).stage).toBe('completed')
    const prompt = (start.mock.calls[1]?.[0].args as { prompt: string }).prompt
    expect(prompt).toContain(passing.index)
    expect(prompt).toContain('dsh_acceptance')
    expect(prompt).toContain('original diff')
    expect(gate.review).toHaveBeenCalledWith(taskId, 'approved', approved.feedback, 'candidate-a', expect.any(AbortSignal))
  })

  it('rejects approval for a different candidate even when its checks pass', async () => {
    const gate = {
      inspect: vi.fn(async () => passing),
      review: vi.fn(async () => ({ ...passing, candidateKey: 'candidate-b' })),
    }
    const { driver } = harness(gate)
    await driver.drive()
    const result = await driver.result
    expect(result.stage).toBe('blocked')
    expect(result.review?.feedback).toContain('Candidate identity changed')
  })

  it('preserves unverified status when result parsing fails after review', async () => {
    const gate = {
      inspect: vi.fn(async () => passing),
      review: vi.fn(async () => { throw new Error('Malformed xcresult') }),
    }
    const { driver } = harness(gate)
    await driver.drive()
    const result = await driver.result
    expect(result.stage).toBe('failed')
    expect(result.error).toContain('unverified: Error: Malformed xcresult')
  })

  it('leaves the loop incomplete when no acceptance service can verify its task', async () => {
    const { driver, start } = harness()
    await driver.drive()
    expect((await driver.result).stage).toBe('failed')
    expect(start).not.toHaveBeenCalled()
  })

  it('does not complete when cancellation arrives during final evidence verification', async () => {
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<typeof passing>()
    const gate = {
      inspect: vi.fn(async () => passing),
      review: vi.fn(async () => { entered.resolve(undefined); return release.promise }),
    }
    const { driver } = harness(gate)
    const driving = driver.drive()
    await entered.promise
    driver.cancel('stop verification')
    release.resolve(passing)
    await driving
    expect((await driver.result).stage).toBe('cancelled')
  })

  it('does not start a reviewer after cancellation while inspecting evidence', async () => {
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<typeof passing>()
    const gate = {
      inspect: vi.fn(async () => { entered.resolve(undefined); return release.promise }),
      review: vi.fn(async () => passing),
    }
    const { driver, start } = harness(gate)
    const driving = driver.drive()
    await entered.promise
    driver.cancel()
    release.resolve(passing)
    await driving
    expect((await driver.result).stage).toBe('cancelled')
    expect(start).toHaveBeenCalledTimes(1)
    expect(gate.review).not.toHaveBeenCalled()
  })

  it('aborts initial evidence inspection when the loop is cancelled', async () => {
    const entered = Promise.withResolvers<AbortSignal | undefined>()
    const release = Promise.withResolvers<typeof passing>()
    const gate = {
      inspect: vi.fn(async (_taskId: AcceptanceTaskId, signal?: AbortSignal) => {
        signal?.addEventListener('abort', () => { release.reject(signal.reason) }, { once: true })
        entered.resolve(signal)
        return release.promise
      }),
      review: vi.fn(async () => passing),
    }
    const { driver, start } = harness(gate)
    const driving = driver.drive()
    try {
      const signal = await entered.promise
      driver.cancel('cancel pending source inspection')
      expect(signal?.aborted).toBe(true)
      await driving
      expect((await driver.result).stage).toBe('cancelled')
      expect(start).toHaveBeenCalledTimes(1)
      expect(gate.review).not.toHaveBeenCalled()
    } finally {
      release.resolve(passing)
      await driving
    }
  })

  it('refuses an oversized complete evidence handoff before starting a reviewer', async () => {
    const gate = { inspect: vi.fn(async () => ({ ...passing, index: 'x'.repeat(16_384) })), review: vi.fn(async () => passing) }
    const { driver, start } = harness(gate)
    await driver.drive()
    expect((await driver.result).stage).toBe('failed')
    expect(start).toHaveBeenCalledTimes(1)
    expect(gate.review).not.toHaveBeenCalled()
  })
})
