import { afterEach, describe, expect, it, vi } from 'vitest'
import { discoverModels } from '../src/discovery.ts'

const token = `e30.${Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'fixture-account' } })).toString('base64url')}.signature`
const latest = {
  slug: 'codex-directory-fixture', display_name: 'Codex Directory Fixture', visibility: 'list', context_window: 272_000,
  input_modalities: ['text', 'image'],
  supported_reasoning_levels: [{ effort: 'low' }, { effort: 'xhigh' }, { effort: 'max' }],
}

afterEach(() => { vi.unstubAllGlobals() })

function listing(body: unknown = { models: [latest] }, status = 200) {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', fetch)
  return fetch
}

describe('Codex online model discovery', () => {
  it('fetches subscription models outside the installed catalog with their declared capabilities', async () => {
    const fetch = listing()
    const resolveNativeAuth = vi.fn(async () => ({ apiKey: token }))
    const result = await discoverModels({ provider: 'openai-codex', refresh: true }, () => ({
      headers: undefined, resolveApiKey: async () => undefined, resolveNativeAuth,
    }))
    expect(resolveNativeAuth).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledOnce()
    const url = new URL(fetch.mock.calls[0]![0] as string)
    expect(url.origin + url.pathname).toBe('https://chatgpt.com/backend-api/codex/models')
    expect(url.searchParams.get('client_version')).toMatch(/^\d+\.\d+\.\d+$/)
    const headers = new Headers(fetch.mock.calls[0]![1]?.headers)
    expect(headers.get('authorization')).toBe(`Bearer ${token}`)
    expect(headers.get('chatgpt-account-id')).toBe('fixture-account')
    expect(result).toEqual([{
      id: 'codex-directory-fixture', name: 'Codex Directory Fixture', contextWindow: 272_000, inputModalities: ['text', 'image'],
      reasoningEfforts: { low: 'low', xhigh: 'xhigh', max: 'max' },
    }])
  })

  it('keeps passive metadata offline', async () => {
    const fetch = listing()
    expect((await discoverModels({ provider: 'openai-codex' })).length).toBeGreaterThan(0)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('reads a new directory on each refresh and accepts an already suffixed draft endpoint', async () => {
    const fetch = listing()
    const request = {
      provider: 'openai-codex', refresh: true, baseURL: 'https://gateway.example/codex/', apiKey: token,
    }
    await discoverModels(request)
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ models: [{ ...latest, slug: 'gpt-6-luna' }] })))
    expect((await discoverModels(request)).map(model => model.id)).toEqual(['gpt-6-luna'])
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls[1]![0]).toMatch(/^https:\/\/gateway.example\/codex\/models\?/)
  })

  it('forwards cancellation to subscription resolution and directory requests', async () => {
    const fetch = listing()
    const controller = new AbortController()
    const resolveNativeAuth = vi.fn(async () => ({ apiKey: token }))
    await discoverModels({ provider: 'openai-codex', refresh: true, signal: controller.signal }, () => ({
      headers: undefined, resolveApiKey: async () => undefined, resolveNativeAuth,
    }))
    expect(resolveNativeAuth).toHaveBeenCalledWith(controller.signal)
    expect(fetch.mock.calls[0]![1]?.signal).toBe(controller.signal)
    controller.abort()
    fetch.mockRejectedValueOnce(controller.signal.reason)
    await expect(discoverModels({ provider: 'openai-codex', refresh: true, apiKey: token, signal: controller.signal }))
      .rejects.toMatchObject({ code: 'ABORTED' })
  })

  it('uses an aliased stored route and draft token without refreshing its stored grant', async () => {
    const fetch = listing()
    const resolveApiKey = vi.fn(async () => 'unused')
    const resolveNativeAuth = vi.fn(async () => ({ apiKey: 'unused' }))
    await discoverModels({ provider: 'my-codex', refresh: true, apiKey: token }, () => ({
      catalogProvider: 'openai-codex', baseURL: 'https://gateway.example/backend-api/',
      headers: { 'x-deployment': 'fixture' }, resolveApiKey, resolveNativeAuth,
    }))
    expect(fetch.mock.calls[0]![0]).toMatch(/^https:\/\/gateway.example\/backend-api\/codex\/models\?/)
    expect(new Headers(fetch.mock.calls[0]![1]?.headers).get('x-deployment')).toBe('fixture')
    expect(resolveApiKey).not.toHaveBeenCalled()
    expect(resolveNativeAuth).not.toHaveBeenCalled()
  })

  it('omits hidden and malformed entries without requiring public API availability', async () => {
    listing({ models: [null, 3, {}, { ...latest, visibility: 'hide' }, {
      slug: 'subscription-only', visibility: 'list', supported_in_api: false,
      supported_reasoning_levels: [{ effort: 'none' }, { effort: 'future-level' }, null],
    }] })
    expect(await discoverModels({ provider: 'openai-codex', refresh: true, apiKey: token })).toEqual([
      { id: 'subscription-only', name: 'subscription-only' },
    ])
  })

  it.each([{}, { models: {} }, null])('rejects malformed directories instead of returning installed models: %j', async (body) => {
    listing(body)
    await expect(discoverModels({ provider: 'openai-codex', refresh: true, apiKey: token }))
      .rejects.toMatchObject({ code: 'DISCOVERY_FAILED' })
  })

  it('reports denied access without returning the old list', async () => {
    listing({}, 403)
    await expect(discoverModels({ provider: 'openai-codex', refresh: true, apiKey: token })).rejects.toThrow(/403/)
  })

  it('requires subscription authentication before fetching', async () => {
    const fetch = listing()
    await expect(discoverModels({ provider: 'openai-codex', refresh: true }))
      .rejects.toMatchObject({ code: 'MISSING_CREDENTIAL' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['not-a-token', 'e30.bnVsbA.signature', 'e30.e30.signature'])('rejects unusable account tokens without disclosing them: %s', async (apiKey) => {
    const fetch = listing()
    const failure = await discoverModels({ provider: 'openai-codex', refresh: true, apiKey })
      .catch((error: unknown) => error)
    expect(failure).toMatchObject({ code: 'INVALID_CREDENTIAL' })
    expect(String(failure)).not.toContain(apiKey)
    expect(fetch).not.toHaveBeenCalled()
  })
})
