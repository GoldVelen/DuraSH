import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import {
  ReliabilityPolicyController,
  type ReliabilityPolicyRemote,
} from '../src/client/controller.ts'
import type {
  ReliabilityPolicyConfigureRequest, ReliabilityPolicySnapshot,
} from '@durash/dsh-reliability-policy/client'

const SID = 's-ctrl' as SessionId
const OTHER = 's-other' as SessionId

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

function configureRequest(over: Partial<ReliabilityPolicyConfigureRequest> = {}): ReliabilityPolicyConfigureRequest {
  return {
    sessionId: SID,
    enabled: true,
    implementationModel: 'deepseek-official/deepseek-v4-pro',
    implementationThinking: 'high',
    reviewModel: 'deepseek-official/deepseek-v4-flash',
    reviewThinking: 'xhigh',
    ...over,
  }
}

function fakeRemote(over: Partial<ReliabilityPolicyRemote> = {}) {
  const policy = vi.fn(over.policy ?? (() => Promise.resolve({ ok: true as const, value: snapshot() })))
  const ensurePolicy = vi.fn(over.ensurePolicy ?? (() => Promise.resolve({ ok: true as const, value: snapshot() })))
  const configure = vi.fn(over.configure ?? (() => Promise.resolve({ ok: true as const, value: snapshot() })))
  return { remote: { policy, ensurePolicy, configure }, policy, ensurePolicy, configure }
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

  it('shares an in-flight load, publishes once per subscriber, and reuses a ready snapshot', async () => {
    const pending = Promise.withResolvers<Awaited<ReturnType<ReliabilityPolicyRemote['policy']>>>()
    const fake = fakeRemote({ policy: () => pending.promise })
    const controller = new ReliabilityPolicyController(fake.remote)
    expect(controller.sessionState(SID)).toMatchObject({ status: 'cold', policy: { sessionId: SID } })
    expect(controller.thinkingLevels(null)).toEqual([])
    expect(controller.thinkingLevels('missing/model')).toEqual([])

    controller.subscribe(() => { throw new Error('broken subscriber') })
    const listener = vi.fn()
    const unsubscribe = controller.subscribe(listener)
    const first = controller.loadPolicy(SID)
    const second = controller.loadPolicy(SID)
    expect(controller.sessionState(SID).status).toBe('loading')
    expect(fake.policy).toHaveBeenCalledOnce()
    pending.resolve({ ok: true, value: snapshot({ models: [{
      selector: 'deepseek-official/deepseek-v4-pro',
      label: 'DeepSeek V4 Pro',
      provider: 'deepseek-official',
      model: 'deepseek-v4-pro',
      badges: [],
      thinkingLevels: ['high', 'xhigh'],
    }] }) })
    await expect(Promise.all([first, second])).resolves.toEqual([{ ok: true }, { ok: true }])
    expect(controller.thinkingLevels('deepseek-official/deepseek-v4-pro')).toEqual(['high', 'xhigh'])
    expect(controller.thinkingLevels('still-missing/model')).toEqual([])
    expect(controller.getSnapshot().sessions.get(SID)?.status).toBe('ready')
    expect(listener).toHaveBeenCalled()
    const calls = listener.mock.calls.length
    await expect(controller.loadPolicy(SID)).resolves.toEqual({ ok: true })
    expect(fake.policy).toHaveBeenCalledOnce()
    unsubscribe()
    await controller.configure(configureRequest({ enabled: false }))
    expect(listener).toHaveBeenCalledTimes(calls)
  })

  it('publishes carrier, session-mismatch, and transport read failures', async () => {
    const fake = fakeRemote({
      policy: async ({ sessionId }) => {
        if (sessionId === SID) {
          return { ok: false as const, error: new RemoteError('gateway/internal', 'host refused read', {}) }
        }
        if (sessionId === OTHER) {
          return { ok: true as const, value: snapshot({ sessionId: SID }) }
        }
        if (String(sessionId) === 's-error') throw new Error('network read failed')
        const failure: unknown = 'non-error read failure'
        throw failure
      },
    })
    const controller = new ReliabilityPolicyController(fake.remote)
    await expect(controller.loadPolicy(SID)).resolves.toMatchObject({ ok: false, error: { message: 'host refused read' } })
    expect(controller.sessionState(SID)).toMatchObject({ status: 'error', error: 'host refused read' })
    await expect(controller.loadPolicy(OTHER)).resolves.toMatchObject({
      ok: false, error: { code: 'reliability_policy_session_mismatch' },
    })
    const errorSession = 's-error' as SessionId
    await expect(controller.loadPolicy(errorSession)).resolves.toMatchObject({
      ok: false, error: { code: 'transport', message: 'network read failed' },
    })
    const fallbackSession = 's-fallback' as SessionId
    await expect(controller.loadPolicy(fallbackSession)).resolves.toMatchObject({
      ok: false, error: { code: 'transport', message: 'Workflow policy read failed' },
    })
  })

  it('shares ensures and skips the Host when a complete catalog is already ready', async () => {
    const ensured = Promise.withResolvers<Awaited<ReturnType<ReliabilityPolicyRemote['ensurePolicy']>>>()
    const fake = fakeRemote({
      policy: () => Promise.resolve({ ok: true, value: snapshot({ models: [{
        selector: 'deepseek-official/deepseek-v4-pro',
        label: 'DeepSeek V4 Pro',
        provider: 'deepseek-official',
        model: 'deepseek-v4-pro',
        badges: [],
        thinkingLevels: ['high'],
      }] }) }),
      ensurePolicy: () => ensured.promise,
    })
    const controller = new ReliabilityPolicyController(fake.remote)
    await controller.loadPolicy(SID)
    await expect(controller.ensurePolicy(SID)).resolves.toEqual({ ok: true })
    expect(fake.ensurePolicy).not.toHaveBeenCalled()

    const first = controller.ensurePolicy(OTHER)
    const second = controller.ensurePolicy(OTHER)
    expect(fake.ensurePolicy).toHaveBeenCalledOnce()
    ensured.resolve({ ok: true, value: snapshot({ sessionId: OTHER }) })
    await expect(Promise.all([first, second])).resolves.toEqual([{ ok: true }, { ok: true }])
  })

  it('validates every enablement field and permits an incomplete disabled policy', async () => {
    const fake = fakeRemote()
    const controller = new ReliabilityPolicyController(fake.remote)
    const incomplete = [
      { implementationModel: null },
      { implementationThinking: null },
      { reviewModel: null },
      { reviewThinking: null },
    ] satisfies Array<Partial<ReliabilityPolicyConfigureRequest>>
    for (const fields of incomplete) {
      await expect(controller.configure(configureRequest(fields))).resolves.toMatchObject({
        ok: false, error: { code: 'reliability_policy_incomplete' },
      })
    }
    expect(fake.configure).not.toHaveBeenCalled()

    await expect(controller.configure(configureRequest({
      enabled: false,
      implementationModel: null,
      implementationThinking: null,
      reviewModel: null,
      reviewThinking: null,
    }))).resolves.toEqual({ ok: true })
    expect(fake.configure).toHaveBeenCalledOnce()
  })

  it('does not publish a local validation failure after a subscriber disposes reentrantly', async () => {
    const fake = fakeRemote()
    const controller = new ReliabilityPolicyController(fake.remote)
    controller.subscribe(() => { controller.dispose() })

    await expect(controller.configure(configureRequest({ implementationModel: null }))).resolves.toMatchObject({
      ok: false, error: { code: 'reliability_policy_incomplete' },
    })
    expect(controller.sessionState(SID).status).toBe('configuring')
    expect(fake.configure).not.toHaveBeenCalled()
  })

  it('shares configuration and preserves newer cached revisions', async () => {
    const configured = Promise.withResolvers<Awaited<ReturnType<ReliabilityPolicyRemote['configure']>>>()
    const fake = fakeRemote({
      policy: () => Promise.resolve({ ok: true, value: snapshot({ revision: 5, updatedAt: 10 }) }),
      configure: () => configured.promise,
    })
    const controller = new ReliabilityPolicyController(fake.remote)
    await controller.loadPolicy(SID)
    const first = controller.configure(configureRequest())
    const second = controller.configure(configureRequest({ enabled: false }))
    expect(fake.configure).toHaveBeenCalledOnce()
    configured.resolve({ ok: true, value: snapshot({ revision: 4, updatedAt: 20 }) })
    await expect(Promise.all([first, second])).resolves.toEqual([{ ok: true }, { ok: true }])
    expect(controller.sessionState(SID)).toMatchObject({
      status: 'ready', policy: { revision: 5, updatedAt: 10 },
    })

    fake.configure.mockResolvedValueOnce({ ok: true, value: snapshot({ revision: 5, updatedAt: 9 }) })
    await controller.configure(configureRequest())
    expect(controller.sessionState(SID).policy.updatedAt).toBe(10)
    fake.configure.mockResolvedValueOnce({ ok: true, value: snapshot({ revision: 6, updatedAt: 1 }) })
    await controller.configure(configureRequest())
    expect(controller.sessionState(SID).policy.revision).toBe(6)
  })

  it('publishes configure carrier, mismatch, and transport failures', async () => {
    const fake = fakeRemote({
      configure: async (request) => {
        if (request.sessionId === SID) {
          return { ok: false as const, error: new RemoteError('gateway/internal', 'host refused update', {}) }
        }
        if (request.sessionId === OTHER) {
          return { ok: true as const, value: snapshot({ sessionId: SID }) }
        }
        if (String(request.sessionId) === 's-error') throw new Error('network update failed')
        const failure: unknown = 'non-error update failure'
        throw failure
      },
    })
    const controller = new ReliabilityPolicyController(fake.remote)
    await expect(controller.configure(configureRequest())).resolves.toMatchObject({
      ok: false, error: { message: 'host refused update' },
    })
    await expect(controller.configure(configureRequest({ sessionId: OTHER }))).resolves.toMatchObject({
      ok: false, error: { code: 'reliability_policy_session_mismatch' },
    })
    await expect(controller.configure(configureRequest({ sessionId: 's-error' as SessionId }))).resolves.toMatchObject({
      ok: false, error: { code: 'transport', message: 'network update failed' },
    })
    await expect(controller.configure(configureRequest({ sessionId: 's-fallback' as SessionId }))).resolves.toMatchObject({
      ok: false, error: { code: 'transport', message: 'Workflow policy update failed' },
    })
  })

  it('ignores late reads and writes and rejects every action after disposal', async () => {
    const read = Promise.withResolvers<Awaited<ReturnType<ReliabilityPolicyRemote['policy']>>>()
    const fake = fakeRemote({ policy: () => read.promise })
    const controller = new ReliabilityPolicyController(fake.remote)
    const loading = controller.loadPolicy(SID)
    const listener = vi.fn()
    controller.subscribe(listener)
    controller.dispose()
    read.resolve({ ok: true, value: snapshot() })
    await expect(loading).resolves.toEqual({ ok: true })
    expect(controller.sessionState(SID).status).toBe('loading')
    expect(listener).not.toHaveBeenCalled()

    const failedRead = Promise.withResolvers<Awaited<ReturnType<ReliabilityPolicyRemote['policy']>>>()
    const failingReader = new ReliabilityPolicyController(fakeRemote({ policy: () => failedRead.promise }).remote)
    const lateReadFailure = failingReader.loadPolicy(SID)
    failingReader.dispose()
    failedRead.reject(new Error('late read failure'))
    await expect(lateReadFailure).resolves.toMatchObject({ ok: false, error: { message: 'late read failure' } })
    expect(failingReader.sessionState(SID).status).toBe('loading')

    expect(await controller.loadPolicy(SID)).toMatchObject({ ok: false, error: { code: 'disposed' } })
    expect(await controller.ensurePolicy(SID)).toMatchObject({ ok: false, error: { code: 'disposed' } })
    expect(await controller.configure(configureRequest())).toMatchObject({ ok: false, error: { code: 'disposed' } })
    expect(() => {
      controller.subscribe(() => {})()
    }).not.toThrow()

    const write = Promise.withResolvers<Awaited<ReturnType<ReliabilityPolicyRemote['configure']>>>()
    const writeFake = fakeRemote({ configure: () => write.promise })
    const writing = new ReliabilityPolicyController(writeFake.remote)
    const pendingWrite = writing.configure(configureRequest())
    writing.dispose()
    write.resolve({ ok: true, value: snapshot({ enabled: true }) })
    await expect(pendingWrite).resolves.toEqual({ ok: true })
    expect(writing.sessionState(SID).status).toBe('configuring')

    const failedWrite = Promise.withResolvers<Awaited<ReturnType<ReliabilityPolicyRemote['configure']>>>()
    const failingWriter = new ReliabilityPolicyController(fakeRemote({ configure: () => failedWrite.promise }).remote)
    const lateWriteFailure = failingWriter.configure(configureRequest())
    failingWriter.dispose()
    failedWrite.reject(new Error('late write failure'))
    await expect(lateWriteFailure).resolves.toMatchObject({ ok: false, error: { message: 'late write failure' } })
    expect(failingWriter.sessionState(SID).status).toBe('configuring')
  })

})
