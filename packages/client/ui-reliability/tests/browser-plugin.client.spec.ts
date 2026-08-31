/**
 * ui-reliability browser half on a real SlotRegistry: the plugin occupies
 * conversation.input.left with the workflow chip.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { WorkflowPolicyDock } from '../src/client/WorkflowPolicyDock.tsx'
import type { WorkflowPolicyDockInjected } from '../src/client/index.ts'
import { apply, inject } from '../src/client/index.ts'
import { apply as nodeApply } from '../src/index.ts'

const SID = 's-workflow' as SessionId

const SNAPSHOT = {
  sessionId: SID,
  revision: 1,
  enabled: false,
  implementationModel: 'deepseek-official/deepseek-v4-pro',
  implementationThinking: 'high',
  reviewModel: 'deepseek-official/deepseek-v4-flash',
  reviewThinking: 'xhigh',
  updatedAt: 1,
  models: [],
}

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({
    name: 'root',
    children: { 'conversation.input.left': { kind: 'list', scope: 'session' } },
  } as never, () => null)
  const reliabilityPolicy = {
    policy: vi.fn(() => Promise.resolve({ ok: true, value: SNAPSHOT })),
    ensurePolicy: vi.fn(() => Promise.resolve({ ok: true, value: SNAPSHOT })),
    configure: vi.fn(() => Promise.resolve({ ok: true, value: { ...SNAPSHOT, enabled: true } })),
  }
  ctx.provide('remote', { reliabilityPolicy })
  ctx.provide('remote.reliabilityPolicy', reliabilityPolicy)
  ctx.provide('locale', new LocaleRuntime(ctx))
  return { ctx, slots, reliabilityPolicy }
}

describe('ui-reliability browser apply', () => {
  it('declares every service it binds', () => {
    expect(inject).toEqual(['slots', 'remote', 'remote.reliabilityPolicy', 'locale'])
  })

  it('node-half apply is an intentional no-op', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })

  it('registers the composer chip and tears it down', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const entry = b.slots.entries('conversation.input.left')[0]!
    expect(entry.component).toBe(WorkflowPolicyDock)
    const injected = (entry.inject as unknown as (id: SessionId) => WorkflowPolicyDockInjected)(SID)
    expect(injected.sessionId).toBe(SID)
    await expect(injected.loadPolicy()).resolves.toEqual({ ok: true })
    expect(b.reliabilityPolicy.policy).toHaveBeenCalledWith({ sessionId: SID })
    await fiber.dispose()
    expect(b.slots.entries('conversation.input.left')).toHaveLength(0)
  })
})
