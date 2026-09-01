import { describe, expect, it } from 'vitest'
import { apply as nodeApply } from '../src/index.ts'

describe('DuraSH brand Node entry', () => {
  it('keeps the Node half as an inert Loader seat', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })
})
