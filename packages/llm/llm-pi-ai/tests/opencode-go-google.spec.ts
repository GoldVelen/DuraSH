/** Go account Google models reach the native SDK using Console routing and Go credentials. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { BlockAssembler, createUserMessage, userAgent } from '@deepseek-ai/dsh-llm'
import type { Model } from '@earendil-works/pi-ai'
import { PiAiAdapter } from '../src/adapter.ts'
import { resolveProfiles } from '../src/config.ts'
import { fetchOpenCodeGoCatalog } from '../src/opencode-go-catalog.ts'
import { memoryAuth } from './auth-double.ts'

const MODEL = 'gemini-4-argon-contributor'
const BASE_URL = 'https://opencode.ai/inference/go/google/v1beta'
const REQUEST_URL = `${BASE_URL}/models/${MODEL}:streamGenerateContent?alt=sse`

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

/** The Console declares Google routing independently of the display name and public metadata. */
async function accountModels() {
  return fetchOpenCodeGoCatalog(new Headers(), undefined, url => Promise.resolve(
    url === 'https://opencode.ai/console/api/v2/config' ? { providers: { 'opencode-go': {
      package: 'aisdk:@ai-sdk/openai-compatible',
      settings: { baseURL: 'https://opencode.ai/inference/go/openai/v1' },
      models: {
        'deepseek-v4.1-flash': { limit: { context: 500_000, output: 32_768 }, capabilities: { input: ['text'] } },
        [MODEL]: { name: 'Account model', package: 'aisdk:@ai-sdk/google', settings: { baseURL: BASE_URL },
          limit: { context: 500_000, output: 32_768 }, capabilities: { input: ['text', 'image'] },
          headers: { 'x-model-route': 'fixture-google' } },
      },
    } } } : { 'opencode-go': { models: {} } },
  ))
}

/** Capture the native Google request and supply a complete SSE reply without network access. */
function transport() {
  const requests: { url: string; headers: Headers; body: unknown }[] = []
  const fetcher = vi.fn<typeof fetch>((input, init) => {
    const url = input instanceof Request ? input.url : String(input)
    expect(url).toBe(REQUEST_URL)
    expect(init?.method).toBe('POST')
    if (typeof init?.body !== 'string') throw new Error('fixture expected a serialized Google request')
    requests.push({ url, headers: new Headers(init.headers), body: JSON.parse(init.body) })
    const reply = { candidates: [{ content: { role: 'model', parts: [{ text: 'fixture reply' }] },
      finishReason: 'STOP', index: 0 }], usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 1, totalTokenCount: 3 } }
    return Promise.resolve(new Response(`data: ${JSON.stringify(reply)}\n\n`,
      { headers: { 'content-type': 'text/event-stream' } }))
  })
  vi.stubGlobal('fetch', fetcher)
  return { requests, fetcher }
}

