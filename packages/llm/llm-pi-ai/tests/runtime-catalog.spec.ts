import type { Api, Model } from '@earendil-works/pi-ai'
import { describe, expect, it } from 'vitest'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { catalogModels } from '../src/catalog.ts'
import { assertServiceable, Config, resolveModelCatalogTiming, resolveProfiles } from '../src/config.ts'
import type { PiAiProviderProfile } from '../src/config.ts'

/** A server-described model whose id is absent from the installed catalog. */
function advertised(id: string, api: Api, overrides: Partial<Model<Api>> = {}): Model<Api> {
  return {
    id,
    name: `Online ${id}`,
    provider: 'opencode-go',
    api,
    baseUrl: `https://go.test/${api}`,
    reasoning: true,
    input: ['text', 'image'],
    contextWindow: 131_072,
    maxTokens: 8192,
    cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 },
    thinkingLevelMap: { low: 'low', high: 'high' },
    headers: { 'x-model-route': id },
    samplingParams: { temperature: 0.25 },
    ...overrides,
  }
}

describe('runtime model catalogs', () => {
  it('serves new Go ids with each model’s advertised protocol and metadata', () => {
    const runtime = [
      advertised('go-chat-next', 'openai-completions', { compat: { supportsDeveloperRole: false } }),
      advertised('go-responses-next', 'openai-responses', { compat: { supportsLongCacheRetention: false } }),
      advertised('go-messages-next', 'anthropic-messages', { compat: { supportsEagerToolInputStreaming: false } }),
    ]
    const route = 'go-subscription'
    const profile = resolveProfiles({ [route]: { catalogProvider: 'opencode-go' } }, 'strict',
      new Map([[route, runtime]])).get(route)

    expect(runtime.every(model => !catalogModels('opencode-go').has(model.id))).toBe(true)
    expect(profile?.piProvider?.getModels()).toEqual(runtime.map(model => ({ ...model, provider: route })))
    expect(profile?.piProvider?.auth.oauth).toBeDefined()
    expect(profile?.configuredMaxTokens.size).toBe(0)
  })

  it('serves gpt-6.2-sol-runtime through the native Codex protocol without a manual models list', () => {
    const model = advertised('gpt-6.2-sol-runtime', 'openai-codex-responses', {
      provider: 'openai-codex',
      baseUrl: 'https://chatgpt.com/backend-api',
      contextWindow: 272_000,
      thinkingLevelMap: { low: 'low', max: 'max' },
    })
    const profile = resolveProfiles({ 'openai-codex': {} }, 'strict',
      new Map([['openai-codex', [model]]])).get('openai-codex')

    expect(catalogModels('openai-codex').has(model.id)).toBe(false)
    expect(profile?.piProvider?.getModels()).toEqual([model])
    expect(profile?.piProvider?.auth.oauth).toBeDefined()
    expect(profile?.configuredMaxTokens.size).toBe(0)
  })

  it('uses a changed server protocol and endpoint even when the same id exists in the installed catalog', () => {
    const installed = [...catalogModels('opencode-go').values()][0]
    if (installed === undefined) throw new Error('the installed catalog ships no Go models')
    const api = installed.api === 'anthropic-messages' ? 'openai-responses' : 'anthropic-messages'
    const model = advertised(installed.id, api, { compat: { supportsLongCacheRetention: false } })
    const profile = resolveProfiles({ 'opencode-go': {} }, 'strict',
      new Map([['opencode-go', [model]]])).get('opencode-go')

    expect(profile?.piProvider?.getModels()).toEqual([model])
    expect(profile?.piProvider?.getModels()[0]?.api).not.toBe(installed.api)
    expect(profile?.configuredMaxTokens.size).toBe(0)
  })

  it.each([undefined, 'configured'] as const)('keeps an explicit subset with mode %s', (modelCatalogMode) => {
    const chosen = advertised('go-selected-next', 'anthropic-messages')
    const other = advertised('go-other-next', 'openai-completions')
    const profile = resolveProfiles({
      'opencode-go': {
        ...modelCatalogMode === undefined ? {} : { modelCatalogMode },
        models: [{ id: chosen.id, name: 'Chosen', contextWindow: 65_536, maxTokens: 2048 }],
      },
    }, 'strict', new Map([['opencode-go', [chosen, other]]])).get('opencode-go')

    expect(profile?.piProvider?.getModels()).toEqual([
      { ...chosen, name: 'Chosen', contextWindow: 65_536, maxTokens: 2048 },
    ])
    expect([...profile?.configuredMaxTokens ?? []]).toEqual([[chosen.id, 2048]])
  })

  it('follows all live Codex ids while retaining matching rows as user customizations', () => {
    const tuned = advertised('codex-tuned', 'openai-codex-responses', { provider: 'openai-codex' })
    const newest = advertised('gpt-6.2-sol-runtime', 'openai-codex-responses', { provider: 'openai-codex' })
    const providers = {
      'openai-codex': {
        modelCatalogMode: 'live' as const,
        models: [{ id: tuned.id, name: 'My Codex', contextWindow: 65_536, maxTokens: 2048 }],
      },
    }
    const original = structuredClone(providers)
    const profile = resolveProfiles(providers, 'strict',
      new Map([['openai-codex', [tuned, newest]]])).get('openai-codex')

    expect(profile?.piProvider?.getModels()).toEqual([
      { ...tuned, name: 'My Codex', contextWindow: 65_536, maxTokens: 2048 }, newest,
    ])
    expect([...profile?.configuredMaxTokens ?? []]).toEqual([[tuned.id, 2048]])
    expect(providers).toEqual(original)
  })

  it('retains a removed live customization as a diagnostic without adding or blocking models', () => {
    const current = advertised('go-current', 'anthropic-messages')
    const providers = {
      'opencode-go': {
        modelCatalogMode: 'live' as const,
        models: [{ id: 'go-removed', maxTokens: 1024 }],
      },
    }
    const catalogs = new Map([['opencode-go', [current]]])
    expect(() => { assertServiceable({ providers }, undefined, catalogs) }).not.toThrow()
    const profile = resolveProfiles(providers, 'strict', catalogs).get('opencode-go')

    expect(profile?.piProvider?.getModels()).toEqual([current])
    expect(profile?.modelErrors.get('go-removed')).toMatch(/absent from the runtime catalog/)
    expect(profile?.configuredMaxTokens.size).toBe(0)
  })

  it('waits for a live Codex id absent from the bootstrap catalog instead of guessing its API', () => {
    const newest = advertised('gpt-6.2-sol-runtime', 'openai-codex-responses', { provider: 'openai-codex' })
    const providers = {
      'openai-codex': { modelCatalogMode: 'live' as const, models: [{ id: newest.id, maxTokens: 1024 }] },
    }
    const bootstrap = resolveProfiles(providers, 'deferred').get('openai-codex')
    expect(bootstrap?.piProvider?.getModels().some(model => model.id === newest.id)).toBe(false)
    expect(bootstrap?.modelErrors.get(newest.id)).toMatch(/absent from the installed catalog/)
    const refreshed = resolveProfiles(providers, 'deferred',
      new Map([['openai-codex', [newest]]])).get('openai-codex')
    expect(refreshed?.piProvider?.getModels()).toEqual([{ ...newest, maxTokens: 1024 }])
    expect(refreshed?.modelErrors.size).toBe(0)
  })

  it('rejects duplicate live customizations while deferred reads keep other ids serviceable', () => {
    const duplicate = advertised('go-duplicate', 'anthropic-messages')
    const other = advertised('go-valid', 'openai-completions')
    const providers = {
      'opencode-go': { modelCatalogMode: 'live' as const, models: [{ id: duplicate.id }, { id: duplicate.id }] },
    }
    const catalogs = new Map([['opencode-go', [duplicate, other]]])
    expect(() => resolveProfiles(providers, 'strict', catalogs)).toThrow(/more than once/)
    const profile = resolveProfiles(providers, 'deferred', catalogs).get('opencode-go')
    expect(profile?.piProvider?.getModels()).toEqual([other])
    expect(profile?.modelErrors.get(duplicate.id)).toMatch(/more than once/)
  })

  it('rejects an empty live customization id before matching it to an account model', () => {
    const current = advertised('go-current', 'openai-completions')
    const catalogs = new Map([['opencode-go', [current]]])
    expect(() => resolveProfiles({ 'opencode-go': {
      modelCatalogMode: 'live', models: [{ id: '', name: 'Unaddressable customization' }],
    } }, 'strict', catalogs)).toThrow(/empty id/)
  })

  it('validates and applies overrides against the same route’s online catalog', () => {
    const chosen = advertised('go-overridden-next', 'anthropic-messages')
    const other = advertised('go-untuned-next', 'openai-completions')
    const providers = { 'opencode-go': { modelOverrides: { [chosen.id]: { name: 'Tuned', maxTokens: 1024 } } } }
    const catalogs = new Map([['opencode-go', [chosen, other]]])

    expect(() => { assertServiceable({ providers }) }).toThrow(/modelOverrides names/)
    expect(() => { assertServiceable({ providers }, undefined, catalogs) }).not.toThrow()
    const profile = resolveProfiles(providers, 'strict', catalogs).get('opencode-go')
    expect(profile?.piProvider?.getModels()).toEqual([{ ...chosen, name: 'Tuned', maxTokens: 1024 }, other])
    expect([...profile?.configuredMaxTokens ?? []]).toEqual([[chosen.id, 1024]])
  })

  it('keys catalogs by configured route so two accounts sharing a native provider stay separate', () => {
    const first = advertised('account-a-model', 'openai-codex-responses', { provider: 'openai-codex' })
    const second = advertised('account-b-model', 'openai-codex-responses', { provider: 'openai-codex' })
    const providers = {
      'account-a': { catalogProvider: 'openai-codex' },
      'account-b': { catalogProvider: 'openai-codex' },
    }
    const profiles = resolveProfiles(providers, 'strict', new Map([
      ['account-a', [first]],
      ['account-b', [second]],
      ['openai-codex', [advertised('unrelated-account-model', 'openai-codex-responses')]],
    ]))

    expect(profiles.get('account-a')?.piProvider?.getModels().map(model => model.id)).toEqual([first.id])
    expect(profiles.get('account-b')?.piProvider?.getModels().map(model => model.id)).toEqual([second.id])
    const nativeKeyOnly = resolveProfiles(providers, 'strict', new Map([['openai-codex', [first]]]))
    expect(nativeKeyOnly.get('account-a')?.piProvider?.getModels().some(model => model.id === first.id)).toBe(false)
  })

  it('keeps an authoritative empty catalog empty instead of restoring installed models', () => {
    const catalogs = new Map<string, readonly Model<Api>[]>([['openai-codex', []]])
    expect(resolveProfiles({ 'openai-codex': {} }).get('openai-codex')?.piProvider?.getModels().length)
      .toBeGreaterThan(0)
    expect(() => resolveProfiles({ 'openai-codex': {} }, 'strict', catalogs)).toThrow(/resolves no models/)
    const profile = resolveProfiles({ 'openai-codex': {} }, 'deferred', catalogs).get('openai-codex')
    expect(profile?.piProvider).toBeUndefined()
    expect(profile?.catalogError).toMatch(/resolves no models/)
  })

  it('still serves a complete manual declaration when the online catalog is empty', () => {
    const providers: Record<string, PiAiProviderProfile> = {
      'opencode-go': {
        api: 'openai-completions',
        baseURL: 'https://manual.test/v1',
        models: [{ id: 'manual-model', maxTokens: 512 }],
      },
    }
    const profile = resolveProfiles(providers, 'strict',
      new Map<string, readonly Model<Api>[]>([['opencode-go', []]])).get('opencode-go')

    expect(profile?.piProvider?.getModels()).toMatchObject([
      { id: 'manual-model', api: 'openai-completions', baseUrl: 'https://manual.test/v1', maxTokens: 512 },
    ])
    expect([...profile?.configuredMaxTokens ?? []]).toEqual([['manual-model', 512]])
  })
})

