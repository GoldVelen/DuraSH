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

  it('surfaces action refusals as failure messages without touching the snapshot status', async () => {
    const store = new SignInStore({
      describe: () => Promise.resolve(ok({ flows: FLOWS, attempts: [] })),
      begin: () => fail('an authorization attempt is already running'),
      respond: () => fail('no pending prompt'),
      cancel: () => ok(undefined),
    })
    await store.refresh()
    await expect(store.begin('llm-pi-ai/openai-codex')).resolves.toContain('already running')
    await expect(store.respond('llm-pi-ai/openai-codex', 'prompt-1', { value: 'x' }))
      .resolves.toContain('no pending prompt')
    await expect(store.cancel('llm-pi-ai/openai-codex')).resolves.toBeUndefined()
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
})
