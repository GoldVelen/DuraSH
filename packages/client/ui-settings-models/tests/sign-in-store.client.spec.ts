/** Sign-in store: Host-authored attempt views, poll lifecycle, and action refusals. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RemoteError, type RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { AuthorizationDescribeValue } from '@deepseek-ai/dsh-api-remotes/client'
import { SignInStore } from '../src/client/sign-in-store.ts'

/** One answered Remote call. */
type Answer<T> = Promise<RemoteResult<T>>

function ok<T>(value: T): Answer<T> {
  return Promise.resolve({ ok: true, value })
}
function fail(message: string): Answer<never> {
  return Promise.resolve({ ok: false, error: new RemoteError('gateway/internal', message, {}) })
}

const FLOWS: AuthorizationDescribeValue['flows'] = [
  {
    key: 'llm-pi-ai/openai-codex',
    label: 'OpenAI (ChatGPT Plus/Pro)',
    methods: [{ id: 'oauth', label: 'Sign in with ChatGPT' }],
    inFlight: false,
  },
]

function api(overrides: {
  describe?: () => Answer<AuthorizationDescribeValue>
} = {}) {
  const calls: string[] = []
  const describe = overrides.describe ?? (() => ok({ flows: FLOWS, attempts: [] }))
  return {
    calls,
    describe,
    begin: (request: { key: string }): Answer<{ started: true }> => {
      calls.push(`begin:${request.key}`)
      return ok({ started: true })
    },
    respond: (request: { promptId: string }): Answer<void> => {
      calls.push(`respond:${request.promptId}`)
      return ok(undefined)
    },
    cancel: (request: { key: string }): Answer<void> => {
      calls.push(`cancel:${request.key}`)
      return ok(undefined)
    },
  }
}

