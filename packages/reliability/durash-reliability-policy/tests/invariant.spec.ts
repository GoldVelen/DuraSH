import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply, inject, name } from '../src/invariant.ts'

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
})
