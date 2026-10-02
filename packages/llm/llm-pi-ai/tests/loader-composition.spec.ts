/** Profile patch edits and credential updates reach the next real adapter request. */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { zstdDecompressSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader, { type ModuleLoaderV2 } from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import LlmRuntime, { createMessage, createUserMessage, ReasoningEffortId, userAgent } from '@deepseek-ai/dsh-llm'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import { profileComposition } from '../../../settings/settings/tests/profile-composition.ts'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import { recordKeyFor } from '../src/auth.ts'
import { assemble } from './assemble.ts'
import { closeMockServers, mockServer, textEvents } from './mock-server.ts'

/** One text block, then a tool call truncated by the output-token ceiling. */
const truncatedToolCallEvents = [
  '{"choices":[{"delta":{"role":"assistant","content":""},"index":0,"finish_reason":null}]}',
  '{"choices":[{"delta":{"content":"partial"},"index":0,"finish_reason":null}]}',
  '{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","type":"function","function":{"name":"echo","arguments":"{\\"text\\":"}}]},"index":0,"finish_reason":null}]}',
  '{"choices":[{"delta":{},"index":0,"finish_reason":"length"}],"usage":{"prompt_tokens":3,"completion_tokens":4}}',
  '[DONE]',
]

let root: string | undefined
let context: Context | undefined
let directoryServer: Server | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  await closeMockServers()
  if (directoryServer !== undefined) await new Promise<void>((resolve, reject) => {
    directoryServer!.close((error) => {
      if (error === undefined) resolve()
      else reject(error)
    })
  })
  directoryServer = undefined
  vi.unstubAllEnvs()
})

/** Boot the dormant composition: a bare `llm-pi-ai` row with no config at all. */
async function loadComposition(existingRoot?: string): Promise<{ ctx: Context; settingsPath: string }> {
  root = existingRoot ?? await mkdtemp(join(tmpdir(), 'dsh-pi-composition-'))
  if (existingRoot === undefined) {
    await writeFile(join(root, '.credentials.yaml'), 'version: 1\nrefs:\n  PI_COMPOSITION_KEY: key-from-store\n', { mode: 0o600 })
  }

  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    '- id: llm',
    "  name: 'test-llm-service'",
    '- id: credentials',
    "  name: '@deepseek-ai/dsh-credentials-local'",
    '  config:',
    `    path: ${JSON.stringify(join(root, '.credentials.yaml'))}`,
    '    debounceMs: 10',
    '- id: llm-pi-ai',
    "  name: '@deepseek-ai/dsh-llm-pi-ai'",
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['test-llm-service', LlmRuntime],
    ['@deepseek-ai/dsh-credentials-local', LocalCredentialProvider],
    ['@deepseek-ai/dsh-llm-pi-ai', LlmPiAi],
  ])
  const internal: ModuleLoaderV2 = {
    version: 'v2',
    loadCache: new Map(),
    import: (specifier: string) => {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return Promise.resolve(modules.get(specifier))
    },
    register(): never { throw new Error('unexpected module hook registration') },
    getOrCreateModuleJob(): never { throw new Error('unexpected module job creation') },
    resolveSync(): never { throw new Error('unexpected synchronous module resolution') },
    load(): never { throw new Error('unexpected module load') },
  }
  ctx.loader.internal = internal
  const patchPath = await profileComposition(ctx, root, configPath)
  return { ctx, settingsPath: patchPath }
}