describe('model catalog timing', () => {
  it('keeps catalog mode absent unless the profile explicitly chooses one', () => {
    expect(Config({ providers: { 'openai-codex': {} } }).providers.get()['openai-codex']?.modelCatalogMode)
      .toBeUndefined()
    expect(() => Config({ providers: { 'openai-codex': { modelCatalogMode: 'other' } } } as never))
      .toThrow()
  })
  it('uses the same timing defaults for schema and schema-free plugin configurations', () => {
    expect(resolveModelCatalogTiming({})).toEqual({ refreshMs: 60_000, timeoutMs: 15_000 })
    expect(Config({})).toMatchObject({ modelCatalogRefreshMs: 60_000, modelCatalogTimeoutMs: 15_000 })
    expect(resolveModelCatalogTiming({ modelCatalogRefreshMs: 500, modelCatalogTimeoutMs: 200 }))
      .toEqual({ refreshMs: 500, timeoutMs: 200 })
    expect(resolveModelCatalogTiming({
      modelCatalogRefreshMs: MAX_TIMER_DELAY_MS,
      modelCatalogTimeoutMs: MAX_TIMER_DELAY_MS,
    })).toEqual({ refreshMs: MAX_TIMER_DELAY_MS, timeoutMs: MAX_TIMER_DELAY_MS })
  })

  it.each(['modelCatalogRefreshMs', 'modelCatalogTimeoutMs'] as const)(
    'rejects invalid %s before a schema-free mount or settings write', (field) => {
      for (const value of [0, -1, NaN, Infinity, MAX_TIMER_DELAY_MS + 1]) {
        const config = { [field]: value }
        expect(() => resolveModelCatalogTiming(config)).toThrow(new RegExp(field))
        expect(() => { assertServiceable(config) }).toThrow(new RegExp(field))
        expect(() => Config(config)).toThrow()
      }
    },
  )
})

