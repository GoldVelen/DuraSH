import type { Api, Model } from '@earendil-works/pi-ai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LiveCatalogSync } from '../src/live-catalog-sync.ts'

interface Deferred<T> {
  readonly promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
}

/** A controlled transport completion, independent of its abort signal. */
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

interface Request {
  readonly provider: string
  readonly signal: AbortSignal
  readonly completion: Deferred<readonly Model<Api>[]>
}

const syncs: LiveCatalogSync[] = []
const requests: Request[] = []

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})

afterEach(async () => {
  for (const request of requests.splice(0)) request.completion.resolve([])
  await Promise.all(syncs.splice(0).map(sync => sync.close()))
  vi.useRealTimers()
})

/** Fixture-only native model metadata. */
function model(id: string): Model<Api> {
  return {
    id, name: id, provider: 'fixture', api: 'openai-responses', baseUrl: 'https://fixture.test/v1',
    reasoning: false, input: ['text'], contextWindow: 4096, maxTokens: 512,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  }
}

/** A transport whose requests expose both entry and completion barriers. */
function fixture(timeoutMs: () => number = () => 100) {
  const available: Request[] = []
  const waiters: Deferred<Request>[] = []
  let providers = ['account-a']
  let refreshMs = 1000
  const fetch = vi.fn((provider: string, signal: AbortSignal) => {
    const request: Request = { provider, signal, completion: deferred() }
    requests.push(request)
    const waiter = waiters.shift()
    if (waiter === undefined) available.push(request)
    else waiter.resolve(request)
    return request.completion.promise
  })
  const publish = vi.fn<(provider: string, models: readonly Model<Api>[]) => void>()
  const failure = vi.fn<(provider: string, error: unknown) => void>()
  const sync = new LiveCatalogSync({
    providers: () => providers,
    timeoutMs,
    refreshMs: () => refreshMs,
    fetch, publish, failure,
  })
  syncs.push(sync)
  return {
    sync, fetch, publish, failure,
    setProviders(value: string[]): void { providers = value },
    setRefreshMs(value: number): void { refreshMs = value },
    nextRequest(): Promise<Request> {
      const request = available.shift()
      if (request !== undefined) return Promise.resolve(request)
      const waiter = deferred<Request>()
      waiters.push(waiter)
      return waiter.promise
    },
  }
}

