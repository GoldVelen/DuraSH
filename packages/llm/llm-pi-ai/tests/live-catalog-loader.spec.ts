/** Account-bound Go catalogs through the source Loader, durable credentials, and Host discovery. */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AuthorizationService from '@deepseek-ai/dsh-authorization'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialRecord } from '@deepseek-ai/dsh-credentials'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import FileSettingsProvider from '@deepseek-ai/dsh-settings-file'
import { recordKeyFor } from '../src/auth.ts'
import { catalogProvider } from '../src/catalog.ts'
import { openCodeGoOAuth } from '../src/opencode-go.ts'

const CONFIG_URL = 'https://opencode.ai/console/api/v2/config'
const METADATA_URL = 'https://models.dev/api.json'
const REF = credentialRef('DSH_LIVE_CATALOG_KEY')
const releases: (() => void)[] = []
let context: Context | undefined
let root: string | undefined

afterEach(async () => {
  for (const release of releases.splice(0)) release()
  try {
    await context?.fiber.dispose()
  } finally {
    context = undefined
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    if (root !== undefined) await rm(root, { recursive: true, force: true })
    root = undefined
  }
})

/** A complete account model whose id is absent from the installed Go catalog. */
function directory(id: string) {
  return { providers: { 'opencode-go': {
    package: 'aisdk:@ai-sdk/openai-compatible',
    settings: { baseURL: 'https://opencode.ai/inference/go/openai/v1' },
    models: { [id]: { limit: { context: 8192, output: 1024 }, capabilities: { input: ['text'] } } },
  } } }
}

/** A delayed external response that deliberately ignores cancellation. */
function heldDirectory(id: string) {
  const pending = Promise.withResolvers<Response>()
  const release = (): void => { pending.resolve(Response.json(directory(id))) }
  releases.push(release)
  return { response: pending.promise, release }
}

interface Request {
  readonly url: string
  readonly headers: Headers
  readonly signal: AbortSignal | null | undefined
  readonly init: RequestInit | undefined
}

/** Admit only fake Console requests and credential-free public metadata reads. */
function transport(answer: (request: Request) => Response | Promise<Response>) {
  const calls: Request[] = []
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input, init) => {
    const request: Request = {
      url: input instanceof Request ? input.url : String(input),
      headers: new Headers(init?.headers), signal: init?.signal, init,
    }
    calls.push(request)
    if (request.url === METADATA_URL) {
      expect(request.headers.has('authorization')).toBe(false)
      expect(request.headers.has('x-org-id')).toBe(false)
      return Response.json({ 'opencode-go': { models: {} } })
    }
    if (request.url !== CONFIG_URL && request.url !== 'https://opencode.ai/console/auth/device/token'
      && request.url !== 'https://opencode.ai/console/auth/device/code') {
      throw new Error(`unexpected fixture request ${request.url}`)
    }
    return answer(request)
  }))
  return calls
}

