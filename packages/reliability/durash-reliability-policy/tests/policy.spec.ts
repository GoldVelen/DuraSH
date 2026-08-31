import { afterEach, describe, expect, it, vi } from 'vitest'
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
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import ReliabilityPolicyService, { parseLaneSelector } from '../src/index.ts'
import type { LlmModelInfo, LlmProviderInfo } from '@deepseek-ai/dsh-llm/types'

const roots: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(async (ctx) => { await ctx.fiber.dispose() }))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

interface FakeModel extends LlmModelInfo {
  readonly efforts?: readonly string[]
  readonly defaultEffort?: string
  readonly resolveError?: string
}

function fakeLlm(providers: LlmProviderInfo[], models: Record<string, FakeModel[]>) {
  return {
    listProviders: () => providers,
    listModels: async (provider: string) => (models[provider] ?? []).map(({
      efforts: _efforts,
      defaultEffort: _default,
      resolveError: _error,
      ...model
    }) => model),
    resolveModelInfo: async (provider: string, modelId: string) => {
      const model = (models[provider] ?? []).find(candidate => candidate.id === modelId)
      if (model === undefined) throw new Error(`unknown model ${provider}/${modelId}`)
      if (model.resolveError !== undefined) throw new Error(model.resolveError)
      const { efforts, defaultEffort, resolveError: _error, ...info } = model
      return {
        ...info,
        ...efforts === undefined ? {} : {
          reasoning: {
            efforts: efforts.map(id => ({
              id: ReasoningEffortId(id),
              name: id.toUpperCase(),
              description: `${id} reasoning`,
            })),
            ...defaultEffort === undefined ? {} : { defaultEffort: ReasoningEffortId(defaultEffort) },
          },
        },
      }
    },
  }
}