/** One route-matched loopback fixture for provider directories and Responses inference. */
async function directoryFixture(provider: 'xai' | 'openai-codex' = 'xai') {
  const calls: {
    path: string
    method: string | undefined
    authorization: string | undefined
    accountId: string | string[] | undefined
    body: unknown
  }[] = []
  const completedMessage = {
    type: 'message', id: 'message-1', role: 'assistant', status: 'completed',
    content: [{ type: 'output_text', text: 'hello', annotations: [] }],
  }
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => { chunks.push(chunk) })
    request.on('end', () => {
      const raw = Buffer.concat(chunks)
      const body = (request.headers['content-encoding'] === 'zstd' ? zstdDecompressSync(raw) : raw).toString('utf8')
      const path = request.url ?? ''
      calls.push({ path, method: request.method, authorization: request.headers.authorization,
        accountId: request.headers['chatgpt-account-id'], body: body.length === 0 ? undefined : JSON.parse(body) })
      if (request.method === 'GET' && path === '/v1/language-models') {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ models: [{
          id: 'grok-directory-fixture', name: 'Grok Directory Fixture', input_modalities: ['text', 'image'],
          capabilities: { reasoning_effort: ['low', 'medium', 'high', 'xhigh'] },
        }] }))
      } else if (request.method === 'GET' && path === '/v1/models') {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ data: [{ id: 'grok-directory-fixture', context_length: 500000 }] }))
      } else if (request.method === 'GET' && path === '/backend-api/codex/models?client_version=0.155.0') {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ models: ['gpt-6-sol', 'gpt-6-luna', 'codex-directory-fixture'].map(slug => ({
          slug, display_name: slug, visibility: 'list', context_window: 272000,
          input_modalities: ['text', 'image'],
          supported_reasoning_levels: ['low', 'medium', 'high', 'xhigh', 'max'].map(effort => ({ effort })),
        })) }))
      } else if (request.method === 'POST' && path === (provider === 'xai' ? '/v1/responses' : '/backend-api/codex/responses')) {
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        const events = [
          { type: 'response.created', response: { id: 'response-1' } },
          { type: 'response.output_item.added', output_index: 0, item: { ...completedMessage, status: 'in_progress', content: [] } },
          { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: 'hello' },
          { type: 'response.output_item.done', output_index: 0, item: completedMessage },
          { type: 'response.completed', response: {
            id: 'response-1', status: 'completed', output: [completedMessage],
            usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 },
          } },
        ]
        for (const event of events) response.write(`data: ${JSON.stringify(event)}\n\n`)
        response.end()
      } else {
        response.writeHead(404, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: `unexpected fixture request: ${request.method} ${path}` }))
      }
    })
  })
  directoryServer = server
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('model directory fixture did not bind a TCP port')
  return { url: `http://127.0.0.1:${address.port}${provider === 'xai' ? '/v1' : '/backend-api'}`, calls }
}

