import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import InvariantRegistry, { InvariantError } from '@deepseek-ai/dsh-invariants'
import { ReliabilityLoopId, isTerminalStage } from '../src/types.ts'
import type { ReliabilityLoopRecord } from '../src/types.ts'
import * as LoopInvariantCompanion from '../src/invariant.ts'
import { assertReliabilityLoopRecord } from '../src/checks.ts'

const validRecord: ReliabilityLoopRecord = {
  loopId: ReliabilityLoopId('loop-1'),
  objective: 'obj',
  createdAt: '2026-08-30T00:00:00.000Z',
  stage: 'implementing',
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
  return { ctx }
}

describe('reliability loop change-event invariants', () => {
  it('accepts a durable record that satisfies the stage machine', async () => {
    const { ctx } = await setup()
    expect(() => { ctx.emit('domain/changed', {
      domain: 'reliability_loop', table: 'loops', key: 'loop-1', operation: 'put', value: validRecord,
    }) }).not.toThrow()
    const terminal: ReliabilityLoopRecord = { ...validRecord, stage: 'cancelled', settledAt: 'x' }
    expect(() => { ctx.emit('domain/changed', {
      domain: 'reliability_loop', table: 'loops', key: 'loop-1', operation: 'put', value: terminal,
    }) }).not.toThrow()
    expect(isTerminalStage(terminal.stage)).toBe(true)
  })

  it('ignores other domains and rejects an unexpected table', async () => {
    const { ctx } = await setup()
    expect(() => { ctx.emit('domain/changed', {
      domain: 'workspace', table: 'workspaces', key: 'a', operation: 'put', value: validRecord,
    }) }).not.toThrow()
    expect(() => { ctx.emit('domain/changed', {
      domain: 'reliability_loop', table: 'ghost', key: 'loop-1', operation: 'put', value: validRecord,
    }) }).toThrow(invariantViolation)
  })

  it('rejects a durable record whose stage and attempt slots disagree', async () => {
    const { ctx } = await setup()
    expect(() => { ctx.emit('domain/changed', {
      domain: 'reliability_loop', table: 'loops', key: 'loop-1', operation: 'put',
      value: { ...validRecord, stage: 'reviewing' },
    }) }).toThrow(invariantViolation)
  })

  it('assertReliabilityLoopRecord is exported for the driver and tests', () => {
    expect(() => { assertReliabilityLoopRecord(validRecord) }).not.toThrow()
  })
})
