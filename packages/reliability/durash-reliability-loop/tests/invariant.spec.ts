import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import InvariantRegistry, { InvariantError } from '@deepseek-ai/dsh-invariants'
import * as LoopInvariantCompanion from '../src/invariant.ts'
import { assertReliabilityLoopRecord } from '../src/checks.ts'
import { ReliabilityLoopId, isTerminalStage } from '../src/types.ts'
import type { ReliabilityLoopRecord } from '../src/types.ts'

const validRecord: ReliabilityLoopRecord = {
  loopId: ReliabilityLoopId('loop-1'),
  revision: 1,
  sessionId: SessionId('root-1'),
  objective: 'obj',
  stage: 'accepted',
  implementation: { provider: 'xai', model: 'grok-4.6' },
  review: { provider: 'xai', model: 'grok-4.6' },
  rounds: [],
  createdAt: '2026-08-30T00:00:00.000Z',
  updatedAt: '2026-08-30T00:00:00.000Z',
}

const invariantViolation: unknown = expect.objectContaining<Partial<InvariantError>>({
  code: 'INVARIANT',
  packageName: '@durash/dsh-reliability-loop',
})

async function setup() {
  const ctx = new Context()
  await ctx.plugin(Storage)
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(LoopInvariantCompanion)
  return ctx
}

describe('reliability-loop domain invariants', () => {
  it('accepts coherent active and terminal version-2 records', async () => {
    const ctx = await setup()
    expect(() => { ctx.emit('domain/changed', {
      domain: 'reliability_loop', table: 'loops', key: 'loop-1', operation: 'put', value: validRecord,
    }) }).not.toThrow()
    const terminal: ReliabilityLoopRecord = {
      ...validRecord,
      revision: 2,
      stage: 'cancelled',
      updatedAt: '2026-08-30T00:00:01.000Z',
      settledAt: '2026-08-30T00:00:01.000Z',
    }
    expect(() => { ctx.emit('domain/changed', {
      domain: 'reliability_loop', table: 'loops', key: 'loop-1', operation: 'put', value: terminal,
    }) }).not.toThrow()
    expect(isTerminalStage(terminal.stage)).toBe(true)
  })

  it('rejects unknown tables and an adjacent stage/round mismatch', async () => {
    const ctx = await setup()
    expect(() => { ctx.emit('domain/changed', {
      domain: 'reliability_loop', table: 'ghost', key: 'loop-1', operation: 'put', value: validRecord,
    }) }).toThrow(invariantViolation)
    expect(() => { ctx.emit('domain/changed', {
      domain: 'reliability_loop', table: 'loops', key: 'loop-1', operation: 'put',
      value: { ...validRecord, stage: 'reviewing' },
    }) }).toThrow(invariantViolation)
  })

  it('rejects non-terminal dismissal and exports the writer-side assertion', () => {
    expect(() => { assertReliabilityLoopRecord(validRecord) }).not.toThrow()
    expect(() => { assertReliabilityLoopRecord({ ...validRecord, dismissedAt: validRecord.updatedAt }) })
      .toThrow(/non-terminal/)
  })
})