/** Boot actual Include rows with configurable service initialization and saved route settings. */
async function load(options: {
  route?: string
  profile?: LlmPiAi.PiAiProviderProfile
  record?: CredentialRecord
  refs?: Record<string, string>
  baseProviders?: LlmPiAi.Config['providers']
  storedProviders?: LlmPiAi.Config['providers']
  injectedServices?: string[]
  credentialsStart?: Promise<undefined>
  piAiStart?: Promise<undefined>
  beforeInclude?: (ctx: Context) => void
} = {}) {
  vi.stubEnv('OPENCODE_API_KEY', undefined)
  vi.stubEnv(REF, undefined)
  root = await mkdtemp(join(tmpdir(), 'dsh-live-catalog-loader-'))
  const credentialsPath = join(root, 'credentials.yaml')
  const settingsPath = join(root, 'settings.yaml')
  const configPath = join(root, 'cordis.yml')
  const route = options.route ?? 'opencode-go'
  const record = options.record ?? { kind: 'api-key', key: 'stored-key' }
  await writeFile(credentialsPath, JSON.stringify({ version: 1, refs: options.refs ?? {},
    records: { [recordKeyFor(route)]: record },
  }), { mode: 0o600 })
  await writeFile(settingsPath, JSON.stringify(options.storedProviders === undefined
    ? {} : { 'llm-pi-ai': { providers: options.storedProviders } }) + '\n')
  await writeFile(configPath, JSON.stringify([
    { name: '@deepseek-ai/dsh-llm' },
    { name: '@deepseek-ai/dsh-authorization' },
    { name: '@deepseek-ai/dsh-credentials-local', config: { path: credentialsPath, watch: false } },
    { name: '@deepseek-ai/dsh-settings-file', config: { path: settingsPath, watch: false } },
    { name: '@deepseek-ai/dsh-llm-pi-ai', inject: options.injectedServices ?? ['llm', 'authorization', 'credentials', 'settings'],
      config: { providers: options.baseProviders ?? {
        [route]: options.profile ?? (route === 'opencode-go' ? {} : { catalogProvider: 'opencode-go' }),
      } },
    },
  ]))
  const ctx = new Context()
  context = ctx
  ctx.baseUrl = `${pathToFileURL(root).href}/`
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const start = options.credentialsStart
  const credentialModule = start === undefined ? LocalCredentialProvider : class extends LocalCredentialProvider {
    override async* [Service.init](): AsyncGenerator<() => Promise<void> | void, void, void> {
      await start
      yield* super[Service.init]()
    }
  }
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-llm', LlmRuntime], ['@deepseek-ai/dsh-authorization', AuthorizationService],
    ['@deepseek-ai/dsh-credentials-local', credentialModule], ['@deepseek-ai/dsh-settings-file', FileSettingsProvider],
    ['@deepseek-ai/dsh-llm-pi-ai', LlmPiAi],
  ])
  ctx.loader.internal = { version: 'v2', import: async (specifier: string) => {
    if (!modules.has(specifier)) throw new Error(`unexpected Loader module ${specifier}`)
    if (specifier === '@deepseek-ai/dsh-llm-pi-ai') await options.piAiStart
    return modules.get(specifier)
  } } as unknown as NonNullable<typeof ctx.loader.internal>
  options.beforeInclude?.(ctx)
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  return { ctx, route, credentialsPath }
}

