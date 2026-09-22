import { afterEach, describe, expect, it, vi } from 'vitest'
import { discoverModels } from '../src/discovery.ts'

const latest = {
  id: 'grok-4.7',
  context_length: 500_000,
  input_modalities: ['text', 'image'],
  capabilities: { reasoning_effort: ['low', 'medium', 'high', 'xhigh'] },
}

afterEach(() => { vi.unstubAllGlobals() })

function listing(body: unknown = { models: [latest] }, status = 200) {
  const fetch = vi.fn<typeof globalThis.fetch>(async url => new Response(JSON.stringify(
    (typeof url === 'string' ? url : url instanceof URL ? url.href : url.url).endsWith('/language-models') ? body : { data: [latest] },
  ), { status }))
  vi.stubGlobal('fetch', fetch)
  return fetch
}

describe('xAI online model discovery', () => {
  it('fetches new models and capabilities without inheriting the installed catalog output limit', async () => {
    const fetch = listing()
    const result = await discoverModels({ provider: 'xai', refresh: true, apiKey: 'typed-key' })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls.map(call => call[0])).toEqual(['https://api.x.ai/v1/models', 'https://api.x.ai/v1/language-models'])
    expect(result).toEqual([{
      id: 'grok-4.7', name: 'grok-4.7', contextWindow: 500_000,
      inputModalities: ['text', 'image'],
      reasoningEfforts: { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh' },
    }])
  })

  it('keeps the name and context from the model directory when the language entry omits them', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof globalThis.fetch>(async url => new Response(JSON.stringify(
      url === 'https://api.x.ai/v1/models'
        ? { data: [{ id: 'grok-4.7', name: 'Grok 4.7', context_length: 500_000 }, { id: 'image-only' }] }
        : { models: [{ id: 'grok-4.7', input_modalities: ['text', 'image'] }] },
    ))))
    expect(await discoverModels({ provider: 'xai', refresh: true, apiKey: 'key' })).toEqual([
      { id: 'grok-4.7', name: 'Grok 4.7', contextWindow: 500_000, inputModalities: ['text', 'image'] },
    ])
  })

  it('keeps passive page metadata offline', async () => {
    const fetch = listing()
    const result = await discoverModels({ provider: 'xai' })
    expect(result.some(model => model.id === 'grok-4.6')).toBe(true)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('uses the draft endpoint and key ahead of stored credentials', async () => {
    const fetch = listing()
    const resolveApiKey = vi.fn(async () => 'stored-key')
    await discoverModels({ provider: 'xai', refresh: true, baseURL: 'https://gateway.example/v1/', apiKey: 'draft-key' }, () => ({
      headers: { 'x-deployment': 'configured' }, resolveApiKey,
    }))
    expect(resolveApiKey).not.toHaveBeenCalled()
    expect(fetch.mock.calls[0]?.[0]).toBe('https://gateway.example/v1/models')
    const options = fetch.mock.calls[0]?.[1] as RequestInit
    expect(new Headers(options.headers).get('authorization')).toBe('Bearer draft-key')
    expect(new Headers(options.headers).get('x-deployment')).toBe('configured')
  })

  it('reports denied directory access without returning stale installed models', async () => {
    listing({ error: 'denied' }, 403)
    await expect(discoverModels({ provider: 'xai', refresh: true, apiKey: 'key' }))
      .rejects.toThrow(/403/)
  })

  it('preserves missing capabilities as unknown and maps the declared none effort', async () => {
    listing({ models: [{ id: 'bare' }, { id: 'optional', capabilities: { reasoning_effort: ['none', 'high'] } }] })
    expect(await discoverModels({ provider: 'xai', refresh: true, apiKey: 'key' })).toEqual([
      { id: 'bare', name: 'bare' },
      { id: 'optional', name: 'optional', reasoningEfforts: { off: 'none', high: 'high' } },
    ])
  })
})