describe('llm-pi-ai real dormant composition', () => {
  it('boots with zero routes and registers one the moment settings supply a profile', async () => {
    vi.stubEnv('PI_COMPOSITION_KEY', '')
    const server = await mockServer([{ events: textEvents }])
    const { ctx, settingsPath } = await loadComposition()

    // The shipped posture: the adapter exists, no route does.
    expect(ctx.llm.listProviders()).toEqual([])

    // Exactly what the web Models page leaves on disk.
    await writeFile(settingsPath, [
      '- id: llm-pi-ai',
      '  config:',
      '    providers:',
      '      deepseek:',
      '        apiKeyEnv: PI_COMPOSITION_KEY',
      `        baseURL: ${server.url}`,
      '',
    ].join('\n'))
    await vi.waitFor(() => {
      expect(ctx.llm.listProviders().map(provider => provider.id)).toEqual(['deepseek'])
    }, { timeout: 5000 })

    const result = await assemble(ctx, { provider: 'deepseek', model: 'deepseek-flash', messages: [] })
    expect(result.message.content).toEqual([{ type: 'text', text: 'hello' }])
    expect(server.headers[0]?.authorization).toBe('Bearer key-from-store')
  })

  it('uses settings-only route headers for model discovery', async () => {
    vi.stubEnv('PI_COMPOSITION_KEY', '')
    const server = await mockServer([{ body: JSON.stringify({ data: [{ id: 'acme-private' }] }) }])
    const { ctx, settingsPath } = await loadComposition()

    await writeFile(settingsPath, [
      '- id: llm-pi-ai',
      '  config:',
      '    providers:',
      '      acme-gateway:',
      '        apiKeyEnv: PI_COMPOSITION_KEY',
      '        api: openai-completions',
      `        baseURL: ${server.url}`,
      '        headers:',
      '          X-Company-Code: private-tenant',
      '          Accept: text/plain',
      '          User-Agent: deployment-owned',
      '        models:',
      '          - id: acme-bootstrap',
      '',
    ].join('\n'))
    await vi.waitFor(() => {
      expect(ctx.llm.listProviders().map(provider => provider.id)).toEqual(['acme-gateway'])
    }, { timeout: 5000 })

    await expect(ctx.llm.discoverModels('llm-pi-ai', {
      provider: 'acme-gateway',
      baseURL: server.url,
      api: 'openai-completions',
    })).resolves.toEqual([{ id: 'acme-private', name: 'acme-private' }])
    expect(server.paths).toEqual(['/models'])
    expect(server.headers[0]?.['x-company-code']).toBe('private-tenant')
    expect(server.headers[0]?.authorization).toBe('Bearer key-from-store')
    expect(server.headers[0]?.accept).toBe('application/json')
    expect(server.headers[0]?.['user-agent']).toBe(userAgent())
  })

  it.each(['api-key', 'subscription'] as const)('refreshes xAI using %s auth, persists metadata, and sends xhigh before and after reload', async (authMode) => {
    vi.stubEnv('PI_COMPOSITION_KEY', '')
    vi.stubEnv('XAI_API_KEY', undefined)
    const server = await directoryFixture()
    const { ctx, settingsPath } = await loadComposition()
    const access = authMode === 'subscription' ? 'subscription-fixture-access' : 'key-from-store'
    if (authMode === 'subscription') {
      await ctx.credentials.modifyRecord(recordKeyFor('xai'), async () => ({
        kind: 'grant', payload: { type: 'oauth', access, refresh: 'fixture-refresh', expires: Date.now() + 3_600_000 },
      }))
    }
    await ctx.settings.mutate('llm-pi-ai', [{
      op: 'set', path: ['providers', 'xai'], value: {
        ...authMode === 'api-key' ? { apiKeyEnv: 'PI_COMPOSITION_KEY' } : {},
        api: 'openai-responses', baseURL: server.url,
        models: [{ id: 'grok-4.6' }],
      },
    }])
    const installed = await ctx.llm.discoverModels('llm-pi-ai', { provider: 'xai', baseURL: server.url })
    expect(installed.some(model => model.id === 'grok-4.6')).toBe(true)
    expect(installed.some(model => model.id === 'grok-directory-fixture')).toBe(false)
    expect(server.calls).toEqual([])

    const discovered = await ctx.llm.discoverModels('llm-pi-ai', {
      provider: 'xai', baseURL: server.url, api: 'openai-responses', refresh: true,
    })
    expect(server.calls.map(call => call.path).sort()).toEqual(['/v1/language-models', '/v1/models'])
    expect(server.calls.every(call => call.method === 'GET' && call.authorization === `Bearer ${access}`)).toBe(true)
    const candidate = discovered.find(model => model.id === 'grok-directory-fixture')
    expect(candidate).toMatchObject({
      id: 'grok-directory-fixture', contextWindow: 500000, inputModalities: ['text', 'image'],
      reasoningEfforts: { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh' },
    })
    expect(candidate?.maxTokens).toBeUndefined()
    expect(candidate).toBeDefined()
    await ctx.settings.mutate('llm-pi-ai', [{
      op: 'set', path: ['providers', 'xai', 'models'], value: [
        { id: 'grok-4.6' },
        {
          id: candidate!.id, name: candidate!.name, contextWindow: candidate!.contextWindow,
          input: candidate!.inputModalities, reasoningEfforts: candidate!.reasoningEfforts,
        },
      ],
    }])
    expect((await ctx.llm.listModels('xai')).map(model => model.id)).toEqual(['grok-4.6', 'grok-directory-fixture'])
    const resolved = await ctx.llm.resolveModelInfo('xai', 'grok-directory-fixture')
    expect(resolved.context).toEqual({ contextWindow: 500000 })
    expect(resolved.reasoning?.efforts).toContainEqual({ id: ReasoningEffortId('xhigh'), name: 'Xhigh' })

    const result = await assemble(ctx, {
      provider: 'xai', model: 'grok-directory-fixture', reasoningEffort: ReasoningEffortId('xhigh'),
      messages: [createUserMessage({ content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } })],
    })
    expect(result.finish).toEqual({ kind: 'stop' })
    expect(result.message.content).toEqual([{ type: 'text', text: 'hello' }])
    expect(server.calls.at(-1)).toMatchObject({
      path: '/v1/responses', method: 'POST', authorization: `Bearer ${access}`,
      body: { model: 'grok-directory-fixture', reasoning: { effort: 'xhigh' } },
    })
    const persisted = await readFile(settingsPath, 'utf8')
    expect(persisted).toContain('grok-4.6')
    expect(persisted).toContain('grok-directory-fixture')
    expect(persisted).toContain('500000')
    expect(persisted).toContain('xhigh')
    expect(persisted).not.toContain(access)
    if (authMode === 'subscription') expect(persisted).not.toContain('apiKeyEnv')
    await ctx.fiber.dispose()
    context = undefined
    const reloaded = await loadComposition(root)
    expect((await reloaded.ctx.llm.listModels('xai')).map(model => model.id)).toEqual(['grok-4.6', 'grok-directory-fixture'])
    const reloadedModel = await reloaded.ctx.llm.resolveModelInfo('xai', 'grok-directory-fixture')
    expect(reloadedModel.context).toEqual({ contextWindow: 500000 })
    expect(reloadedModel.reasoning?.efforts).toContainEqual({ id: ReasoningEffortId('xhigh'), name: 'Xhigh' })
    const resumed = await assemble(reloaded.ctx, {
      provider: 'xai', model: 'grok-directory-fixture', reasoningEffort: ReasoningEffortId('xhigh'),
      messages: [createUserMessage({ content: [{ type: 'text', text: 'hello again' }], source: { kind: 'user' } })],
    })
    expect(resumed.finish).toEqual({ kind: 'stop' })
    expect(server.calls.at(-1)).toMatchObject({
      path: '/v1/responses', method: 'POST', authorization: `Bearer ${access}`,
      body: { model: 'grok-directory-fixture', reasoning: { effort: 'xhigh' } },
    })
    expect(server.calls).toHaveLength(4)
  })

  it('refreshes Codex with subscription auth and runs newly adopted models before and after reload', async () => {
    const server = await directoryFixture('openai-codex')
    const { ctx, settingsPath } = await loadComposition()
    const access = ['fixture-header', Buffer.from(JSON.stringify({
      'https://api.openai.com/auth': { chatgpt_account_id: 'fixture-account' },
    })).toString('base64url'), 'fixture-signature'].join('.')
    await ctx.credentials.modifyRecord(recordKeyFor('openai-codex'), async () => ({
      kind: 'grant', payload: { type: 'oauth', access, refresh: 'fixture-refresh', expires: Date.now() + 3_600_000 },
    }))
    await ctx.settings.mutate('llm-pi-ai', [{
      op: 'set', path: ['providers', 'openai-codex'], value: {
        baseURL: server.url, transport: 'sse', models: [{ id: 'gpt-6-astra' }],
      },
    }])
    const installed = await ctx.llm.discoverModels('llm-pi-ai', { provider: 'openai-codex', baseURL: server.url })
    expect(installed.some(model => model.id === 'codex-directory-fixture')).toBe(false)
    expect(server.calls).toEqual([])
    const discovered = await ctx.llm.discoverModels('llm-pi-ai', {
      provider: 'openai-codex', baseURL: server.url, refresh: true,
    })
    expect(discovered.map(model => model.id)).toEqual(['gpt-6-sol', 'gpt-6-luna', 'codex-directory-fixture'])
    expect(server.calls).toEqual([expect.objectContaining({
      method: 'GET', path: '/backend-api/codex/models?client_version=0.155.0',
      authorization: `Bearer ${access}`, accountId: 'fixture-account',
    })])
    await ctx.settings.mutate('llm-pi-ai', [{
      op: 'set', path: ['providers', 'openai-codex', 'models'], value: discovered.map(model => ({
        id: model.id, name: model.name, contextWindow: model.contextWindow,
        input: model.inputModalities, reasoningEfforts: model.reasoningEfforts,
      })),
    }])
    const persisted = await readFile(settingsPath, 'utf8')
    expect(persisted).toContain('gpt-6-sol')
    expect(persisted).toContain('gpt-6-luna')
    expect(persisted).toContain('272000')
    expect(persisted).toContain('xhigh')
    expect(persisted).not.toContain(access)
    expect(persisted).not.toContain('apiKeyEnv')
    for (const reload of [false, true]) {
      if (reload) {
        await context!.fiber.dispose()
        context = undefined
        await loadComposition(root)
      }
      const active = context!
      expect((await active.llm.listModels('openai-codex')).map(model => model.id)).toEqual(['gpt-6-sol', 'gpt-6-luna', 'codex-directory-fixture'])
      for (const model of ['gpt-6-sol', 'gpt-6-luna', 'codex-directory-fixture']) {
        const resolved = await active.llm.resolveModelInfo('openai-codex', model)
        expect(resolved.context).toEqual({ contextWindow: 272000 })
        expect(resolved.reasoning?.efforts).toContainEqual({ id: ReasoningEffortId('xhigh'), name: 'Xhigh' })
        const result = await assemble(active, {
          provider: 'openai-codex', model, reasoningEffort: ReasoningEffortId('xhigh'),
          messages: [createUserMessage({ content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } })],
        })
        expect(result.finish).toEqual({ kind: 'stop' })
        expect(result.message.content).toEqual([{ type: 'text', text: 'hello' }])
        expect(server.calls.at(-1)).toMatchObject({
          path: '/backend-api/codex/responses', method: 'POST', authorization: `Bearer ${access}`,
          accountId: 'fixture-account', body: { model, reasoning: { effort: 'xhigh' } },
        })
      }
    }
    expect(server.calls).toHaveLength(7)
  })

  it('continues natively after max-token assembly drops a tool call, with pruned replay metadata', async () => {
    vi.stubEnv('PI_COMPOSITION_KEY', '')
    const server = await mockServer([
      { events: truncatedToolCallEvents },
      { events: textEvents },
    ])
    const { ctx, settingsPath } = await loadComposition()
    await writeFile(settingsPath, [
      '- id: llm-pi-ai',
      '  config:',
      '    providers:',
      '      deepseek:',
      '        apiKeyEnv: PI_COMPOSITION_KEY',
      `        baseURL: ${server.url}`,
      '',
    ].join('\n'))
    await vi.waitFor(() => {
      expect(ctx.llm.listProviders().map(provider => provider.id)).toEqual(['deepseek'])
    }, { timeout: 5000 })

    const truncated = await assemble(ctx, {
      provider: 'deepseek',
      model: 'deepseek-flash',
      messages: [],
    })
    expect(truncated.finish).toEqual({ kind: 'max-tokens' })
    expect(truncated.message.content).toEqual([{ type: 'text', text: 'partial' }])
    expect(truncated.message.source).toEqual({
      kind: 'model',
      provider: 'deepseek',
      model: 'deepseek-flash',
      replayState: {
        response: {
          kind: 'pi-ai',
          version: 2,
          api: 'openai-completions',
          provider: 'deepseek',
          model: 'deepseek-flash',
          stopReason: 'length',
        },
        blocks: [{ type: 'text' }],
      },
    })

    const continued = await assemble(ctx, {
      provider: 'deepseek',
      model: 'deepseek-flash',
      messages: [
        truncated.message,
        createUserMessage({ content: [{ type: 'text', text: 'continue' }], source: { kind: 'user' } }),
      ],
    })
    expect(continued.message.content).toEqual([{ type: 'text', text: 'hello' }])
    expect(server.requests).toHaveLength(2)
    expect(server.requests[1]).toMatchObject({
      messages: [
        { role: 'assistant', content: 'partial' },
        { role: 'user', content: 'continue' },
      ],
    })
    const followup = server.requests[1] as { messages?: unknown[] }
    expect(followup.messages?.[0]).not.toHaveProperty('tool_calls')
  })

  it('continues a legacy session whose stored replay state no longer matches its content', async () => {
    vi.stubEnv('PI_COMPOSITION_KEY', '')
    const server = await mockServer([{ events: textEvents }])
    const { ctx, settingsPath } = await loadComposition()
    await writeFile(settingsPath, [
      '- id: llm-pi-ai',
      '  config:',
      '    providers:',
      '      deepseek:',
      '        apiKeyEnv: PI_COMPOSITION_KEY',
      `        baseURL: ${server.url}`,
      '',
    ].join('\n'))
    await vi.waitFor(() => {
      expect(ctx.llm.listProviders().map(provider => provider.id)).toEqual(['deepseek'])
    }, { timeout: 5000 })

    // A pre-envelope session log entry: max-token assembly dropped the tool
    // call from content while the flat v1 state still describes both blocks.
    const poisoned = createMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'partial' }],
      source: {
        kind: 'model',
        ...{
          provider: 'deepseek',
          model: 'deepseek-flash',
          replayState: {
            kind: 'pi-ai',
            version: 1,
            api: 'openai-completions',
            provider: 'deepseek',
            model: 'deepseek-flash',
            stopReason: 'length',
            blocks: [{ type: 'text' }, { type: 'tool-call' }],
          },
        },
      },
    })
    const continued = await assemble(ctx, {
      provider: 'deepseek',
      model: 'deepseek-flash',
      messages: [
        poisoned,
        createUserMessage({ content: [{ type: 'text', text: 'continue' }], source: { kind: 'user' } }),
      ],
    })
    expect(continued.finish).toEqual({ kind: 'stop' })
    expect(continued.message.content).toEqual([{ type: 'text', text: 'hello' }])
    expect(server.requests[0]).toMatchObject({
      messages: [
        { role: 'assistant', content: 'partial' },
        { role: 'user', content: 'continue' },
      ],
    })
  })
})
