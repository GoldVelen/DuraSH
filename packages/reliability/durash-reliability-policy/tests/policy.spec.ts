import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import {
  Config as storageDomainConfig,
  apply as storageDomainApply,
  inject as storageDomainInject,
  name as storageDomainName,
} from '@deepseek-ai/dsh-storage-domain'
import {
  Config as storageJsonConfig,
  apply as storageJsonApply,
  inject as storageJsonInject,
  name as storageJsonName,
} from '@deepseek-ai/dsh-storage-json'
import { SessionId } from '@deepseek-ai/dsh-session'
import ReliabilityPolicyService, { parseLaneSelector, reliabilityPolicyDomainSpec } from '../src/index.ts'
import type { ReliabilityPolicyRow } from '../src/index.ts'
import type { LlmModelInfo, LlmProviderInfo } from '@deepseek-ai/dsh-llm/types'

const roots: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(async (ctx) => { await ctx.fiber.dispose() }))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function fakeLlm(providers: LlmProviderInfo[], models: Record<string, LlmModelInfo[]>) {
  return {
    listProviders: () => providers,
    listModels: async (provider: string) => models[provider] ?? [],
  }
}

async function harness(llm = fakeLlm(
  [{ id: 'deepseek-official', name: 'DeepSeek' }],
  {
    'deepseek-official': [
      { provider: 'deepseek-official', id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
      { provider: 'deepseek-official', id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
    ],
  },
)): Promise<{ ctx: Context; policy: ReliabilityPolicyService }> {
  const root = await mkdtemp(join(tmpdir(), 'durash-reliability-policy-'))
  roots.push(root)
  const ctx = new Context()
  contexts.push(ctx)
  ctx.provide('llm', llm)
  await ctx.plugin(Storage)
  await ctx.plugin({ name: storageJsonName, inject: storageJsonInject, apply: storageJsonApply, Config: storageJsonConfig }, { root })
  await ctx.plugin({ name: storageDomainName, inject: storageDomainInject, apply: storageDomainApply, Config: storageDomainConfig }, { backend: 'json' })
  await ctx.plugin(ReliabilityPolicyService)
  return { ctx, policy: ctx.reliabilityPolicy }
}

async function seededHarness(
  row: ReliabilityPolicyRow,
  llm = fakeLlm(
    [{ id: 'deepseek-official', name: 'DeepSeek' }],
    { 'deepseek-official': [{ provider: 'deepseek-official', id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' }] },
  ),
): Promise<{ ctx: Context; policy: ReliabilityPolicyService }> {
  const root = await mkdtemp(join(tmpdir(), 'durash-reliability-policy-seeded-'))
  roots.push(root)
  const ctx = new Context()
  contexts.push(ctx)
  ctx.provide('llm', llm)
  await ctx.plugin(Storage)
  await ctx.plugin({ name: storageJsonName, inject: storageJsonInject, apply: storageJsonApply, Config: storageJsonConfig }, { root })
  await ctx.plugin({ name: storageDomainName, inject: storageDomainInject, apply: storageDomainApply, Config: storageDomainConfig }, { backend: 'json' })
  const domain = await ctx.storageDomain.open(reliabilityPolicyDomainSpec)
  await domain.table('sessions').put(row.sessionId, row)
  await domain.close()
  await ctx.plugin(ReliabilityPolicyService)
  return { ctx, policy: ctx.reliabilityPolicy }
}

const SESSION = SessionId('session-workflow')

describe('durash-reliability-policy', () => {
  it('starts disabled with an empty catalog snapshot', async () => {
    const { policy } = await harness()
    const snapshot = await policy.policy({ sessionId: SESSION })
    expect(snapshot.enabled).toBe(false)
    expect(snapshot.implementationModel).toBeNull()
    expect(snapshot.models.map(model => model.selector)).toEqual([
      'deepseek-official/deepseek-v4-pro',
      'deepseek-official/deepseek-v4-flash',
    ])
    expect(policy.workflowEnabled(SESSION)).toBe(false)
    expect(policy.enabledRoutes(SESSION)).toBeUndefined()
  })

  it('ensurePolicy fills default selectors from the first catalog model', async () => {
    const { policy } = await harness()
    const snapshot = await policy.ensurePolicy({ sessionId: SESSION })
    expect(snapshot.implementationModel).toBe('deepseek-official/deepseek-v4-pro')
    expect(snapshot.reviewModel).toBe('deepseek-official/deepseek-v4-pro')
    expect(snapshot.enabled).toBe(false)
  })

  it('configure enables only when both lanes name catalog models', async () => {
    const { policy } = await harness()
    await expect(policy.configure({
      sessionId: SESSION,
      enabled: true,
      implementationModel: null,
      implementationThinking: 'high',
      reviewModel: 'deepseek-official/deepseek-v4-flash',
      reviewThinking: 'xhigh',
    })).rejects.toThrow(/select both implementation and review models/)

    await expect(policy.configure({
      sessionId: SESSION,
      enabled: true,
      implementationModel: 'deepseek-official/missing',
      implementationThinking: 'high',
      reviewModel: 'deepseek-official/deepseek-v4-flash',
      reviewThinking: 'xhigh',
    })).rejects.toThrow(/implementation model .* is not in the current catalog/)

    await expect(policy.configure({
      sessionId: SESSION,
      enabled: true,
      implementationModel: 'deepseek-official/deepseek-v4-pro',
      implementationThinking: 'high',
      reviewModel: 'deepseek-official/missing',
      reviewThinking: 'xhigh',
    })).rejects.toThrow(/review model .* is not in the current catalog/)

    const snapshot = await policy.configure({
      sessionId: SESSION,
      enabled: true,
      implementationModel: 'deepseek-official/deepseek-v4-pro',
      implementationThinking: 'high',
      reviewModel: 'deepseek-official/deepseek-v4-flash',
      reviewThinking: 'xhigh',
    })
    expect(snapshot.enabled).toBe(true)
    expect(policy.workflowEnabled(SESSION)).toBe(true)
    expect(policy.enabledRoutes(SESSION)).toEqual({
      implementation: { provider: 'deepseek-official', model: 'deepseek-v4-pro' },
      review: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    })
  })

  it('keeps a disabled partial row off and fills only its missing defaults', async () => {
    const { policy } = await harness()
    await policy.configure({
      sessionId: SESSION,
      enabled: false,
      implementationModel: null,
      implementationThinking: 'minimal',
      reviewModel: 'deepseek-official/deepseek-v4-flash',
      reviewThinking: 'low',
    })
    expect(policy.enabledRoutes(SESSION)).toBeUndefined()
    const snapshot = await policy.ensurePolicy({ sessionId: SESSION })
    expect(snapshot).toMatchObject({
      enabled: false,
      implementationModel: 'deepseek-official/deepseek-v4-pro',
      implementationThinking: 'minimal',
      reviewModel: 'deepseek-official/deepseek-v4-flash',
      reviewThinking: 'low',
    })

    const reviewMissing = SessionId('session-review-missing')
    await policy.configure({
      sessionId: reviewMissing,
      enabled: false,
      implementationModel: 'deepseek-official/deepseek-v4-flash',
      implementationThinking: 'minimal',
      reviewModel: null,
      reviewThinking: 'low',
    })
    expect(await policy.ensurePolicy({ sessionId: reviewMissing })).toMatchObject({
      implementationModel: 'deepseek-official/deepseek-v4-flash',
      reviewModel: 'deepseek-official/deepseek-v4-pro',
    })
  })

  it('returns an unpersisted baseline when an empty catalog has no defaults', async () => {
    const { policy } = await harness(fakeLlm([], {}))
    const snapshot = await policy.ensurePolicy({ sessionId: SESSION })
    expect(snapshot).toMatchObject({
      revision: 0,
      enabled: false,
      implementationModel: null,
      reviewModel: null,
    })
    expect(await policy.policy({ sessionId: SESSION })).toMatchObject({ revision: 0, updatedAt: 0 })
  })

  it('fills defaults from the public reliability effort roster even when the catalog has one model', async () => {
    const { policy } = await harness({
      listProviders: () => [{ id: 'provider', name: 'Provider' }],
      listModels: async () => [{
        provider: 'provider',
        id: 'model',
        name: 'Model',
      }],
    })
    expect(await policy.ensurePolicy({ sessionId: SESSION })).toMatchObject({
      implementationModel: 'provider/model',
      implementationThinking: 'high',
      reviewModel: 'provider/model',
      reviewThinking: 'xhigh',
      models: [{
        selector: 'provider/model',
        thinkingLevels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
      }],
    })
  })

  it('continues a Session queue after a public configure rejection', async () => {
    const { policy } = await harness()
    await expect(policy.configure({
      sessionId: SESSION,
      enabled: true,
      implementationModel: 'deepseek-official/missing',
      implementationThinking: 'high',
      reviewModel: 'deepseek-official/deepseek-v4-flash',
      reviewThinking: 'xhigh',
    })).rejects.toThrow(/implementation model .* is not in the current catalog/)
    await expect(policy.configure({
      sessionId: SESSION,
      enabled: false,
      implementationModel: null,
      implementationThinking: null,
      reviewModel: null,
      reviewThinking: null,
    })).resolves.toMatchObject({ revision: 1, enabled: false })
  })

  it('skips unavailable providers and labels cursor and custom provider routes', async () => {
    const llm = {
      listProviders: () => [
        { id: 'cursor', name: 'Cursor' },
        { id: 'custom__vendor', name: 'Custom' },
        { id: 'offline', name: 'Offline' },
      ],
      listModels: async (provider: string): Promise<LlmModelInfo[]> => {
        if (provider === 'offline') throw new Error('catalog unavailable')
        return [{ provider, id: 'model', name: `${provider} model` }]
      },
    }
    const { policy } = await harness(llm)
    const snapshot = await policy.policy({ sessionId: SESSION })
    expect(snapshot.models).toMatchObject([
      { selector: 'cursor/model', badges: [{ label: 'Cursor' }, { label: 'Cursor' }] },
      { selector: 'custom__vendor/model', badges: [{ label: 'DuraSH' }, { label: 'Custom Vendor' }] },
    ])
  })

  it('turns an enabled row off when a saved model leaves the catalog', async () => {
    const root = await mkdtemp(join(tmpdir(), 'durash-reliability-policy-'))
    roots.push(root)
    const first = new Context()
    contexts.push(first)
    first.provide('llm', fakeLlm(
      [{ id: 'deepseek-official', name: 'DeepSeek' }],
      { 'deepseek-official': [{ provider: 'deepseek-official', id: 'gone', name: 'Gone' }] },
    ))
    await first.plugin(Storage)
    await first.plugin({ name: storageJsonName, inject: storageJsonInject, apply: storageJsonApply, Config: storageJsonConfig }, { root })
    await first.plugin({ name: storageDomainName, inject: storageDomainInject, apply: storageDomainApply, Config: storageDomainConfig }, { backend: 'json' })
    await first.plugin(ReliabilityPolicyService)
    await first.reliabilityPolicy.configure({
      sessionId: SESSION,
      enabled: true,
      implementationModel: 'deepseek-official/gone',
      implementationThinking: 'high',
      reviewModel: 'deepseek-official/gone',
      reviewThinking: 'high',
    })
    await first.fiber.dispose()
    contexts.splice(contexts.indexOf(first), 1)

    const second = new Context()
    contexts.push(second)
    second.provide('llm', fakeLlm(
      [{ id: 'deepseek-official', name: 'DeepSeek' }],
      { 'deepseek-official': [{ provider: 'deepseek-official', id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' }] },
    ))
    await second.plugin(Storage)
    await second.plugin({ name: storageJsonName, inject: storageJsonInject, apply: storageJsonApply, Config: storageJsonConfig }, { root })
    await second.plugin({ name: storageDomainName, inject: storageDomainInject, apply: storageDomainApply, Config: storageDomainConfig }, { backend: 'json' })
    await second.plugin(ReliabilityPolicyService)
    const snapshot = await second.reliabilityPolicy.policy({ sessionId: SESSION })
    expect(snapshot.enabled).toBe(false)
  })

  it('turns incomplete and review-only-stale durable rows off', async () => {
    const now = Date.now()
    const incomplete = await seededHarness({
      sessionId: SESSION,
      revision: 1,
      enabled: true,
      implementationModel: null,
      implementationThinking: 'high',
      reviewModel: 'deepseek-official/deepseek-v4-pro',
      reviewThinking: 'xhigh',
      updatedAt: now,
    })
    expect(incomplete.policy.enabledRoutes(SESSION)).toBeUndefined()
    expect((await incomplete.policy.policy({ sessionId: SESSION })).enabled).toBe(false)

    const otherSession = SessionId('session-review-stale')
    const staleReview = await seededHarness({
      sessionId: otherSession,
      revision: 1,
      enabled: true,
      implementationModel: 'deepseek-official/deepseek-v4-pro',
      implementationThinking: 'high',
      reviewModel: 'deepseek-official/missing',
      reviewThinking: 'xhigh',
      updatedAt: now,
    })
    expect((await staleReview.policy.policy({ sessionId: otherSession })).enabled).toBe(false)
  })

  it('fails before the durable table has started', async () => {
    const ctx = new Context()
    ctx.provide('llm', fakeLlm([], {}))
    const policy = new ReliabilityPolicyService(ctx)
    await expect(policy.policy({ sessionId: SESSION })).rejects.toThrow(/not started yet/)
  })

  it('parses a provider/model selector on the first slash', () => {
    expect(parseLaneSelector('openai-codex/gpt-5')).toEqual({ provider: 'openai-codex', model: 'gpt-5' })
    expect(() => parseLaneSelector('noslash')).toThrow(/provider\/model/)
    expect(() => parseLaneSelector('provider/')).toThrow(/provider\/model/)
  })
})