describe('live catalog refresh coordination', () => {
  it('coalesces concurrent callers for one provider and publishes once', async () => {
    const f = fixture()
    const first = f.sync.refresh('account-a')
    const second = f.sync.refresh('account-a')
    expect(second).toBe(first)
    const request = await f.nextRequest()
    const models = [model('online-next')]
    request.completion.resolve(models)

    expect(await first).toBe(models)
    expect(await second).toBe(models)
    expect(f.fetch).toHaveBeenCalledTimes(1)
    expect(f.publish).toHaveBeenCalledExactlyOnceWith('account-a', models)
    expect(f.failure).not.toHaveBeenCalled()
  })

  it('refreshes separate account routes independently', async () => {
    const f = fixture()
    const first = f.sync.refresh('account-a')
    const second = f.sync.refresh('account-b')
    const a = await f.nextRequest()
    const b = await f.nextRequest()
    expect([a.provider, b.provider]).toEqual(['account-a', 'account-b'])
    a.completion.resolve([model('a-model')])
    b.completion.resolve([model('b-model')])
    await Promise.all([first, second])
    expect(f.publish).toHaveBeenCalledTimes(2)
  })

  it('cancels only a caller’s wait while another caller receives the shared refresh', async () => {
    const f = fixture()
    const caller = new AbortController()
    const cancelled = f.sync.refresh('account-a', caller.signal)
    const shared = f.sync.refresh('account-a')
    const request = await f.nextRequest()
    const reason = new Error('fixture caller cancelled')
    caller.abort(reason)
    await expect(cancelled).rejects.toBe(reason)
    expect(request.signal.aborted).toBe(false)
    const models = [model('rotated-account-model')]
    request.completion.resolve(models)
    expect(await shared).toBe(models)
    expect(f.publish).toHaveBeenCalledExactlyOnceWith('account-a', models)
    expect(f.failure).not.toHaveBeenCalled()
  })

  it('does not start a request for an already cancelled caller', async () => {
    const f = fixture()
    const caller = new AbortController()
    const reason = new Error('fixture caller already cancelled')
    caller.abort(reason)
    await expect(f.sync.refresh('account-a', caller.signal)).rejects.toBe(reason)
    expect(f.fetch).not.toHaveBeenCalled()
  })

  it('does not expose an opaque caller cancellation reason while the shared fetch continues', async () => {
    const f = fixture()
    const caller = new AbortController()
    const waiting = f.sync.refresh('account-a', caller.signal)
    const request = await f.nextRequest()
    caller.abort({ token: 'fixture-secret' })
    await expect(waiting).rejects.toThrow('model catalog wait aborted')
    expect(request.signal.aborted).toBe(false)
    request.completion.resolve([])
    await f.sync.refresh('account-a')
    expect(f.failure).not.toHaveBeenCalled()
  })

  it('observes caller cancellation during request setup before attaching its wait', async () => {
    const caller = new AbortController()
    const f = fixture(() => {
      caller.abort('fixture setup cancelled')
      return 100
    })
    await expect(f.sync.refresh('account-a', caller.signal)).rejects.toThrow('model catalog wait aborted')
    const request = await f.nextRequest()
    expect(request.signal.aborted).toBe(false)
    request.completion.resolve([])
    await f.sync.refresh('account-a')
    expect(f.fetch).toHaveBeenCalledTimes(1)
  })

  it('contains a non-Error transport rejection without publishing or exposing its payload', async () => {
    const f = fixture()
    const result = f.sync.refresh('account-a')
    const request = await f.nextRequest()
    request.completion.reject({ token: 'fixture-secret' })
    await expect(result).rejects.toThrow('model catalog request failed')
    expect(f.failure).toHaveBeenCalledExactlyOnceWith('account-a', expect.objectContaining({ message: 'model catalog request failed' }))
    expect(f.publish).not.toHaveBeenCalled()
  })

  it('replaces an invalidated source and discards its late successful response', async () => {
    const f = fixture()
    const obsolete = f.sync.refresh('account-a')
    const obsoleteRejected = expect(obsolete).rejects.toThrow('model catalog source changed')
    const oldRequest = await f.nextRequest()
    f.sync.invalidate('account-a')
    const newRequest = await f.nextRequest()
    const current = f.sync.refresh('account-a')
    expect(oldRequest.signal.aborted).toBe(true)
    expect(newRequest.signal.aborted).toBe(false)
    newRequest.completion.resolve([model('new-source-model')])
    await current
    oldRequest.completion.resolve([model('old-source-model')])
    await obsoleteRejected
    await f.sync.close()

    expect(f.fetch).toHaveBeenCalledTimes(2)
    expect(f.publish).toHaveBeenCalledExactlyOnceWith('account-a', [model('new-source-model')])
    expect(f.failure).not.toHaveBeenCalled()
  })

  it('reports a shared deadline promptly and prevents an ignoring transport from publishing late', async () => {
    const f = fixture()
    const result = f.sync.refresh('account-a')
    const rejected = expect(result).rejects.toMatchObject({ name: 'TimeoutReason', code: 'MODEL_CATALOG_TIMEOUT' })
    const request = await f.nextRequest()
    await vi.advanceTimersByTimeAsync(100)
    await rejected
    expect(request.signal.aborted).toBe(true)
    expect(f.failure).toHaveBeenCalledExactlyOnceWith('account-a', expect.objectContaining({ code: 'MODEL_CATALOG_TIMEOUT' }))
    expect(f.publish).not.toHaveBeenCalled()

    const retry = f.sync.refresh('account-a')
    const next = await f.nextRequest()
    next.completion.resolve([model('retry-model')])
    await retry
    request.completion.resolve([model('timed-out-model')])
    await f.sync.close()
    expect(f.publish).toHaveBeenCalledExactlyOnceWith('account-a', [model('retry-model')])
  })

  it('contains diagnostic observer errors and returns the original refresh failure', async () => {
    const f = fixture()
    f.failure.mockImplementation(() => { throw new Error('fixture diagnostic observer failed') })
    const result = f.sync.refresh('account-a')
    const request = await f.nextRequest()
    const error = new Error('fixture directory refused')
    request.completion.reject(error)
    await expect(result).rejects.toBe(error)
    expect(f.failure).toHaveBeenCalledExactlyOnceWith('account-a', error)
    expect(f.publish).not.toHaveBeenCalled()
  })
})

describe('live catalog lifecycle', () => {
  it('closes before a queued notification starts any fetch', async () => {
    const f = fixture()
    f.sync.notify()
    await f.sync.close()
    expect(f.fetch).not.toHaveBeenCalled()
    expect(f.publish).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('coalesces startup notifications and reads the latest interval and configured routes', async () => {
    const f = fixture()
    f.sync.start()
    f.sync.start()
    f.sync.notify()
    const initial = await f.nextRequest()
    const first = f.sync.refresh('account-a')
    initial.completion.resolve([])
    await first
    expect(f.fetch).toHaveBeenCalledTimes(1)

    f.setRefreshMs(200)
    f.sync.notify()
    const notified = await f.nextRequest()
    const second = f.sync.refresh('account-a')
    notified.completion.resolve([])
    await second
    f.setProviders(['account-b'])
    await vi.advanceTimersByTimeAsync(100)
    expect(f.fetch).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(100)
    const periodic = await f.nextRequest()
    expect(periodic.provider).toBe('account-b')
    periodic.completion.resolve([])
    await f.sync.close()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not fetch a route removed before a queued notification runs', async () => {
    const f = fixture()
    f.sync.notify()
    f.setProviders([])
    await Promise.resolve()
    expect(f.fetch).not.toHaveBeenCalled()
  })

  it('waits for underlying fetch settlement during close and keeps late callbacks silent', async () => {
    const f = fixture()
    f.sync.start()
    const request = await f.nextRequest()
    const result = f.sync.refresh('account-a')
    let closed = false
    const closing = f.sync.close()
    void closing.then(() => { closed = true })
    expect(f.sync.close()).toBe(closing)
    await expect(result).rejects.toThrow('live model catalog sync closed')
    expect(request.signal.aborted).toBe(true)
    expect(closed).toBe(false)
    request.completion.resolve([model('late-after-close')])
    await closing
    expect(closed).toBe(true)
    expect(f.publish).not.toHaveBeenCalled()
    expect(f.failure).not.toHaveBeenCalled()

    f.sync.notify()
    f.sync.invalidate('account-a')
    f.sync.start()
    await expect(f.sync.refresh('account-a')).rejects.toThrow('live model catalog sync is closed')
    await vi.advanceTimersByTimeAsync(1000)
    expect(f.fetch).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})
