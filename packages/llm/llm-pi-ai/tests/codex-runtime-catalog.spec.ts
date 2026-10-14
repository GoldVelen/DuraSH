/** Runtime Codex metadata reaches the installed SDK without an installed-model or client-version gate. */

import { zstdDecompressSync } from 'node:zlib'
import { afterEach, expect, it, vi } from 'vitest'
import type { Model } from '@earendil-works/pi-ai'
import { BlockAssembler, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { PiAiAdapter } from '../src/adapter.ts'
import { catalogModels } from '../src/catalog.ts'
import { resolveProfiles } from '../src/config.ts'
import { memoryAuth } from './auth-double.ts'

afterEach(() => { vi.unstubAllGlobals() })

it('sends a new gpt-6.1-sol with 500k context and max effort through native Codex SSE without a stale client version', async () => {
  const token = `e30.${Buffer.from(JSON.stringify({
    'https://api.openai.com/auth': { chatgpt_account_id: 'fixture-account' },
  })).toString('base64url')}.fixture-signature`
  const model: Model<'openai-codex-responses'> = {
    id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', provider: 'openai-codex', api: 'openai-codex-responses',
    baseUrl: 'https://chatgpt.com/backend-api', contextWindow: 500_000, maxTokens: 32_768, input: ['text', 'image'],
    reasoning: true,
    thinkingLevelMap: { off: null, minimal: null, low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' },
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  }
  const profiles = resolveProfiles({ 'openai-codex': { transport: 'sse' } }, 'strict',
    new Map([['openai-codex', [model]]]))
  expect(catalogModels('openai-codex').has(model.id)).toBe(false)
  expect(profiles.get('openai-codex')?.piProvider?.getModels()).toEqual([model])
  let body: unknown
  let headers: Headers | undefined
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    expect(input instanceof Request ? input.url : String(input)).toBe('https://chatgpt.com/backend-api/codex/responses')
    expect(init?.method).toBe('POST')
    headers = new Headers(init?.headers)
    const wire = init?.body
    if (typeof wire === 'string') body = JSON.parse(wire)
    else if (wire instanceof Uint8Array) {
      body = JSON.parse((headers.get('content-encoding') === 'zstd'
        ? zstdDecompressSync(wire) : Buffer.from(wire)).toString('utf8'))
    } else throw new Error('fixture did not receive a serialized native Codex request')
    const message = {
      type: 'message', id: 'fixture-message', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: 'fixture reply', annotations: [] }],
    }
    const events = [
      { type: 'response.created', response: { id: 'fixture-response' } },
      { type: 'response.output_item.added', output_index: 0, item: { ...message, status: 'in_progress', content: [] } },
      { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: 'fixture reply' },
      { type: 'response.output_item.done', output_index: 0, item: message },
      { type: 'response.completed', response: {
        id: 'fixture-response', status: 'completed', output: [message],
        usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 },
      } },
    ]
    return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''),
      { headers: { 'content-type': 'text/event-stream' } })
  })
  vi.stubGlobal('fetch', fetch)
  const adapter = new PiAiAdapter({
    profiles: () => profiles,
    resolveApiKey: () => Promise.resolve(undefined),
    auth: memoryAuth({ 'openai-codex': {
      type: 'oauth', access: token, refresh: 'fixture-refresh', expires: Date.now() + 3_600_000,
    } }),
  })
  const assembler = new BlockAssembler()
  for await (const chunk of adapter.stream({
    provider: 'openai-codex', model: model.id, messages: [], reasoningEffort: ReasoningEffortId('max'),
  })) assembler.push(chunk)
  expect(assembler.finish).toEqual({ kind: 'stop' })
  expect(assembler.message({ kind: 'model', provider: 'openai-codex', model: model.id }).content)
    .toEqual([{ type: 'text', text: 'fixture reply' }])
  expect(body).toMatchObject({ model: 'gpt-6.1-sol', reasoning: { effort: 'max' }, store: false, stream: true })
  expect(body).not.toHaveProperty('client_version')
  expect(headers?.get('chatgpt-account-id')).toBe('fixture-account')
  expect(headers?.get('originator')).toBe('pi')
  for (const name of ['version', 'client_version', 'x-codex-client-version']) expect(headers?.get(name)).toBeNull()
  expect(fetch).toHaveBeenCalledOnce()
})
