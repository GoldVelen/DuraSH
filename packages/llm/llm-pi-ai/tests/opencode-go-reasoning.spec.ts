/** Account reasoning metadata remains usable through the model selector's exact-info validation. */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { PiAiAdapter } from '../src/adapter.ts'
import { resolveProfiles } from '../src/config.ts'
import { fetchOpenCodeGoCatalog } from '../src/opencode-go-catalog.ts'
import { memoryAuth } from './auth-double.ts'

const KIMI = 'kimi-k2.7-code'
const FLASH = 'deepseek-v4.1-flash'
const contexts: Context[] = []

afterEach(async () => { await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose())) })

/** Public models.dev metadata: reasoning capability with no selectable effort. */
const kimiMetadata = {
  name: 'Kimi K2.7 Code', reasoning: true, reasoning_options: [],
  modalities: { input: ['text', 'image', 'video'], output: ['text'] },
  limit: { context: 262_144, output: 262_144 },
  canonical_model_id: 'moonshotai/kimi-k2.7-code', interleaved: { field: 'reasoning_content' },
}

/** Materialize the actual directory parser and register its adapter in the core runtime. */
async function runtime(metadata: Record<string, unknown> = kimiMetadata, subject = KIMI,
  routing: { package: string; baseURL: string } = {
    package: 'aisdk:@ai-sdk/openai-compatible', baseURL: 'https://opencode.ai/inference/go/openai/v1',
  }) {
  const models = await fetchOpenCodeGoCatalog(new Headers(), undefined, url => Promise.resolve(
    url === 'https://opencode.ai/console/api/v2/config' ? { providers: { 'opencode-go': {
      package: 'aisdk:@ai-sdk/openai-compatible', settings: { baseURL: 'https://opencode.ai/inference/go/openai/v1' },
      models: {
        [subject]: { package: routing.package, settings: { baseURL: routing.baseURL },
          limit: { context: 262_144, output: 262_144 }, capabilities: { input: ['text', 'image'] } },
        [FLASH]: { limit: { context: 1_000_000, output: 384_000 }, capabilities: { input: ['text', 'image'] } },
      },
    } } } : { 'opencode-go': { models: {
      [subject]: metadata,
      [FLASH]: { name: 'DeepSeek V4.1 Flash', reasoning: true,
        reasoning_options: [{ type: 'effort', values: ['low', 'high', 'max'] }],
        canonical_model_id: 'deepseek/deepseek-v4.1-flash' },
    } } },
  ))
  const profiles = resolveProfiles({ 'opencode-go': { modelCatalogMode: 'live' } }, 'strict', new Map([['opencode-go', models]]))
  const adapter = new PiAiAdapter({ profiles: () => profiles, resolveApiKey: () => Promise.resolve(undefined), auth: memoryAuth() })
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  ctx.llm.registerAdapter(['opencode-go'], adapter)
  return { ctx, adapter, models }
}

describe('OpenCode Go reasoning metadata through the core model catalog', () => {
  it('keeps Kimi and Flash selectable when Kimi reasons without an effort control', async () => {
    const { ctx, adapter, models } = await runtime()
    const info = await Promise.all((await ctx.llm.listModels('opencode-go'))
      .map(model => ctx.llm.resolveModelInfo('opencode-go', model.id)))
    expect(info.map(model => model.id)).toEqual([KIMI, FLASH])
    expect(models.find(model => model.id === KIMI)?.reasoning).toBe(true)
    expect(info.find(model => model.id === KIMI)?.reasoning).toBeUndefined()
    expect((await adapter.resolveModel('opencode-go', KIMI)).reasoning).toBeUndefined()
    expect(info.find(model => model.id === FLASH)?.reasoning?.efforts.map(effort => effort.id)).toEqual(['low', 'high', 'max'])
  })

  it.each([
    { id: 'longcat-2.0', options: [{ type: 'toggle' }],
      package: 'aisdk:@ai-sdk/openai-compatible', baseURL: 'https://opencode.ai/inference/go/openai/v1' },
    { id: 'qwen3.7-plus', options: [{ type: 'toggle' }, { type: 'budget_tokens', max: 262_144 }],
      package: 'aisdk:@ai-sdk/anthropic', baseURL: 'https://opencode.ai/inference/go/anthropic/v1' },
  ])('keeps $id selectable without inventing efforts from its toggle or budget control', async (subject) => {
    const { ctx, models } = await runtime({ reasoning: true, reasoning_options: subject.options }, subject.id, subject)
    const info = await Promise.all((await ctx.llm.listModels('opencode-go'))
      .map(model => ctx.llm.resolveModelInfo('opencode-go', model.id)))
    expect(info.map(model => model.id)).toEqual([subject.id, FLASH])
    expect(models.find(model => model.id === subject.id)?.reasoning).toBe(true)
    expect(info.find(model => model.id === subject.id)?.reasoning).toBeUndefined()
    expect(info.find(model => model.id === FLASH)?.reasoning?.efforts.map(effort => effort.id)).toEqual(['low', 'high', 'max'])
  })

  it('rejects an explicit unsupported effort while retaining the Kimi model and provider default', async () => {
    const { ctx } = await runtime()
    const config = { provider: 'opencode-go', model: KIMI }
    expect((await ctx.llm.prepareCall(config)).config.reasoningEffort).toBeUndefined()
    await expect(ctx.llm.prepareCall({ ...config, reasoningEffort: ReasoningEffortId('high') }))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_REASONING_EFFORT' })
    expect((await ctx.llm.listModels('opencode-go')).map(model => model.id)).toEqual([KIMI, FLASH])
  })
})