describe('OpenCode Go native Google requests', () => {
  it.each(['oauth', 'api-key'] as const)('uses %s Go credentials, the full versioned endpoint, and the durable session', async (kind) => {
    const models = await accountModels()
    expect(models.map(model => model.id)).toEqual(['deepseek-v4.1-flash', MODEL])
    const profiles = resolveProfiles({ 'opencode-go': { modelCatalogMode: 'live',
      headers: { 'X-OpenCode-Session': 'spoof', 'USER-AGENT': 'spoof' } } }, 'strict',
    new Map([['opencode-go', models]]))
    const { requests, fetcher } = transport()
    const key = kind === 'oauth' ? 'fixture-go-token' : 'fixture-go-key'
    const adapter = new PiAiAdapter({ profiles: () => profiles, resolveApiKey: () => Promise.resolve(undefined),
      auth: memoryAuth({ 'opencode-go': kind === 'oauth'
        ? { type: 'oauth', access: key, refresh: 'fixture-unused', expires: Date.now() + 3_600_000 }
        : { type: 'api_key', key } }) })
    const assembler = new BlockAssembler()
    for await (const chunk of adapter.stream({ provider: 'opencode-go', model: MODEL, maxTokens: 128,
      sessionId: 'fixture-session' as never, messages: [createUserMessage({
        content: [{ type: 'text', text: 'fixture request' }], source: { kind: 'plugin', plugin: 'fixture' },
      })] })) assembler.push(chunk)
    expect(assembler.finish).toEqual({ kind: 'stop' })
    expect(assembler.message({ kind: 'model', provider: 'opencode-go', model: MODEL }).content)
      .toEqual([{ type: 'text', text: 'fixture reply' }])
    expect(fetcher).toHaveBeenCalledOnce()
    expect(requests[0]?.headers.get('authorization')).toBe(`Bearer ${key}`)
    expect(requests[0]?.headers.get('x-goog-api-key')).toBe(key)
    expect(requests[0]?.headers.get('x-opencode-session')).toBe('fixture-session')
    expect(requests[0]?.headers.get('user-agent')).toBe(userAgent())
    expect(requests[0]?.headers.get('x-model-route')).toBe('fixture-google')
    expect(requests[0]?.body).toMatchObject({ contents: [{ role: 'user', parts: [{ text: 'fixture request' }] }],
      generationConfig: { maxOutputTokens: 128 } })
  })

  it.each(['absent', 'null'] as const)('dispatches the native full stream with User-Agent override %s and removes a model header', async (userAgentOverride) => {
    const models = await accountModels()
    const profile = resolveProfiles({ 'opencode-go': {} }, 'strict', new Map([['opencode-go', models]])).get('opencode-go')!
    const { requests, fetcher } = transport()
    const native = profile.piProvider!.getModels().find(candidate => candidate.id === MODEL) as Model<'google-generative-ai'>
    const model = { ...native, headers: { ...native.headers, 'User-Agent': 'fixture-model-agent' } }
    const result = await profile.piProvider!.stream(model, { messages: [{ role: 'user', content: 'fixture request', timestamp: 0 }] },
      { headers: { Authorization: 'Bearer fixture-full-stream', 'x-model-route': null,
        ...userAgentOverride === 'null' ? { 'uSeR-aGeNt': null } : {},
      } }).result()
    expect(result.stopReason).toBe('stop')
    expect(fetcher).toHaveBeenCalledOnce()
    expect(requests[0]?.headers.get('authorization')).toBe('Bearer fixture-full-stream')
    expect(requests[0]?.headers.get('x-model-route')).toBeNull()
    if (userAgentOverride === 'null') expect(requests[0]?.headers.get('user-agent') ?? '').not.toContain('fixture-model-agent')
    else expect(requests[0]?.headers.get('user-agent')).toContain('fixture-model-agent')
  })

  it('authenticates a direct API-key request without requiring caller headers', async () => {
    const models = await accountModels()
    const profile = resolveProfiles({ 'opencode-go': {} }, 'strict', new Map([['opencode-go', models]])).get('opencode-go')!
    const { requests, fetcher } = transport()
    const model = profile.piProvider!.getModels().find(candidate => candidate.id === MODEL) as Model<'google-generative-ai'>
    const result = await profile.piProvider!.streamSimple(model,
      { messages: [{ role: 'user', content: 'fixture request', timestamp: 0 }] }, { apiKey: 'fixture-direct-key' }).result()
    expect(result.stopReason).toBe('stop')
    expect(fetcher).toHaveBeenCalledOnce()
    expect(requests[0]?.headers.get('authorization')).toBe('Bearer fixture-direct-key')
    expect(requests[0]?.headers.get('x-goog-api-key')).toBe('fixture-direct-key')
  })

  it('refuses missing Go credentials even when a Google ambient key is present', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'unrelated-fixture-google-key')
    const models = await accountModels()
    const profile = resolveProfiles({ 'opencode-go': {} }, 'strict', new Map([['opencode-go', models]])).get('opencode-go')!
    const { fetcher } = transport()
    const model = profile.piProvider!.getModels().find(candidate => candidate.id === MODEL) as Model<'google-generative-ai'>
    expect(() => profile.piProvider!.stream(model, { messages: [] })).toThrow('OpenCode Go requires account sign-in or an API key')
    expect(() => profile.piProvider!.streamSimple(model, { messages: [] })).toThrow('OpenCode Go requires account sign-in or an API key')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('keeps a non-Google full stream on its installed Go implementation', async () => {
    const models = await accountModels()
    const profile = resolveProfiles({ 'opencode-go': {} }, 'strict', new Map([['opencode-go', models]])).get('opencode-go')!
    const fetcher = vi.fn<typeof fetch>((input) => {
      expect(input instanceof Request ? input.url : String(input)).toBe('https://opencode.ai/inference/go/openai/v1/chat/completions')
      const reply = { choices: [{ index: 0, delta: { role: 'assistant', content: 'fixture Flash reply' }, finish_reason: 'stop' }] }
      return Promise.resolve(new Response(`data: ${JSON.stringify(reply)}\n\ndata: [DONE]\n\n`,
        { headers: { 'content-type': 'text/event-stream' } }))
    })
    vi.stubGlobal('fetch', fetcher)
    const model = profile.piProvider!.getModels().find(candidate => candidate.id === 'deepseek-v4.1-flash')!
    const result = await profile.piProvider!.stream(model, { messages: [] }, { apiKey: 'fixture-native-key' }).result()
    expect(result.stopReason).toBe('stop')
    expect(result.content).toEqual([{ type: 'text', text: 'fixture Flash reply' }])
    expect(fetcher).toHaveBeenCalledOnce()
  })
})
