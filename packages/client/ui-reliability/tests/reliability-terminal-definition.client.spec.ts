import { describe, expect, it } from 'vitest'
import type { SessionEventLike } from '@deepseek-ai/dsh-api-session-controller/client'
import { reliabilityTerminalDefinition } from '../src/client/reliability-terminal-definition.ts'

describe('reliability terminal Conversation definition', () => {
  it('ignores activity and builds one stable loop-id result from the terminal notice', () => {
    const active = {
      type: 'reliability-loop/change',
      seq: 10,
      time: 1,
      data: { version: 1, turn: null, current: null },
    } as SessionEventLike
    expect(reliabilityTerminalDefinition.match(active)).toBeNull()

    const terminal = {
      type: 'reliability-loop/change',
      seq: 11,
      time: 2,
      data: {
        version: 1,
        turn: null,
        current: null,
        terminal: {
          loopId: 'loop-terminal',
          revision: 8,
          stage: 'completed',
          settledAt: '2026-08-31T00:00:00.000Z',
          summary: '实施与审查均已完成。',
        },
      },
    } as SessionEventLike
    expect(reliabilityTerminalDefinition.match(terminal)).toEqual({ id: 'loop-terminal', role: 'start' })
  })
})
