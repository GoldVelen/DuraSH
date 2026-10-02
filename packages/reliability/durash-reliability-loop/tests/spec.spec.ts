import { describe, expect, it } from 'vitest'
import { reliabilityLoopRecord } from '../src/spec.ts'

describe('durable loop acceptance references', () => {
  const persisted = { loopId: 'stored-loop', objective: 'Review the pinned task', createdAt: '2026-10-02T00:00:00Z',
    stage: 'reviewing', implement: { round: 1, summary: 'Candidate ready', agentsStarted: 1 },
    acceptanceTaskId: 'pinned-acceptance-task', implementationProvider: 'implementation-provider', implementationModel: 'selected-implementation',
    reviewProvider: 'review-provider', reviewModel: 'selected-review' }

  it('retains the exact acceptance task and both saved routes while decoding a stored record', () => {
    expect(reliabilityLoopRecord.parse(JSON.parse(JSON.stringify(persisted)))).toEqual(persisted)
  })

  it('refuses a non-string persisted task reference instead of decoding an unrelated task', () => {
    expect(reliabilityLoopRecord.safeParse({ ...persisted, acceptanceTaskId: 42 }).success).toBe(false)
  })
})
