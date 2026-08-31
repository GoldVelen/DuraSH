import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { ReliabilityPolicyController } from '../src/client/controller.ts'
import type { ReliabilityPolicySnapshot } from '@durash/dsh-reliability-policy/client'

const SID = 's-ctrl' as SessionId

function snapshot(over: Partial<ReliabilityPolicySnapshot> = {}): ReliabilityPolicySnapshot {
  return {
    sessionId: SID,
    revision: 1,
    enabled: false,
    implementationModel: 'deepseek-official/deepseek-v4-pro',
    implementationThinking: 'high',
    reviewModel: 'deepseek-official/deepseek-v4-flash',
    reviewThinking: 'xhigh',
    updatedAt: 1,
    models: [],
    ...over,
  }
}

describe('ReliabilityPolicyController', () => {
  it('loads a Host snapshot and refuses enable without both lanes', async () => {
    const remote = {
      policy: vi.fn(() => Promise.resolve({ ok: true as const, value: snapshot() })),
      ensurePolicy: vi.fn(),
      configure: vi.fn(),
    }
    const controller = new ReliabilityPolicyController(remote)
    await expect(controller.loadPolicy(SID)).resolves.toEqual({ ok: true })
    expect(controller.sessionState(SID).policy.implementationModel).toBe('deepseek-official/deepseek-v4-pro')

    const catalogOnly = snapshot({ implementationModel: null, reviewModel: null, models: [{
      selector: 'deepseek-official/deepseek-v4-pro',
      label: 'DeepSeek V4 Pro',
      provider: 'deepseek-official',
      model: 'deepseek-v4-pro',
      badges: [],
      thinkingLevels: ['high'],
    }] })
    remote.policy.mockResolvedValueOnce({ ok: true as const, value: catalogOnly })
    remote.ensurePolicy.mockResolvedValueOnce({ ok: true as const, value: snapshot() })
    const cold = 's-cold' as SessionId
    await controller.loadPolicy(cold)
    await controller.ensurePolicy(cold)
    expect(remote.ensurePolicy).toHaveBeenCalled()

    const result = await controller.configure({
      sessionId: SID,
      enabled: true,
      implementationModel: null,
      implementationThinking: 'high',
      reviewModel: 'deepseek-official/deepseek-v4-flash',
      reviewThinking: 'xhigh',
    })
    expect(result.ok).toBe(false)
    expect(remote.configure).not.toHaveBeenCalled()
    controller.dispose()
  })
})
