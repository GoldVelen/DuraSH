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
import ReliabilityPolicyService, { parseLaneSelector } from '../src/index.ts'
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

  it('parses a provider/model selector on the first slash', () => {
    expect(parseLaneSelector('openai-codex/gpt-5')).toEqual({ provider: 'openai-codex', model: 'gpt-5' })
    expect(() => parseLaneSelector('noslash')).toThrow(/provider\/model/)
  })
})
