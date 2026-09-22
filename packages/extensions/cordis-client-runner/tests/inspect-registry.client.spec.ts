import { describe, expect, it, vi } from 'vitest'
import type { CordisInspectQueryRequest, CordisInspectRequestId, SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import {
  ClientCordisInspectRegistry,
  type ClientCordisInspectHost,
  type ClientCordisInspectProviderRegistration,
} from '../src/client/inspect-registry.ts'

const request: CordisInspectQueryRequest = {
  agentId: 'session' as SessionId,
  requestId: 'query' as CordisInspectRequestId,
  provider: 'fixture',
  method: 'read',
}

function provider(query: ClientCordisInspectProviderRegistration['query'] = async () => null): ClientCordisInspectProviderRegistration {
  return {
    manifest: {
      id: 'fixture', description: 'Fixture provider',
      methods: [{ name: 'read', description: 'Read', inputSchema: {}, outputSchema: {} }],
    },
    query,
  }
}

function host() {
  return {
    sync: vi.fn<ClientCordisInspectHost['sync']>(async () => {}),
    resolve: vi.fn<ClientCordisInspectHost['resolve']>(async () => {}),
  }
}

describe('Client inspect registry lifetime', () => {
  it('drops a queued publication and refuses work after disposal', async () => {
    const remote = host()
    const registry = new ClientCordisInspectRegistry(remote)
    const query = vi.fn(async () => null)
    const remove = registry.register(provider(query))
    await registry.dispose()
    remove()
    registry.publish()
    await registry.query(request)
    await registry.dispose()
    expect(remote.sync).not.toHaveBeenCalled()
    expect(remote.resolve).not.toHaveBeenCalled()
    expect(query).not.toHaveBeenCalled()
    expect(() => registry.register(provider())).toThrow()
  })

  it('drains an in-flight sync and drops serialized publications', async () => {
    const started = Promise.withResolvers<undefined>()
    const finish = Promise.withResolvers<undefined>()
    const remote = host()
    remote.sync = vi.fn<ClientCordisInspectHost['sync']>(async () => {
      started.resolve(undefined)
      await finish.promise
    })
    const registry = new ClientCordisInspectRegistry(remote)
    const remove = registry.register(provider())
    await started.promise
    remove()
    // Queue the second manifest behind the blocked first RPC.
    await Promise.resolve()
    let disposed = false
    const disposing = registry.dispose().then(() => { disposed = true })
    await Promise.resolve()
    expect(disposed).toBe(false)
    finish.resolve(undefined)
    await disposing
    expect(remote.sync).toHaveBeenCalledTimes(1)
  })

  it('cancels a provider query and awaits its cleanup without sending a result', async () => {
    const started = Promise.withResolvers<AbortSignal>()
    const finish = Promise.withResolvers<undefined>()
    const remote = host()
    const registry = new ClientCordisInspectRegistry(remote)
    registry.register(provider(async (_method, _input, context) => {
      started.resolve(context.signal)
      await finish.promise
      return 'late result'
    }))
    const querying = registry.query(request)
    const signal = await started.promise
    await registry.query(request)
    let disposed = false
    const disposing = registry.dispose().then(() => { disposed = true })
    expect(signal.aborted).toBe(true)
    await Promise.resolve()
    expect(disposed).toBe(false)
    finish.resolve(undefined)
    await Promise.all([querying, disposing])
    expect(remote.resolve).not.toHaveBeenCalled()
  })

  it('does not start a query cancelled before provider dispatch', async () => {
    const remote = host()
    const registry = new ClientCordisInspectRegistry(remote)
    const query = vi.fn(async () => null)
    registry.register(provider(query))
    const querying = registry.query(request)
    registry.close(request.requestId)
    await querying
    await registry.dispose()
    expect(query).not.toHaveBeenCalled()
    expect(remote.resolve).not.toHaveBeenCalled()
  })

  it('drains an already-dispatched result RPC before disposal finishes', async () => {
    const started = Promise.withResolvers<undefined>()
    const finish = Promise.withResolvers<undefined>()
    const remote = host()
    remote.resolve = vi.fn<ClientCordisInspectHost['resolve']>(async () => {
      started.resolve(undefined)
      await finish.promise
    })
    const registry = new ClientCordisInspectRegistry(remote)
    registry.register(provider())
    const querying = registry.query(request)
    await started.promise
    let disposed = false
    const disposing = registry.dispose().then(() => { disposed = true })
    await Promise.resolve()
    expect(disposed).toBe(false)
    finish.resolve(undefined)
    await Promise.all([querying, disposing])
    expect(remote.resolve).toHaveBeenCalledTimes(1)
  })

  it('reports live publication failures and can publish again', async () => {
    const error = new Error('Host rejected manifest')
    const failed = Promise.withResolvers<undefined>()
    const synced = Promise.withResolvers<undefined>()
    const logged = vi.spyOn(console, 'error').mockImplementation(() => { failed.resolve(undefined) })
    const remote = host()
    remote.sync = vi.fn<ClientCordisInspectHost['sync']>().mockRejectedValueOnce(error).mockImplementation(async () => { synced.resolve(undefined) })
    const registry = new ClientCordisInspectRegistry(remote)
    try {
      registry.register(provider())
      await failed.promise
      expect(logged).toHaveBeenCalledWith('[cordis-client-runner] syncing inspect providers failed:', error)
      registry.publish()
      await synced.promise
      expect(remote.sync).toHaveBeenCalledTimes(2)
    } finally {
      await registry.dispose()
      logged.mockRestore()
    }
  })

  it('keeps a live result RPC failure observable to its caller', async () => {
    const error = new Error('Host rejected result')
    const remote = host()
    remote.resolve = vi.fn<ClientCordisInspectHost['resolve']>(async () => { throw error })
    const registry = new ClientCordisInspectRegistry(remote)
    registry.register(provider())
    await expect(registry.query(request)).rejects.toBe(error)
    await registry.dispose()
  })
})
