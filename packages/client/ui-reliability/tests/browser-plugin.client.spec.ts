/**
 * ui-reliability browser half on a real SlotRegistry: the plugin occupies
 * conversation.input.left with the workflow chip.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { ReliabilityStatusDock } from '../src/client/ReliabilityStatusDock.tsx'
import { ReliabilityTerminalView } from '../src/client/ReliabilityTerminalView.tsx'
import { WorkflowPolicyDock } from '../src/client/WorkflowPolicyDock.tsx'
import type { ReliabilityStatusDockInjected, WorkflowPolicyDockInjected } from '../src/client/index.ts'
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
  validationError: null,
}

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({
    name: 'root',
    children: {
      'conversation.input.left': { kind: 'list', scope: 'session' },
      'conversation.input.dock': { kind: 'list', scope: 'session' },
      'conversation.chat.node': { kind: 'keyed', scope: 'session' },
    },
  } as never, () => null)
  slots.register({ name: 'conversation.input.dock', id: 'later', order: 0 }, () => null)
  const reliabilityPolicy = {
    policy: vi.fn(() => Promise.resolve({ ok: true, value: SNAPSHOT })),
    ensurePolicy: vi.fn(() => Promise.resolve({ ok: true, value: SNAPSHOT })),
    configure: vi.fn(() => Promise.resolve({ ok: true, value: { ...SNAPSHOT, enabled: true } })),
  }
  const reliabilityLoopRuntime = {
    details: vi.fn(),
    cancel: vi.fn(),
    dismiss: vi.fn(),
  }
  ctx.provide('remote', { reliabilityPolicy, reliabilityLoopRuntime })
  ctx.provide('remote.reliabilityPolicy', reliabilityPolicy)
  ctx.provide('remote.reliabilityLoopRuntime', reliabilityLoopRuntime)
  ctx.provide('locale', new LocaleRuntime(ctx))
  const registerDefinition = vi.fn(() => () => {})
  ctx.provide('uiConversation', { events: { register: registerDefinition } })
  return { ctx, slots, reliabilityPolicy, reliabilityLoopRuntime, registerDefinition }
}

describe('ui-reliability browser apply', () => {
  it('declares every service it binds', () => {
    expect(inject).toEqual([
      'slots', 'remote', 'remote.reliabilityPolicy', 'remote.reliabilityLoopRuntime', 'locale', 'uiConversation',
    ])
  })

  it('node-half apply is an intentional no-op', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })

  it('registers policy, order -10 status, and terminal result surfaces, then tears them down', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const entry = b.slots.entries('conversation.input.left')[0]!
    expect(entry.component).toBe(WorkflowPolicyDock)
    const injected = (entry.inject as unknown as (id: SessionId) => WorkflowPolicyDockInjected)(SID)
    expect(injected.sessionId).toBe(SID)
    await expect(injected.loadPolicy()).resolves.toEqual({ ok: true })
    expect(b.reliabilityPolicy.policy).toHaveBeenCalledWith({ sessionId: SID })
    const status = b.slots.entries('conversation.input.dock')[0]!
    expect(status.component).toBe(ReliabilityStatusDock)
    const statusInjected = (status.inject as unknown as (id: SessionId) => ReliabilityStatusDockInjected)(SID)
    const ref = { loopId: 'loop-1', revision: 1 } as never
    void statusInjected.details(ref)
    expect(b.reliabilityLoopRuntime.details).toHaveBeenCalledWith(SID, ref)
    const terminal = b.slots.entries('conversation.chat.node')[0]!
    expect(terminal.component).toBe(ReliabilityTerminalView)
    expect(b.registerDefinition).toHaveBeenCalledOnce()
    await fiber.dispose()
    expect(b.slots.entries('conversation.input.left')).toHaveLength(0)
    expect(b.slots.entries('conversation.input.dock')).toHaveLength(1)
    expect(b.slots.entries('conversation.chat.node')).toHaveLength(0)
  })
})
