/** Account-scoped Go directories retain their declared protocol and current capabilities. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { streamSimple as streamSimpleAnthropic } from '@earendil-works/pi-ai/api/anthropic-messages'
import { streamSimple as streamSimpleCompletions } from '@earendil-works/pi-ai/api/openai-completions'
import type { Model } from '@earendil-works/pi-ai'
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'
import { fetchOpenCodeGoCatalog } from '../src/opencode-go-catalog.ts'
import { readModelDirectory } from '../src/model-directory-http.ts'

vi.mock('../src/model-directory-http.ts', () => ({ readModelDirectory: vi.fn() }))

const read = vi.mocked(readModelDirectory)
const configUrl = 'https://opencode.ai/console/api/v2/config'
const metadataUrl = 'https://models.dev/api.json'

afterEach(() => { vi.resetAllMocks() })

function provider(models: Record<string, unknown> = { 'deepseek-v4.1-flash': {} }) {
  return { package: 'aisdk:@ai-sdk/openai-compatible', settings: { baseURL: 'https://opencode.ai/inference/go/openai/v1' }, models }
}

function metadata(models: Record<string, unknown> = {}) {
  return { 'opencode-go': { npm: '@ai-sdk/openai-compatible', api: 'https://opencode.ai/inference/go/v1', models } }
}

function entry(overrides: Record<string, unknown> = {}) {
  return { name: 'DeepSeek V4.1 Flash', canonical_model_id: 'deepseek/deepseek-v4.1-flash', reasoning: true,
    reasoning_options: [{ type: 'effort', values: ['low', 'high', 'max'] }],
    interleaved: { field: 'reasoning_content' }, limit: { context: 1_000_000, output: 384_000 },
    modalities: { input: ['text', 'image'], output: ['text'] }, cost: { input: 0.15, output: 0.6, cache_read: 0.003 }, ...overrides }
}

function respond(go: unknown, publicModels: unknown = metadata({ 'deepseek-v4.1-flash': entry() })) {
  read.mockImplementation(url => Promise.resolve(url === configUrl ? { providers: { opencode: provider({ 'paid-model': {} }), 'opencode-go': go } } : publicModels))
}

describe('OpenCode Go live catalog', () => {
  it('joins account inventory with fresh capabilities without sending the credential to models.dev', async () => {
    const signal = new AbortController().signal
    const headers = new Headers({ authorization: 'Bearer fixture-access', 'x-org-id': 'fixture-org' })
    respond(provider({ 'deepseek-v4.1-flash': { limit: { context: 500_000 }, capabilities: { input: ['text'] } } }),
      metadata({ 'deepseek-v4.1-flash': entry(), 'not-in-subscription': entry() }))
    const models = await fetchOpenCodeGoCatalog(headers, signal)
    expect(models).toHaveLength(1)
    expect(models[0]).toMatchObject({ id: 'deepseek-v4.1-flash', provider: 'opencode-go', name: 'DeepSeek V4.1 Flash',
      api: 'openai-completions', baseUrl: 'https://opencode.ai/inference/go/openai/v1',
      contextWindow: 500_000, maxTokens: 384_000, input: ['text'], reasoning: true,
      thinkingLevelMap: { off: null, minimal: null, low: 'low', medium: null, high: 'high', xhigh: null, max: 'max' },
      compat: { thinkingFormat: 'deepseek', requiresReasoningContentOnAssistantMessages: true, supportsReasoningEffort: true },
      cost: { input: 0.15, output: 0.6, cacheRead: 0.003, cacheWrite: 0 } })
    expect(read.mock.calls[0]).toEqual([configUrl, headers, signal])
    expect(read.mock.calls[1]?.[0]).toBe(metadataUrl)
    expect([...read.mock.calls[1]![1]]).toEqual([])
    expect(read.mock.calls[1]?.[2]).toBe(signal)
    expect(headers.get('authorization')).toBe('Bearer fixture-access')
  })

  it('keeps mixed protocol overrides and strips Anthropic trailing v1 before SDK path joining', async () => {
    respond(provider({
      'qwen3.8-max': { package: 'aisdk:@ai-sdk/anthropic', settings: { baseURL: 'https://opencode.ai/inference/go/anthropic/v1/' } },
      'gpt-6-luna': { package: 'aisdk:@ai-sdk/openai' },
      'plain-compatible': { package: '@opencode/ai/providers/openai-compatible' },
    }), metadata({
      'qwen3.8-max': entry({ canonical_model_id: 'alibaba/qwen3.8-max', name: 'Qwen3.8 Max', limit: { context: 1_000_000, output: 131_072 } }),
      'gpt-6-luna': entry({ canonical_model_id: 'openai/gpt-6-luna', name: 'GPT-6 Luna', limit: { context: 1_050_000, output: 128_000 },
        reasoning_options: [{ type: 'effort', values: ['none', 'low', 'medium', 'high', 'xhigh', 'max'] }] }),
      'plain-compatible': entry({ canonical_model_id: 'other/new-model' }),
    }))
    const models = await fetchOpenCodeGoCatalog(new Headers())
    expect(models.map(model => [model.id, model.api, model.baseUrl])).toEqual([
      ['qwen3.8-max', 'anthropic-messages', 'https://opencode.ai/inference/go/anthropic'],
      ['gpt-6-luna', 'openai-responses', 'https://opencode.ai/inference/go/openai/v1'],
      ['plain-compatible', 'openai-completions', 'https://opencode.ai/inference/go/openai/v1'],
    ])
    expect(models[1]?.thinkingLevelMap).toMatchObject({ off: 'none', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' })
    expect(models[2]?.compat).toBeUndefined()
  })

  it.each(['aisdk:@ai-sdk/google', '@ai-sdk/google'])('retains Flash when the account directory includes a Google model declared by %s', async (packageName) => {
    respond(provider({
      'deepseek-v4.1-flash': {},
      'gemini-4-argon-contributor': { package: packageName,
        settings: { baseURL: 'https://opencode.ai/inference/go/google/v1beta/' },
        limit: { context: 500_000, output: 32_768 }, capabilities: { input: ['text', 'image'] } },
    }))
    const models = await fetchOpenCodeGoCatalog(new Headers())
    expect(models.map(model => model.id)).toEqual(['deepseek-v4.1-flash', 'gemini-4-argon-contributor'])
    expect(models[0]?.api).toBe('openai-completions')
    expect(models[1]).toMatchObject({ api: 'google-generative-ai',
      baseUrl: 'https://opencode.ai/inference/go/google/v1beta', contextWindow: 500_000,
      maxTokens: 32_768, input: ['text', 'image'], reasoning: false })
  })

  it('rejects an unknown model package instead of guessing from a Gemini model id', async () => {
    respond(provider({ 'gemini-4-argon-contributor': { package: 'aisdk:@ai-sdk/unknown' } }))
    await expect(fetchOpenCodeGoCatalog(new Headers())).rejects.toThrow('unsupported model package')
  })

  it('serializes declared Anthropic reasoning effort instead of silently substituting a token budget', async () => {
    respond(provider({ 'qwen3.8-max': { package: 'aisdk:@ai-sdk/anthropic', settings: { baseURL: 'https://opencode.ai/inference/go/anthropic/v1' } } }),
      metadata({ 'qwen3.8-max': entry({ canonical_model_id: 'alibaba/qwen3.8-max',
        reasoning_options: [{ type: 'toggle' }, { type: 'effort', values: ['low', 'medium', 'xhigh'] }],
        limit: { context: 1_000_000, output: 131_072 } }) }))
    const [model] = await fetchOpenCodeGoCatalog(new Headers())
    expect(model?.api).toBe('anthropic-messages')
    let body: Record<string, unknown> | undefined
    let url: string | undefined
    const fetcher = vi.fn<typeof fetch>((input, init) => {
      url = input instanceof Request ? input.url : String(input)
      if (typeof init?.body !== 'string') throw new Error('fixture expected serialized JSON')
      body = JSON.parse(init.body) as Record<string, unknown>
      const events = [
        { type: 'message_start', message: { id: 'fixture', type: 'message', role: 'assistant', model: 'qwen3.8-max',
          content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 0 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'fixture reply' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } },
        { type: 'message_stop' },
      ]
      return Promise.resolve(new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''),
        { headers: { 'content-type': 'text/event-stream' } }))
    })
    const stream = streamSimpleAnthropic(model as Model<'anthropic-messages'>,
      { messages: [{ role: 'user', content: 'fixture request', timestamp: 0 }] },
      { apiKey: 'fixture-api-key', fetch: fetcher, reasoning: 'xhigh', maxTokens: 4096 })
    expect((await stream.result()).stopReason).toBe('stop')
    expect(new URL(url!).origin).toBe('https://opencode.ai')
    expect(new URL(url!).pathname).toBe('/inference/go/anthropic/v1/messages')
    expect(body?.['thinking']).toMatchObject({ type: 'adaptive' })
    expect(body?.['output_config']).toEqual({ effort: 'xhigh' })
    expect(body?.['thinking']).not.toHaveProperty('budget_tokens')
  })

  it('recognizes a canonical Go provider alias and sends an explicit wire model id', async () => {
    read.mockImplementation(url => Promise.resolve(url === configUrl ? { providers: {
      'workspace-go': { ...provider({ friendly: { modelID: 'endpoint-model', name: 'Workspace Model' } }), canonical: 'opencode-go' },
    } } : metadata({ friendly: entry() })))
    const [model] = await fetchOpenCodeGoCatalog(new Headers())
    expect(model).toMatchObject({ id: 'endpoint-model', name: 'Workspace Model', contextWindow: 1_000_000, reasoning: true })
  })

  it('sends DeepSeek thinking controls and replays reasoning content on the next native SDK request', async () => {
    respond(provider())
    const [model] = await fetchOpenCodeGoCatalog(new Headers())
    expect(model?.api).toBe('openai-completions')
    const bodies: Record<string, unknown>[] = []
    const fetcher = vi.fn<typeof fetch>((input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      expect(url.pathname).toBe('/inference/go/openai/v1/chat/completions')
      if (typeof init?.body !== 'string') throw new Error('fixture expected serialized JSON')
      bodies.push(JSON.parse(init.body) as Record<string, unknown>)
      const chunks = [
        { choices: [{ index: 0, delta: { role: 'assistant', reasoning_content: 'fixture thinking' }, finish_reason: null }] },
        { choices: [{ index: 0, delta: { content: 'fixture reply' }, finish_reason: null }] },
        { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } },
      ]
      return Promise.resolve(new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n',
        { headers: { 'content-type': 'text/event-stream' } }))
    })
    const native = model as Model<'openai-completions'>
    const user = { role: 'user' as const, content: 'fixture request', timestamp: 0 }
    const options = { apiKey: 'fixture-api-key', fetch: fetcher, reasoning: 'high' as const, maxTokens: 4096 }
    const first = await streamSimpleCompletions(native, { messages: [user] }, options).result()
    expect(first.stopReason).toBe('stop')
    expect((await streamSimpleCompletions(native, { messages: [user, first,
      { role: 'user', content: 'fixture follow-up', timestamp: 1 }] }, options).result()).stopReason).toBe('stop')
    expect(bodies[0]).toMatchObject({ model: 'deepseek-v4.1-flash', thinking: { type: 'enabled' }, reasoning_effort: 'high', max_tokens: 4096 })
    expect(bodies[1]?.['messages']).toContainEqual({ role: 'assistant', content: 'fixture reply', reasoning_content: 'fixture thinking' })
  })

  it('uses Console capacities for an unknown new model and does not invent reasoning levels', async () => {
    respond(provider({ 'brand-new': { limit: { context: 100_000, output: 20_000 }, capabilities: { input: ['text', 'image'] } } }), metadata())
    expect(await fetchOpenCodeGoCatalog(new Headers())).toMatchObject([{ id: 'brand-new', contextWindow: 100_000,
      maxTokens: 20_000, input: ['text', 'image'], reasoning: false }])
  })

  it('withholds every selectable effort when a new reasoning model discloses none', async () => {
    respond(provider(), metadata({ 'deepseek-v4.1-flash': entry({ reasoning_options: undefined }) }))
    const [model] = await fetchOpenCodeGoCatalog(new Headers())
    expect(model?.reasoning).toBe(true)
    expect(model?.thinkingLevelMap).toEqual({ off: null, minimal: null, low: null, medium: null,
      high: null, xhigh: null, max: null })
  })

  it('retains detached same-protocol SDK efforts and capacities when public metadata omits the model', async () => {
    const native = getBuiltinModels('opencode-go').find(model => model.api === 'openai-completions'
      && model.reasoning && model.thinkingLevelMap !== undefined)
    if (native === undefined) throw new Error('the installed Go catalog ships no completions reasoning map')
    respond(provider({ [native.id]: {} }), metadata())
    const [model] = await fetchOpenCodeGoCatalog(new Headers())
    expect(model).toMatchObject({ id: native.id, reasoning: true, contextWindow: native.contextWindow,
      maxTokens: native.maxTokens, input: native.input, cost: native.cost, thinkingLevelMap: native.thinkingLevelMap })
    expect(model?.thinkingLevelMap).not.toBe(native.thinkingLevelMap)
  })

  it('ignores null and unknown effort names while retaining disclosed supported efforts', async () => {
    respond(provider(), metadata({ 'deepseek-v4.1-flash': entry({
      reasoning_options: [{ type: 'effort', values: [null, 'future-effort', 'high'] }],
    }) }))
    const [model] = await fetchOpenCodeGoCatalog(new Headers())
    expect(model?.thinkingLevelMap).toEqual({ off: null, minimal: null, low: null, medium: null,
      high: 'high', xhigh: null, max: null })
  })

  it('accepts an authoritative empty account inventory without fetching public metadata', async () => {
    respond(provider({}))
    expect(await fetchOpenCodeGoCatalog(new Headers())).toEqual([])
    expect(read).toHaveBeenCalledExactlyOnceWith(configUrl, expect.any(Headers), undefined)
  })

  it.each([
    ['Console response', null],
    ['Console response', []],
    ['Console providers', {}],
    ['Go provider', { providers: { 'opencode-go': [] } }],
    ['Go models', { providers: { 'opencode-go': {} } }],
  ])('rejects malformed %s before reading public metadata', async (field, response) => {
    read.mockResolvedValueOnce(response)
    await expect(fetchOpenCodeGoCatalog(new Headers())).rejects.toThrow(`OpenCode Go directory: invalid ${field}`)
    expect(read).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['reasoning capability', { reasoning: 'true' }],
    ['reasoning options', { reasoning_options: {} }],
    ['reasoning option', { reasoning_options: [null] }],
    ['reasoning effort values', { reasoning_options: [{ type: 'effort', values: 'high' }] }],
    ['reasoning effort values', { reasoning_options: [{ type: 'effort', values: [42] }] }],
    ['model cost', { cost: { input: -1 } }],
    ['model cost', { cost: { input: Infinity } }],
    ['model cost', { cost: { input: '0.15' } }],
  ] as const)('rejects malformed public %s instead of installing its model', async (field, changes) => {
    respond(provider(), metadata({ 'deepseek-v4.1-flash': entry(changes) }))
    await expect(fetchOpenCodeGoCatalog(new Headers())).rejects.toThrow(`OpenCode Go directory: invalid ${field}`)
  })

  it.each([
    ['input modalities', { capabilities: { input: 'text' } }],
    ['input modalities', { capabilities: { input: ['text', 42] } }],
    ['model header value', { headers: { 'x-model-route': 42 } }],
    ['model header', { headers: { 'invalid header name': 'fixture' } }],
    ['model header', { headers: { 'x-model-route': 'fixture\ninjected' } }],
    ['Go endpoint', { settings: { baseURL: 'not a URL' } }],
  ] as const)('rejects malformed account %s instead of installing its model', async (field, changes) => {
    respond(provider({ 'deepseek-v4.1-flash': changes }))
    await expect(fetchOpenCodeGoCatalog(new Headers())).rejects.toThrow(`OpenCode Go directory: invalid ${field}`)
  })

  it('does not classify Kimi or GLM reasoning-content streams as DeepSeek request dialects', async () => {
    respond(provider({ kimi: {}, glm: {} }), metadata({
      kimi: entry({ canonical_model_id: 'moonshotai/kimi-k3' }),
      glm: entry({ canonical_model_id: 'zhipuai/glm-5.3' }),
    }))
    for (const model of await fetchOpenCodeGoCatalog(new Headers())) expect(model.compat).toBeUndefined()
  })

  it('omits disabled models and credential-bearing response settings and headers', async () => {
    respond({ ...provider({ 'deepseek-v4.1-flash': { settings: { apiKey: 'fixture-model-key' },
      headers: { authorization: 'Bearer fixture-model-key', 'x-goog-api-key': 'fixture-model-key', 'x-org-id': 'fixture-org' } }, hidden: { disabled: true } }),
    headers: { 'x-api-key': 'fixture-provider-key', 'X-Org-ID': 'provider-org' }, settings: { baseURL: 'https://opencode.ai/inference/go/v1', apiKey: 'fixture-provider-key' } })
    const models = await fetchOpenCodeGoCatalog(new Headers())
    expect(models).toHaveLength(1)
    expect(models[0]?.headers).toEqual({ 'x-org-id': 'fixture-org' })
    expect(JSON.stringify(models)).not.toContain('fixture-model-key')
    expect(JSON.stringify(models)).not.toContain('fixture-provider-key')
  })

  it.each(['http://opencode.ai/inference/go/v1', 'https://opencode.ai/inference/openai/v1',
    'https://elsewhere.test/inference/go/v1', 'https://opencode.ai/inference/gopher/v1',
    'https://opencode.ai/inference/go/../../openai/v1', 'https://opencode.ai/inference/go/%2fopenai/v1',
    'https://user:password@opencode.ai/inference/go/v1', 'https://opencode.ai/inference/go/v1?api_key=fixture'])
  ('rejects an endpoint leaving the Go authority: %s', async (baseURL) => {
    respond({ ...provider(), settings: { baseURL } })
    await expect(fetchOpenCodeGoCatalog(new Headers())).rejects.toThrow('Go endpoint')
  })

  it('rejects paid-only workspaces, conflicting canonical identity, and ambiguous Go providers', async () => {
    for (const providers of [{ opencode: provider() }, { 'opencode-go': { ...provider(), canonical: 'opencode' } },
      { a: { ...provider(), canonical: 'opencode-go' }, b: { ...provider(), canonical: 'opencode-go' } }]) {
      read.mockResolvedValueOnce({ providers })
      await expect(fetchOpenCodeGoCatalog(new Headers())).rejects.toThrow()
    }
    expect(read).toHaveBeenCalledTimes(3)
  })

  it.each([{ limit: { context: 0 } }, { limit: { context: null } }, { capabilities: { input: ['audio'] } },
    { package: 'unknown-package' }, { package: null }, { modelID: '' }, { modelID: null }, { disabled: 'false' }])
  ('rejects invalid consumed account fields %j', async (model) => {
    respond(provider({ 'deepseek-v4.1-flash': model }))
    await expect(fetchOpenCodeGoCatalog(new Headers())).rejects.toThrow('OpenCode Go directory')
  })

  it('rejects duplicate wire ids and propagates cancellation before reading credentials', async () => {
    respond(provider({ a: { modelID: 'deepseek-v4.1-flash' }, b: { modelID: 'deepseek-v4.1-flash' } }))
    await expect(fetchOpenCodeGoCatalog(new Headers())).rejects.toThrow('duplicate wire model id')
    read.mockClear()
    const controller = new AbortController()
    controller.abort(new Error('fixture cancelled'))
    await expect(fetchOpenCodeGoCatalog(new Headers(), controller.signal)).rejects.toThrow('fixture cancelled')
    expect(read).not.toHaveBeenCalled()
  })
})
