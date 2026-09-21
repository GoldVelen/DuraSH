/**
 * ui-reliability browser half on a real SlotRegistry: the plugin occupies
 * conversation.input.left with the workflow chip.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { MutableSessionEventSource } from '@deepseek-ai/dsh-api-session-controller/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { WorkflowPolicyDock } from '../src/client/WorkflowPolicyDock.tsx'
import type { WorkflowPolicyDockInjected } from '../src/client/index.ts'
import { apply, inject } from '../src/client/index.ts'
import { apply as nodeApply } from '../src/index.ts'

// The generated Remote descriptor belongs to the artifact lane; this source-only
// suite owns its mount lifecycle and supplies the same explicit Remote test double.
vi.mock('@durash/dsh-reliability-policy/remote', () => ({
  default: { package: '@durash/dsh-reliability-policy' },
}))

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
  const eventSource = new MutableSessionEventSource()
  ctx.provide('sessions', { binding: () => ({ eventSource }) })
  const reliabilityPolicy = {
    acceptance: vi.fn(() => Promise.resolve({ ok: true, value: null })),
    policy: vi.fn(() => Promise.resolve({ ok: true, value: SNAPSHOT })),
    ensurePolicy: vi.fn(() => Promise.resolve({ ok: true, value: SNAPSHOT })),
    configure: vi.fn(() => Promise.resolve({ ok: true, value: { ...SNAPSHOT, enabled: true } })),
  }
  let mounted = false
  const disposeMount = vi.fn(async () => { mounted = false })
  const mount = vi.fn(async () => {
    if (mounted) throw new Error('duplicate reliabilityPolicy remote')
    mounted = true
    return disposeMount
  })
  ctx.provide('remote', { reliabilityPolicy, $mount: mount })
  ctx.provide('remote.reliabilityPolicy', reliabilityPolicy)
  ctx.provide('locale', new LocaleRuntime(ctx))
  return { ctx, slots, reliabilityPolicy, mount, disposeMount, eventSource }
}

describe('ui-reliability browser apply', () => {
  it('declares every service it binds', () => {
    expect(inject).toEqual(['slots', 'remote', 'locale'])
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
    expect(injected.readPolicy().status).toBe('cold')
    await expect(injected.loadPolicy()).resolves.toEqual({ ok: true })
    expect(b.reliabilityPolicy.policy).toHaveBeenCalledWith({ sessionId: SID })
    expect(b.reliabilityPolicy.acceptance).toHaveBeenCalledWith({ sessionId: SID })
    b.eventSource.append({ type: 'event', event: { type: 'turn/end' } } as never)
    await vi.waitFor(() => { expect(b.reliabilityPolicy.acceptance).toHaveBeenCalledTimes(2) })
    await expect(injected.ensurePolicy()).resolves.toEqual({ ok: true })
    expect(b.reliabilityPolicy.ensurePolicy).toHaveBeenCalledWith({ sessionId: SID })
    await expect(injected.configure({
      sessionId: SID,
      enabled: false,
      implementationModel: SNAPSHOT.implementationModel,
      implementationThinking: SNAPSHOT.implementationThinking,
      reviewModel: SNAPSHOT.reviewModel,
      reviewThinking: SNAPSHOT.reviewThinking,
    })).resolves.toEqual({ ok: true })
    expect(b.reliabilityPolicy.configure).toHaveBeenCalled()
    expect(b.mount).toHaveBeenCalledOnce()
    expect(b.mount).toHaveBeenCalledWith(expect.objectContaining({ package: '@durash/dsh-reliability-policy' }))
    await fiber.dispose()
    expect(b.slots.entries('conversation.input.left')).toHaveLength(0)
    expect(b.disposeMount).toHaveBeenCalledOnce()
  })

  it('unmounts the Remote contribution when later Client registration fails', async () => {
    const b = await bench()
    vi.spyOn(b.slots, 'inject').mockImplementationOnce(() => { throw new Error('slot registration failed') })
    await expect(apply(b.ctx)).rejects.toThrow(/slot registration failed/)
    expect(b.mount).toHaveBeenCalledOnce()
    expect(b.disposeMount).toHaveBeenCalledOnce()
  })

  it('remounts after dispose instead of registering the namespace twice', async () => {
    const b = await bench()
    const first = b.ctx.plugin({ inject: [...inject], apply })
    await first.await()
    await first.dispose()
    const second = b.ctx.plugin({ inject: [...inject], apply })
    await second.await()
    expect(b.mount).toHaveBeenCalledTimes(2)
    expect(b.disposeMount).toHaveBeenCalledOnce()
    await second.dispose()
    expect(b.disposeMount).toHaveBeenCalledTimes(2)
  })
})