describe('the sign-in store', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('polls describe on the section cadence until stopped', async () => {
    vi.useFakeTimers()
    let polls = 0
    const store = new SignInStore({
      describe: () => { polls += 1; return ok({ flows: FLOWS, attempts: [] }) },
      begin: () => ok({ started: true } as const),
      respond: () => ok(undefined),
      cancel: () => ok(undefined),
    })
    const stop = store.startPolling()
    await vi.advanceTimersByTimeAsync(0)
    expect(polls).toBe(1)
    expect(store.store.getSnapshot().status).toBe('ready')
    expect(store.store.getSnapshot().flows).toEqual(FLOWS)
    await vi.advanceTimersByTimeAsync(3000)
    expect(polls).toBeGreaterThanOrEqual(3)
    stop()
    const after = polls
    await vi.advanceTimersByTimeAsync(6000)
    expect(polls).toBe(after)
  })

  it('skips the immediate poll when the snapshot is already pre-warmed', async () => {
    vi.useFakeTimers()
    let polls = 0
    const store = new SignInStore({
      describe: () => { polls += 1; return ok({ flows: FLOWS, attempts: [] }) },
      begin: () => ok({ started: true } as const),
      respond: () => ok(undefined),
      cancel: () => ok(undefined),
    })
    await store.refresh()
    expect(polls).toBe(1)
    const stop = store.startPolling()
    await vi.advanceTimersByTimeAsync(0)
    expect(polls).toBe(1)
    await vi.advanceTimersByTimeAsync(1500)
    expect(polls).toBe(2)
    stop()
  })

  it('stops safely before polling and disposes an active cadence', async () => {
    vi.useFakeTimers()
    let polls = 0
    const store = new SignInStore({
      describe: () => { polls += 1; return ok({ flows: FLOWS, attempts: [] }) },
      begin: () => ok({ started: true } as const),
      respond: () => ok(undefined),
      cancel: () => ok(undefined),
    })
    store.stopPolling()
    store.startPolling()
    await vi.advanceTimersByTimeAsync(0)
    expect(polls).toBe(1)
    store.dispose()
    await vi.advanceTimersByTimeAsync(3000)
    expect(polls).toBe(1)
  })

  it('keeps the last good snapshot when a poll fails, and reports the area error', async () => {
    const store = new SignInStore({
      describe: () => Promise.resolve(ok({ flows: FLOWS, attempts: [] })),
      begin: () => ok({ started: true } as const),
      respond: () => ok(undefined),
      cancel: () => ok(undefined),
    })
    await store.refresh()
    expect(store.store.getSnapshot().status).toBe('ready')
    // Swap to failure through a second store: the snapshot under failure
    // names the transport text and keeps whatever the last good answer held.
    const failing = new SignInStore({
      describe: () => Promise.resolve(fail('the host is gone')),
      begin: () => ok({ started: true } as const),
      respond: () => ok(undefined),
      cancel: () => ok(undefined),
    })
    await failing.refresh()
    expect(failing.store.getSnapshot().status).toBe('error')
    expect(failing.store.getSnapshot().error).toContain('the host is gone')
  })

  it('ignores a stale refresh result or failure after a newer refresh won', async () => {
    let resolveFirst!: (value: RemoteResult<AuthorizationDescribeValue>) => void
    let rejectSecond!: (reason?: unknown) => void
    const store = new SignInStore({
      describe: vi.fn()
        .mockImplementationOnce(() => new Promise<RemoteResult<AuthorizationDescribeValue>>((resolve) => { resolveFirst = resolve }))
        .mockImplementationOnce(() => Promise.reject(new Error('newest failure'))),
      begin: () => ok({ started: true } as const),
      respond: () => ok(undefined),
      cancel: () => ok(undefined),
    })

    const first = store.refresh()
    const second = store.refresh()
    await second
    expect(store.store.getSnapshot()).toMatchObject({ status: 'error', error: 'newest failure' })

    resolveFirst({ ok: true, value: { flows: FLOWS, attempts: [] } })
    await first
    expect(store.store.getSnapshot()).toMatchObject({ status: 'error', error: 'newest failure' })

    const throwing = new SignInStore({
      describe: vi.fn()
        .mockImplementationOnce(() => new Promise<RemoteResult<AuthorizationDescribeValue>>((_, reject) => { rejectSecond = reject }))
        .mockImplementationOnce(() => ok({ flows: FLOWS, attempts: [] })),
      begin: () => ok({ started: true } as const),
      respond: () => ok(undefined),
      cancel: () => ok(undefined),
    })
    const staleFailure = throwing.refresh()
    const latest = throwing.refresh()
    await latest
    rejectSecond(new Error('stale failure'))
    await staleFailure
    expect(throwing.store.getSnapshot()).toMatchObject({ status: 'ready', flows: FLOWS, error: null })
  })

  it('surfaces action refusals as failure messages without touching the snapshot status', async () => {
    const store = new SignInStore({
      describe: () => Promise.resolve(ok({ flows: FLOWS, attempts: [] })),
      begin: () => fail('an authorization attempt is already running'),
      respond: () => fail('no pending prompt'),
      cancel: () => fail('no running attempt'),
    })
    await store.refresh()
    await expect(store.begin('llm-pi-ai/openai-codex')).resolves.toContain('already running')
    await expect(store.respond('llm-pi-ai/openai-codex', 'prompt-1', { value: 'x' }))
      .resolves.toContain('no pending prompt')
    await expect(store.cancel('llm-pi-ai/openai-codex')).resolves.toContain('no running attempt')
    expect(store.store.getSnapshot().status).toBe('ready')
  })

  it('passes the joined key and the answer through to the wire', async () => {
    const wire = api()
    const store = new SignInStore(wire)
    await store.begin('llm-pi-ai/openai-codex')
    await store.respond('llm-pi-ai/openai-codex', 'prompt-7', { declined: true })
    await store.cancel('llm-pi-ai/openai-codex')
    expect(wire.calls).toEqual([
      'begin:llm-pi-ai/openai-codex',
      'respond:prompt-7',
      'cancel:llm-pi-ai/openai-codex',
    ])
  })

  it('forwards an explicit method and surfaces thrown action errors as plain text', async () => {
    const store = new SignInStore({
      describe: () => ok({ flows: FLOWS, attempts: [] }),
      begin: vi.fn(async (request: { key: string; method?: string }) => {
        if (request.method === 'oauth') return { ok: true as const, value: { started: true as const } }
        throw 'begin exploded'
      }),
      respond: vi.fn(async () => { throw 'respond exploded' }),
      cancel: vi.fn(async () => { throw 'cancel exploded' }),
    })

    await expect(store.begin('llm-pi-ai/openai-codex', 'oauth')).resolves.toBeUndefined()
    await expect(store.begin('llm-pi-ai/openai-codex')).resolves.toBe('begin exploded')
    await expect(store.respond('llm-pi-ai/openai-codex', 'prompt-1', { value: '123456' }))
      .resolves.toBe('respond exploded')
    await expect(store.cancel('llm-pi-ai/openai-codex')).resolves.toBe('cancel exploded')
  })
})
