import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import * as LlmPiAi from '../src/index.ts'
import { recordKeyFor } from '../src/auth.ts'

const cleanups: (() => Promise<unknown>)[] = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

/** Mount the Host adapter over isolated durable credentials. */
async function harness(providers: LlmPiAi.Config['providers'] = {}): Promise<Context> {
  vi.stubEnv('XAI_API_KEY', undefined)
  const dir = await mkdtemp(join(tmpdir(), 'dsh-xai-discovery-auth-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  const ctx = new Context()
  const llm = ctx.plugin(LlmRuntime)
  await llm
  cleanups.push(() => llm.dispose())
  const credentials = ctx.plugin(LocalCredentialProvider, { path: join(dir, '.credentials.yaml'), watch: false })
  await credentials
  cleanups.push(() => credentials.dispose())
  const adapter = ctx.plugin(LlmPiAi, { providers })
  await adapter
  cleanups.push(() => adapter.dispose())
  return ctx
}

/** Store one fake subscription grant without a login or network request. */
async function grant(ctx: Context, access: string, expires = Date.now() + 3_600_000, provider = 'xai'): Promise<void> {
  await ctx.credentials.modifyRecord(recordKeyFor(provider), async () => ({
    kind: 'grant', payload: { type: 'oauth', access, refresh: 'fixture-refresh', expires },
  }))
}

/** Only the two model-directory GETs are admitted by this external-service double. */
function listing() {
  const calls: { url: string; headers: Headers }[] = []
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    calls.push({ url, headers: new Headers(init?.headers) })
    expect(init?.method).toBe('GET')
    if (url.endsWith('/language-models')) return Response.json({ models: [{ id: 'grok-4.7', input_modalities: ['text', 'image'] }] })
    if (url.endsWith('/models')) return Response.json({ data: [{ id: 'grok-4.7', context_length: 500_000 }] })
    throw new Error(`unexpected request ${url}`)
  })
  vi.stubGlobal('fetch', fetch)
  return { calls, fetch }
}

describe('Host xAI discovery authentication', () => {
  it('uses subscription auth before a provider profile exists and reads a later login on the next refresh', async () => {
    const ctx = await harness()
    await grant(ctx, 'first-access')
    const { calls } = listing()
    const request = { provider: 'xai', refresh: true }
    await expect(ctx.llm.discoverModels('llm-pi-ai', request)).resolves.toEqual([
      { id: 'grok-4.7', name: 'grok-4.7', contextWindow: 500_000, inputModalities: ['text', 'image'] },
    ])
    expect(calls.map(call => call.headers.get('authorization'))).toEqual(['Bearer first-access', 'Bearer first-access'])
    await grant(ctx, 'later-access')
    await ctx.llm.discoverModels('llm-pi-ai', request)
    expect(calls.slice(2).map(call => call.headers.get('authorization'))).toEqual(['Bearer later-access', 'Bearer later-access'])
  })

  it('uses configured catalog identity, endpoint, headers and route-scoped subscription auth', async () => {
    const ctx = await harness({ 'xai-team': { catalogProvider: 'xai', baseURL: 'https://gateway.example/v1', headers: { 'x-team': 'configured' } } })
    await grant(ctx, 'route-access', undefined, 'xai-team')
    const { calls } = listing()
    await ctx.llm.discoverModels('llm-pi-ai', { provider: 'xai-team', refresh: true })
    expect(calls).toHaveLength(2)
    for (const call of calls) {
      expect(call.url).toMatch(/^https:\/\/gateway\.example\/v1\//)
      expect(call.headers.get('authorization')).toBe('Bearer route-access')
      expect(call.headers.get('x-team')).toBe('configured')
    }
  })

  it('uses explicit credential references ahead of OAuth and draft keys ahead of missing references', async () => {
    const ctx = await harness({ xai: { apiKeyEnv: 'XAI_DISCOVERY_FIXTURE_KEY' } })
    await grant(ctx, 'oauth-access')
    await ctx.credentials.set(credentialRef('XAI_DISCOVERY_FIXTURE_KEY'), 'reference-key')
    const { calls } = listing()
    await ctx.llm.discoverModels('llm-pi-ai', { provider: 'xai', refresh: true })
    expect(calls.map(call => call.headers.get('authorization'))).toEqual(['Bearer reference-key', 'Bearer reference-key'])
    await ctx.credentials.unset(credentialRef('XAI_DISCOVERY_FIXTURE_KEY'))
    await expect(ctx.llm.discoverModels('llm-pi-ai', { provider: 'xai', refresh: true })).rejects.toThrow(/no credential/)
    expect(calls).toHaveLength(2)
    await ctx.llm.discoverModels('llm-pi-ai', { provider: 'xai', refresh: true, apiKey: 'draft-key' })
    expect(calls.slice(2).map(call => call.headers.get('authorization'))).toEqual(['Bearer draft-key', 'Bearer draft-key'])
  })

  it('reports absent authentication before sending directory requests', async () => {
    const ctx = await harness()
    const { fetch } = listing()
    await expect(ctx.llm.discoverModels('llm-pi-ai', { provider: 'xai', refresh: true })).rejects.toThrow(/credential|sign.in|authentication/i)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('passes cancellation through native OAuth refresh without requesting a directory', async () => {
    const ctx = await harness()
    await grant(ctx, 'expired-access', Date.now() - 1000)
    let observedSignal: AbortSignal | undefined
    const entered = Promise.withResolvers<undefined>()
    const fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe('POST')
      const signal = init?.signal
      if (signal === undefined || signal === null) throw new Error('missing OAuth refresh cancellation')
      observedSignal = signal
      entered.resolve(undefined)
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => { reject(new DOMException('refresh cancelled', 'AbortError')) }, { once: true })
      })
    })
    vi.stubGlobal('fetch', fetch)
    const controller = new AbortController()
    const discovery = ctx.llm.discoverModels('llm-pi-ai', { provider: 'xai', refresh: true }, controller.signal)
    const rejected = expect(discovery).rejects.toThrow()
    await entered.promise
    controller.abort()
    await rejected
    expect(observedSignal?.aborted).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