describe('resolved Codex directory compatibility', () => {
  it('materializes the supported default independently of installed model metadata', () => {
    const model = advertised('gpt-6.2-sol-runtime', 'openai-codex-responses', { provider: 'openai-codex' })
    const profile = resolveProfiles({ 'openai-codex': {} }, 'strict',
      new Map([['openai-codex', [model]]])).get('openai-codex')
    expect(profile?.codexDirectoryClientVersion).toBe('0.162.1')
    expect(profile?.piProvider?.getModels()).toEqual([model])
  })

  it('keeps each route’s explicit version and exposes it even beside a deferred catalog diagnostic', () => {
    const profiles = resolveProfiles({
      'codex-account': { catalogProvider: 'openai-codex', codexDirectoryClientVersion: '0.163.0-rc.1+fixture' },
      'unserviceable-route': { catalogProvider: 'missing-provider', codexDirectoryClientVersion: '0.162.1' },
    }, 'deferred')
    expect(profiles.get('codex-account')?.codexDirectoryClientVersion).toBe('0.163.0-rc.1+fixture')
    expect(profiles.get('unserviceable-route')?.codexDirectoryClientVersion).toBe('0.162.1')
    expect(profiles.get('unserviceable-route')?.piProvider).toBeUndefined()
    expect(profiles.get('unserviceable-route')?.catalogError).toMatch(/missing-provider/)
  })
})