describe('live Go catalog source Loader', () => {
  it('registers persisted Go settings and refreshes their catalog at startup when the composition has no providers', async () => {
    const calls = transport(() => {
      const model = 'deepseek-v4.1-flash'
      const payload = directory(model)
      const go = payload.providers['opencode-go']
      return Response.json({ providers: { 'opencode-go': { ...go, models: {
        [model]: { ...go.models[model], name: 'DeepSeek V4.1 Flash' },
      } } } })
    })
    const { ctx } = await load({ baseProviders: {}, storedProviders: { 'opencode-go': {} } })
    await expect.poll(() => calls.filter(request => request.url === CONFIG_URL).length).toBe(1)
    expect(await ctx.llm.listModels('opencode-go')).toContainEqual(expect.objectContaining({
      id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash',
    }))
  })

  it('refreshes a persisted Go route when durable credentials become ready after its first startup attempt', async () => {
    const gate = Promise.withResolvers<undefined>()
    releases.push(() => { gate.resolve(undefined) })
    const calls = transport(() => Response.json(directory('deepseek-v4.1-flash')))
    const loading = load({ baseProviders: {}, storedProviders: { 'opencode-go': {} },
      injectedServices: ['llm'], credentialsStart: gate.promise,
    })
    await expect.poll(() => context?.get('llm')?.listConfigurableProviders()
      .find(provider => provider.provider === 'opencode-go')?.error)
      .toBe('OpenCode Go model discovery requires account sign-in or an API key')
    expect(calls.filter(request => request.url === CONFIG_URL)).toHaveLength(0)
    gate.resolve(undefined)
    const { ctx } = await loading
    expect(await ctx.credentials.readRecord(recordKeyFor('opencode-go'))).toEqual({ kind: 'api-key', key: 'stored-key' })
    await expect.poll(() => calls.filter(request => request.url === CONFIG_URL).length).toBe(1)
    await expect.poll(async () => (await ctx.llm.listModels('opencode-go')).map(model => model.id)).toEqual(['deepseek-v4.1-flash'])
  })

  it('refreshes a replacement credential service when the previous service left before its optional scope activated', async () => {
    const start = Promise.withResolvers<undefined>()
    releases.push(() => { start.resolve(undefined) })
    let removal: Promise<void> | undefined
    const calls = transport((request) => {
      expect(request.headers.get('authorization')).toBe('Bearer account-b-key')
      return Response.json(directory('account-b-model'))
    })
    const { ctx, credentialsPath } = await load({ injectedServices: ['llm'], piAiStart: start.promise,
      record: { kind: 'api-key', key: 'account-a-key' },
      beforeInclude: (host) => {
        host.on('internal/plugin', (fiber) => {
          if (fiber.runtime?.callback === LocalCredentialProvider) {
            queueMicrotask(() => { void fiber.await().then(() => { start.resolve(undefined) }) })
          }
          if (removal !== undefined || fiber.parent.fiber.name !== 'llm-pi-ai'
            || !Object.hasOwn(fiber.inject, 'credentials')) return
          const credential = [...host.loader.entries()].find(entry => entry.options.name === '@deepseek-ai/dsh-credentials-local')
          if (credential?.fiber === undefined) throw new Error('the initial credential service was not ready')
          expect(host.get('credentials')).toBeDefined()
          removal = Promise.resolve(credential.fiber.dispose())
        })
      },
    })
    expect(removal).toBeDefined()
    await removal
    await expect.poll(() => ctx.llm.listConfigurableProviders().find(provider => provider.provider === 'opencode-go')?.error)
      .toBe('OpenCode Go model discovery requires account sign-in or an API key')
    expect(calls.filter(request => request.url === CONFIG_URL)).toHaveLength(0)

    await writeFile(credentialsPath, JSON.stringify({ version: 1, refs: {}, records: {
      [recordKeyFor('opencode-go')]: { kind: 'api-key', key: 'account-b-key' },
    } }), { mode: 0o600 })
    const entry = [...ctx.loader.entries()].find(candidate => candidate.options.name === '@deepseek-ai/dsh-credentials-local')
    if (entry === undefined) throw new Error('the credential Loader entry was removed')
    await ctx.loader.update(entry.id, { disabled: false })
    await ctx.loader.await()
    await expect.poll(async () => (await ctx.llm.listModels('opencode-go')).map(model => model.id)).toEqual(['account-b-model'])
    expect(calls.filter(request => request.url === CONFIG_URL)).toHaveLength(1)
    expect(ctx.llm.listConfigurableProviders().find(provider => provider.provider === 'opencode-go')?.error).toBeUndefined()
  })

  it('withdraws a removed credential service and rejects its response after a replacement service publishes', async () => {
    const entered = Promise.withResolvers<undefined>()
    const obsolete = heldDirectory('account-a-model')
    const calls = transport((request) => {
      if (request.headers.get('authorization') === 'Bearer account-a-key') {
        entered.resolve(undefined)
        return obsolete.response
      }
      expect(request.headers.get('authorization')).toBe('Bearer account-b-key')
      return Response.json(directory('account-b-model'))
    })
    const { ctx, credentialsPath } = await load({ injectedServices: ['llm'], record: { kind: 'api-key', key: 'account-a-key' } })
    await entered.promise
    const pending = ctx.llm.discoverModels('llm-pi-ai', { provider: 'opencode-go', refresh: true })
      .then(() => 'published', () => 'invalidated')
    const entry = [...ctx.loader.entries()].find(candidate => candidate.options.name === '@deepseek-ai/dsh-credentials-local')
    if (entry === undefined) throw new Error('the credential Loader entry was not mounted')
    await ctx.loader.update(entry.id, { disabled: true })
    await ctx.loader.await()
    expect(ctx.get('credentials')).toBeUndefined()
    expect(calls.filter(request => request.url === CONFIG_URL).every(request => request.signal?.aborted === true)).toBe(true)
    expect(await ctx.llm.listModels('opencode-go')).toEqual([])

    await writeFile(credentialsPath, JSON.stringify({ version: 1, refs: {}, records: {
      [recordKeyFor('opencode-go')]: { kind: 'api-key', key: 'account-b-key' },
    } }), { mode: 0o600 })
    await ctx.loader.update(entry.id, { disabled: false })
    await ctx.loader.await()
    await expect.poll(async () => (await ctx.llm.listModels('opencode-go')).map(model => model.id)).toEqual(['account-b-model'])
    obsolete.release()
    expect(await pending).toBe('invalidated')
    expect((await ctx.llm.listModels('opencode-go')).map(model => model.id)).toEqual(['account-b-model'])

    const errors: unknown[] = []
    ctx.logger.exporter({ export: (message) => { if (message.type === 'error') errors.push(message) } })
    const providerEntry = [...ctx.loader.entries()].find(candidate => candidate.options.name === '@deepseek-ai/dsh-llm-pi-ai')
    if (providerEntry === undefined) throw new Error('the provider Loader entry was not mounted')
    await ctx.loader.update(providerEntry.id, { disabled: true })
    await ctx.loader.await()
    expect(errors).toEqual([])
  })

  it.each(['opencode-go', 'go-work'])('replaces %s account metadata and rejects an obsolete response after record replacement', async (route) => {
    const entered = Promise.withResolvers<undefined>()
    const obsolete = heldDirectory('account-a-model')
    const current = heldDirectory('account-b-model')
    const nextEntered = Promise.withResolvers<undefined>()
    const calls = transport((request) => {
      if (request.headers.get('authorization') === 'Bearer account-a-key') {
        entered.resolve(undefined)
        return obsolete.response
      }
      expect(request.headers.get('authorization')).toBe('Bearer account-b-key')
      nextEntered.resolve(undefined)
      return current.response
    })
    const { ctx } = await load({ route, record: { kind: 'api-key', key: 'account-a-key' } })
    await entered.promise
    await ctx.credentials.modifyRecord(recordKeyFor(route), async () => ({ kind: 'api-key', key: 'account-b-key' }))
    await nextEntered.promise
    expect(calls.find(request => request.url === CONFIG_URL)?.signal?.aborted).toBe(true)
    expect(await ctx.llm.listModels(route)).toEqual([])
    current.release()
    await expect.poll(async () => (await ctx.llm.listModels(route)).map(model => model.id)).toEqual(['account-b-model'])
    obsolete.release()
    expect((await ctx.llm.listModels(route)).map(model => model.id)).toEqual(['account-b-model'])
    expect(await ctx.llm.resolveModelInfo(route, 'account-b-model')).toMatchObject({ context: { contextWindow: 8192 } })
    expect(calls.filter(request => request.url === CONFIG_URL)).toHaveLength(2)
  })

  it('shares a pending automatic refresh with explicit refresh without requiring a default Go baseURL', async () => {
    const entered = Promise.withResolvers<undefined>()
    const pending = heldDirectory('current-model')
    const calls = transport(() => { entered.resolve(undefined); return pending.response })
    const { ctx } = await load()
    await entered.promise
    const manual = ctx.llm.discoverModels('llm-pi-ai', { provider: 'opencode-go', refresh: true })
    pending.release()
    expect((await manual).map(model => model.id)).toEqual(['current-model'])
    expect((await ctx.llm.listModels('opencode-go')).map(model => model.id)).toEqual(['current-model'])
    expect(calls.filter(request => request.url === CONFIG_URL)).toHaveLength(1)
  })

  it('persists native OAuth rotation without aborting or duplicating the directory request', async () => {
    const calls = transport((request) => {
      if (request.url.endsWith('/auth/device/token')) {
        expect(new URLSearchParams(request.init?.body as URLSearchParams).get('grant_type')).toBe('refresh_token')
        return Response.json({ access_token: 'rotated-access', refresh_token: 'rotated-refresh', expires_in: 30 * 24 * 60 * 60 })
      }
      expect(request.headers.get('authorization')).toBe('Bearer rotated-access')
      expect(request.signal?.aborted).toBe(false)
      return Response.json(directory('rotated-model'))
    })
    const before = Date.now()
    const { ctx, credentialsPath } = await load({ record: {
      kind: 'grant', payload: { type: 'oauth', access: 'expired-access', refresh: 'expired-refresh', expires: 0 },
    } })
    await expect.poll(async () => (await ctx.llm.listModels('opencode-go')).map(model => model.id)).toEqual(['rotated-model'])
    const record = await ctx.credentials.readRecord(recordKeyFor('opencode-go'))
    expect(record).toMatchObject({ kind: 'grant', payload: { access: 'rotated-access', refresh: 'rotated-refresh' } })
    if (record?.kind !== 'grant') throw new Error('rotated OAuth grant was not stored')
    const payload = record.payload as { expires: number }
    expect(payload.expires).toBeGreaterThanOrEqual(before + 30 * 24 * 60 * 60 * 1000)
    expect(payload.expires).toBeLessThanOrEqual(Date.now() + 30 * 24 * 60 * 60 * 1000)
    expect(await readFile(credentialsPath, 'utf8')).toContain('rotated-refresh')
    expect(calls.filter(request => request.url.endsWith('/auth/device/token'))).toHaveLength(1)
    expect(calls.filter(request => request.url === CONFIG_URL)).toHaveLength(1)
  })

  it('returns draft-key candidates without replacing the conversation catalog', async () => {
    transport(request => Response.json(directory(request.headers.get('authorization') === 'Bearer draft-key' ? 'draft-model' : 'stored-model')))
    const { ctx } = await load()
    await expect.poll(async () => (await ctx.llm.listModels('opencode-go')).map(model => model.id)).toEqual(['stored-model'])
    expect((await ctx.llm.discoverModels('llm-pi-ai', {
      provider: 'opencode-go', refresh: true, apiKey: 'draft-key',
    })).map(model => model.id)).toEqual(['draft-model'])
    expect((await ctx.llm.listModels('opencode-go')).map(model => model.id)).toEqual(['stored-model'])
  })

  it('clears the previous account after a credential-reference change even when the new key is refused', async () => {
    const entered = Promise.withResolvers<undefined>()
    transport((request) => {
      if (request.headers.get('authorization') === 'Bearer reference-a') return Response.json(directory('reference-model'))
      expect(request.headers.get('authorization')).toBe('Bearer reference-b')
      entered.resolve(undefined)
      return Response.json({}, { status: 403 })
    })
    const { ctx } = await load({ profile: { apiKeyEnv: REF }, refs: { [REF]: 'reference-a' } })
    await expect.poll(async () => (await ctx.llm.listModels('opencode-go')).map(model => model.id)).toEqual(['reference-model'])
    await ctx.credentials.set(REF, 'reference-b')
    await entered.promise
    await expect.poll(() => ctx.llm.listConfigurableProviders().find(provider => provider.provider === 'opencode-go')?.error).toContain('403')
    expect(await ctx.llm.listModels('opencode-go')).toEqual([])
  })

  it('keeps the current directory after authorization fails without committing a credential', async () => {
    const calls = transport(() => Response.json(directory('stored-model')))
    const { ctx } = await load()
    await expect.poll(async () => (await ctx.llm.listModels('opencode-go')).map(model => model.id)).toEqual(['stored-model'])
    await expect(ctx.authorization.begin({ key: recordKeyFor('opencode-go'), method: 'api-key', interaction: {
      notify: () => {}, prompt: () => Promise.reject(new Error('fixture authentication failed')),
    } })).rejects.toThrow('fixture authentication failed')
    expect((await ctx.llm.listModels('opencode-go')).map(model => model.id)).toEqual(['stored-model'])
    expect(calls.filter(request => request.url === CONFIG_URL)).toHaveLength(1)
    expect(await ctx.credentials.readRecord(recordKeyFor('opencode-go'))).toEqual({ kind: 'api-key', key: 'stored-key' })
  })

  it('invalidates a cancelled OAuth login that committed another account while an old directory is pending', async () => {
    const entered = Promise.withResolvers<undefined>()
    const pending = heldDirectory('account-a-model')
    transport((request) => {
      if (request.url.endsWith('/auth/device/code')) {
        return Response.json({ device_code: 'fixture-device', user_code: 'GO-0001',
          verification_uri_complete: '/console/device?user_code=GO-0001', interval: 0.001, expires_in: 600 })
      }
      if (request.url.endsWith('/auth/device/token')) {
        return Response.json({ access_token: 'account-b-access', refresh_token: 'account-b-refresh', expires_in: 30 * 24 * 60 * 60 })
      }
      if (request.headers.get('authorization') === 'Bearer account-a-access') {
        entered.resolve(undefined)
        return pending.response
      }
      expect(request.headers.get('authorization')).toBe('Bearer account-b-access')
      return Response.json(directory('account-b-model'))
    })
    const provider = catalogProvider('opencode-go')
    const original = provider?.auth.oauth
    if (provider === undefined || original === undefined) throw new Error('fixture requires native Go OAuth')
    // The cached native flow captured its constructor transport; scope the replacement to this case.
    provider.auth.oauth = openCodeGoOAuth()
    try {
      const { ctx, credentialsPath } = await load({ record: { kind: 'grant', payload: {
        type: 'oauth', access: 'account-a-access', refresh: 'account-a-refresh', expires: Date.now() + 3_600_000,
      } } })
      await entered.promise
      const oldResult = ctx.llm.discoverModels('llm-pi-ai', { provider: 'opencode-go', refresh: true })
        .then(() => 'published', (_error: unknown) => 'invalidated')
      const caller = new AbortController()
      ctx.on('credentials/record-updated', (key) => {
        if (key === recordKeyFor('opencode-go')) caller.abort(new Error('fixture cancelled after the durable commit'))
      })
      expect(await ctx.authorization.begin({ key: recordKeyFor('opencode-go'), method: 'oauth', signal: caller.signal,
        interaction: { notify: () => {}, prompt: () => Promise.reject(new Error('device flow must not prompt')) },
      })).toEqual({ status: 'cancelled' })
      expect(await readFile(credentialsPath, 'utf8')).toContain('account-b-refresh')
      pending.release()
      expect(await oldResult).toBe('invalidated')
      await expect.poll(async () => (await ctx.llm.listModels('opencode-go')).map(model => model.id)).toEqual(['account-b-model'])
    } finally {
      provider.auth.oauth = original
    }
  })

  it('retains the last successful directory after failure, clears its diagnostic, and notifies metadata consumers', async () => {
    let status = 200
    let window = 8192
    transport(() => {
      const result = directory('stable-model')
      result.providers['opencode-go'].models['stable-model']!.limit.context = window
      return Response.json(result, { status })
    })
    const { ctx } = await load()
    await expect.poll(async () => (await ctx.llm.listModels('opencode-go')).map(model => model.id)).toEqual(['stable-model'])
    const changed = vi.fn()
    ctx.on('llm/adapters-updated', changed)
    const refresh = () => ctx.llm.discoverModels('llm-pi-ai', { provider: 'opencode-go', refresh: true })
    await refresh()
    expect(changed).not.toHaveBeenCalled()
    status = 403
    await expect(refresh()).rejects.toThrow('403')
    expect((await ctx.llm.listModels('opencode-go')).map(model => model.id)).toEqual(['stable-model'])
    expect(ctx.llm.listConfigurableProviders().find(provider => provider.provider === 'opencode-go')?.error).toContain('403')
    status = 200
    await refresh()
    expect(ctx.llm.listConfigurableProviders().find(provider => provider.provider === 'opencode-go')?.error).toBeUndefined()
    changed.mockClear()
    window = 16384
    await refresh()
    expect(changed).toHaveBeenCalledOnce()
    expect(await ctx.llm.resolveModelInfo('opencode-go', 'stable-model')).toMatchObject({ context: { contextWindow: window } })
  })

  it('invalidates changed route sources and retires automatic refresh when a protocol is explicitly configured', async () => {
    const pending = heldDirectory('workspace-b-model')
    const entered = Promise.withResolvers<undefined>()
    const calls = transport((request) => {
      if (request.headers.get('x-workspace') === 'b') { entered.resolve(undefined); return pending.response }
      return Response.json(directory('workspace-a-model'))
    })
    const { ctx, route } = await load({ route: 'go-work' })
    await expect.poll(async () => (await ctx.llm.listModels(route)).map(model => model.id)).toEqual(['workspace-a-model'])
    await ctx.settings.mutate('llm-pi-ai', [{ op: 'set', path: ['providers', route, 'headers'], value: { 'x-workspace': 'b' } }])
    await entered.promise
    expect(await ctx.llm.listModels(route)).toEqual([])
    pending.release()
    await expect.poll(async () => (await ctx.llm.listModels(route)).map(model => model.id)).toEqual(['workspace-b-model'])
    await ctx.settings.mutate('llm-pi-ai', [
      { op: 'set', path: ['providers', route, 'api'], value: 'openai-completions' },
      { op: 'set', path: ['providers', route, 'baseURL'], value: 'https://gateway.example/v1' },
      { op: 'set', path: ['providers', route, 'models'], value: [{ id: 'configured-model' }] },
    ])
    expect((await ctx.llm.listModels(route)).map(model => model.id)).toEqual(['configured-model'])
    const before = calls.length
    await ctx.credentials.modifyRecord(recordKeyFor(route), async () => ({ kind: 'api-key', key: 'later-key' }))
    await ctx.credentials.set(credentialRef('UNRELATED_LIVE_CATALOG_KEY'), 'unrelated-key')
    expect(calls).toHaveLength(before)
  })

  it('synchronizes a successful sign-in and ignores sign-ins belonging to another provider', async () => {
    const calls = transport(request => Response.json(directory(request.headers.get('authorization') === 'Bearer signed-key' ? 'signed-model' : 'stored-model')))
    const { ctx } = await load()
    await expect.poll(async () => (await ctx.llm.listModels('opencode-go')).map(model => model.id)).toEqual(['stored-model'])
    const interaction = { notify: () => {}, prompt: async () => 'signed-key' }
    await ctx.authorization.begin({ key: recordKeyFor('opencode-go'), method: 'api-key', interaction })
    await expect.poll(async () => (await ctx.llm.listModels('opencode-go')).map(model => model.id)).toEqual(['signed-model'])
    const before = calls.length
    await ctx.authorization.begin({ key: recordKeyFor('opencode'), method: 'api-key', interaction })
    expect(calls).toHaveLength(before)
    expect((await ctx.llm.listModels('opencode-go')).map(model => model.id)).toEqual(['signed-model'])
  })


  it('keeps unknown OAuth failures out of provider diagnostics', async () => {
    transport(request => request.url.endsWith('/auth/device/token')
      ? Response.json({ access_token: 'secret-access', refresh_token: 'secret-refresh', expires_in: 'bad value' })
      : Response.json(directory('must-not-publish')))
    const { ctx } = await load({ record: {
      kind: 'grant', payload: { type: 'oauth', access: 'expired-secret', refresh: 'expired-secret-refresh', expires: 0 },
    } })
    await expect.poll(() => ctx.llm.listConfigurableProviders().find(provider => provider.provider === 'opencode-go')?.error)
      .toBe('Model directory could not be loaded; check account sign-in and refresh')
  })

  it('allows an endpoint repair probe for an unserviceable hand-declared route', async () => {
    const { ctx, route } = await load({ route: 'custom-route', profile: {
      models: [{ id: 'custom-model' }],
    } })
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input, init) => {
      expect(input instanceof Request ? input.url : String(input)).toBe('https://draft.example/v1/models')
      expect(new Headers(init?.headers).has('authorization')).toBe(false)
      return Response.json({ data: [{ id: 'draft-model' }] })
    }))
    expect((await ctx.llm.discoverModels('llm-pi-ai', { provider: route, baseURL: 'https://draft.example/v1' })).map(model => model.id)).toEqual(['draft-model'])
  })

  it('synchronizes an explicitly configured native endpoint and shares only matching endpoint probes', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input) => {
      const url = input instanceof Request ? input.url : String(input)
      if (url === 'https://api.x.ai/v1/models') return Response.json({ data: [{ id: 'grok-fixture', context_length: 65536 }] })
      if (url === 'https://api.x.ai/v1/language-models') return Response.json({ models: [{ id: 'grok-fixture' }] })
      if (url === 'https://draft.example/v1/models') return Response.json({ data: [{ id: 'grok-draft' }] })
      if (url === 'https://draft.example/v1/language-models') return Response.json({ models: [{ id: 'grok-draft' }] })
      throw new Error('unexpected fixture request ' + url)
    }))
    const { ctx, route } = await load({ route: 'xai', profile: { baseURL: 'https://api.x.ai/v1' } })
    await expect.poll(async () => (await ctx.llm.listModels(route)).map(model => model.id)).toEqual(['grok-fixture'])
    expect((await ctx.llm.discoverModels('llm-pi-ai', { provider: route, refresh: true, baseURL: 'https://api.x.ai/v1' })).map(model => model.id)).toEqual(['grok-fixture'])
    expect((await ctx.llm.discoverModels('llm-pi-ai', { provider: route, refresh: true, baseURL: 'https://draft.example/v1' })).map(model => model.id)).toEqual(['grok-draft'])
    await ctx.credentials.set(credentialRef('UNRELATED_LIVE_CATALOG_KEY'), 'unrelated-key')
    expect((await ctx.llm.listModels(route)).map(model => model.id)).toEqual(['grok-fixture'])
  })


  it('mounts the exported initializer with no provider configuration or automatic requests', async () => {
    const ctx = new Context()
    context = ctx
    const fetch = vi.fn<typeof globalThis.fetch>()
    vi.stubGlobal('fetch', fetch)
    await ctx.plugin(LlmRuntime)
    await ctx.plugin({ inject: ['llm'], apply: (owner: Context) => { LlmPiAi.apply(owner, {}) } })
    expect(ctx.llm.listProviders()).toEqual([])
    expect(fetch).not.toHaveBeenCalled()
  })

})
