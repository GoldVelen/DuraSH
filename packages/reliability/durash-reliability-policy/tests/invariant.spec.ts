import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import InvariantRegistry, { InvariantError } from '@deepseek-ai/dsh-invariants'
import { apply, inject, name } from '../src/invariant.ts'
import * as PolicyInvariantCompanion from '../src/invariant.ts'

describe('durash-reliability-policy invariant companion', () => {
  it('registers under the package name', async () => {
    const ctx = new Context()
    const registered: string[] = []
    ctx.provide('invariants', {
      register: (packageName: string) => {
        registered.push(packageName)
        return () => undefined
      },
    })
    expect(name).toBe('durash-reliability-policy-invariant')
    expect(inject).toEqual(['invariants'])
    await apply(ctx)
    expect(registered).toEqual(['@durash/dsh-reliability-policy'])
  })

  it('accepts unrelated or complete rows and rejects the owned invalid changes', async () => {
    const ctx = new Context()
    await ctx.plugin(Storage)
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await ctx.plugin(PolicyInvariantCompanion)
    const violation: unknown = expect.objectContaining<Partial<InvariantError>>({
      code: 'INVARIANT',
      packageName: '@durash/dsh-reliability-policy',
    })
    expect(() => { ctx.emit('domain/changed', {
      domain: 'workspace', table: 'sessions', key: 'other', operation: 'put', value: {},
    }) }).not.toThrow()
    expect(() => { ctx.emit('domain/changed', {
      domain: 'reliability_policy', table: 'sessions', key: 'disabled', operation: 'put',
      value: { enabled: false, implementationModel: null, reviewModel: null },
    }) }).not.toThrow()
    expect(() => { ctx.emit('domain/changed', {
      domain: 'reliability_policy', table: 'sessions', key: 'enabled', operation: 'put',
      value: { enabled: true, implementationModel: 'provider/implement', reviewModel: 'provider/review' },
    }) }).not.toThrow()
    expect(() => { ctx.emit('domain/changed', {
      domain: 'reliability_policy', table: 'other', key: 'bad-table', operation: 'put', value: {},
    }) }).toThrow(violation)
    expect(() => { ctx.emit('domain/changed', {
      domain: 'reliability_policy', table: 'sessions', key: 'bad-row', operation: 'put',
      value: { enabled: true, implementationModel: 'provider/implement', reviewModel: null },
    }) }).toThrow(violation)
    await ctx.fiber.dispose()
  })
})