async function harness(llm = fakeLlm(
  [{ id: 'deepseek-official', name: 'DeepSeek' }],
  {
    'deepseek-official': [
      {
        provider: 'deepseek-official', id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro',
        efforts: ['low', 'high', 'xhigh'], defaultEffort: 'high',
      },
      {
        provider: 'deepseek-official', id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash',
        efforts: ['low', 'high', 'xhigh'], defaultEffort: 'low',
      },
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
    expect(snapshot.models[0]!.reasoningEfforts).toEqual([
      { id: 'low', name: 'LOW', description: 'low reasoning', isDefault: false },
      { id: 'high', name: 'HIGH', description: 'high reasoning', isDefault: true },
      { id: 'xhigh', name: 'XHIGH', description: 'xhigh reasoning', isDefault: false },
    ])
    expect(snapshot.validationError).toBeNull()
    expect(policy.workflowEnabled(SESSION)).toBe(false)
  })

  it('ensurePolicy fills default selectors from the first catalog model', async () => {
    const { policy } = await harness()
    const snapshot = await policy.ensurePolicy({ sessionId: SESSION })
    expect(snapshot.implementationModel).toBe('deepseek-official/deepseek-v4-pro')
    expect(snapshot.reviewModel).toBe('deepseek-official/deepseek-v4-pro')
    expect(snapshot.implementationThinking).toBe('high')
    expect(snapshot.reviewThinking).toBe('xhigh')
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
    })).rejects.toThrow(/select an implementation model/)

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
    expect(await policy.enabledRoutes(SESSION)).toEqual({
      implementation: { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'high' },
      review: { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'xhigh' },
    })
  })

  it('retains an enabled saved row but blocks start when its model leaves the catalog', async () => {
    const root = await mkdtemp(join(tmpdir(), 'durash-reliability-policy-'))
    roots.push(root)
    const first = new Context()
    contexts.push(first)
    first.provide('llm', fakeLlm(
      [{ id: 'deepseek-official', name: 'DeepSeek' }],
      { 'deepseek-official': [{ provider: 'deepseek-official', id: 'gone', name: 'Gone', efforts: ['high'] }] },
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
      { 'deepseek-official': [{ provider: 'deepseek-official', id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', efforts: ['high'] }] },
    ))
    await second.plugin(Storage)
    await second.plugin({ name: storageJsonName, inject: storageJsonInject, apply: storageJsonApply, Config: storageJsonConfig }, { root })
    await second.plugin({ name: storageDomainName, inject: storageDomainInject, apply: storageDomainApply, Config: storageDomainConfig }, { backend: 'json' })
    await second.plugin(ReliabilityPolicyService)
    const snapshot = await second.reliabilityPolicy.policy({ sessionId: SESSION })
    expect(snapshot.enabled).toBe(true)
    expect(snapshot.implementationModel).toBe('deepseek-official/gone')
    expect(snapshot.validationError).toContain("implementation model 'deepseek-official/gone' is not in the current catalog")
    await expect(second.reliabilityPolicy.enabledRoutes(SESSION)).rejects.toThrow(/policy is invalid/)
  })

  it('accepts null effort only for models that expose no reasoning control', async () => {
    const { policy } = await harness(fakeLlm(
      [{ id: 'plain', name: 'Plain' }],
      { plain: [{ provider: 'plain', id: 'chat', name: 'Chat' }] },
    ))
    const snapshot = await policy.configure({
      sessionId: SESSION,
      enabled: true,
      implementationModel: 'plain/chat',
      implementationThinking: null,
      reviewModel: 'plain/chat',
      reviewThinking: null,
    })
    expect(snapshot.validationError).toBeNull()
    expect(await policy.enabledRoutes(SESSION)).toEqual({
      implementation: { provider: 'plain', model: 'chat' },
      review: { provider: 'plain', model: 'chat' },
    })
    await expect(policy.configure({
      sessionId: SESSION,
      enabled: true,
      implementationModel: 'plain/chat',
      implementationThinking: 'high',
      reviewModel: 'plain/chat',
      reviewThinking: null,
    })).rejects.toThrow(/does not expose reasoning efforts/)
  })

  it('revalidates only the selected routes before a handoff', async () => {
    const base = fakeLlm(
      [{ id: 'xai', name: 'xAI' }, { id: 'unrelated', name: 'Unrelated' }],
      {
        xai: [{
          provider: 'xai', id: 'grok-4.6', name: 'Grok 4.6',
          efforts: ['low', 'medium', 'high', 'xhigh'], defaultEffort: 'high',
        }],
        unrelated: [{ provider: 'unrelated', id: 'slow-model', name: 'Slow model', efforts: ['high'] }],
      },
    )
    const listModels = vi.fn(base.listModels)
    const resolveModelInfo = vi.fn(base.resolveModelInfo)
    const { policy } = await harness({ ...base, listModels, resolveModelInfo })
    await policy.configure({
      sessionId: SESSION,
      enabled: true,
      implementationModel: 'xai/grok-4.6',
      implementationThinking: 'high',
      reviewModel: 'xai/grok-4.6',
      reviewThinking: 'xhigh',
    })
    listModels.mockClear()
    resolveModelInfo.mockClear()

    await expect(policy.enabledRoutes(SESSION)).resolves.toEqual({
      implementation: { provider: 'xai', model: 'grok-4.6', reasoningEffort: 'high' },
      review: { provider: 'xai', model: 'grok-4.6', reasoningEffort: 'xhigh' },
    })
    expect(listModels).toHaveBeenCalledOnce()
    expect(listModels).toHaveBeenCalledWith('xai')
    expect(resolveModelInfo).toHaveBeenCalledOnce()
    expect(resolveModelInfo).toHaveBeenCalledWith('xai', 'grok-4.6')
  })

  it('rejects an effort outside the exact model set and omits unresolved catalog entries', async () => {
    const { policy } = await harness(fakeLlm(
      [{ id: 'xai', name: 'xAI' }],
      { xai: [
        { provider: 'xai', id: 'grok-4.6', name: 'Grok 4.6', efforts: ['low', 'medium', 'high', 'xhigh'], defaultEffort: 'high' },
        { provider: 'xai', id: 'broken', name: 'Broken', resolveError: 'catalog failure' },
      ] },
    ))
    const initial = await policy.policy({ sessionId: SESSION })
    expect(initial.models.map(model => model.selector)).toEqual(['xai/grok-4.6'])
    expect(initial.models[0]!.reasoningEfforts.map(effort => effort.id)).toEqual(['low', 'medium', 'high', 'xhigh'])
    await expect(policy.configure({
      sessionId: SESSION,
      enabled: true,
      implementationModel: 'xai/grok-4.6',
      implementationThinking: 'max',
      reviewModel: 'xai/grok-4.6',
      reviewThinking: 'xhigh',
    })).rejects.toThrow(/does not support reasoning effort 'max'/)
  })

  it('parses a provider/model selector on the first slash', () => {
    expect(parseLaneSelector('openai-codex/gpt-5')).toEqual({ provider: 'openai-codex', model: 'gpt-5' })
    expect(() => parseLaneSelector('noslash')).toThrow(/provider\/model/)
  })
})
