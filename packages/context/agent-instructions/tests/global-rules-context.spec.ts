import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import Group from '@deepseek-ai/cordis-plugin-group'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import * as AgentInstructions from '@deepseek-ai/dsh-agent-instructions'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import LlmRuntime, { createUserMessage, type GenerateOptions } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import * as ToolFs from '@deepseek-ai/dsh-tool-fs'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as Spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import AgentPresets, { serviceForAgent, serviceForScope } from '@deepseek-ai/dsh-agent-presets'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

const OLD = 'GLOBAL_RULE_VERSION_ONE'
const NEW = 'GLOBAL_RULE_VERSION_TWO'
const PROJECT = 'PROJECT_RULE_REMAINS_MORE_SPECIFIC'
const NESTED = 'NESTED_RULE_REMAINS_DISCOVERED'
const resources: { ctx: Context; root: string }[] = []

afterEach(async () => {
  for (const { ctx, root } of resources.splice(0)) {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
  vi.unstubAllEnvs()
})

async function harness(
  script: ConstructorParameters<typeof MockAdapter>[0],
  options: { maxBytes?: number; homeFromEnv?: boolean; subagent?: boolean; project?: boolean; presets?: boolean } = {},
) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-global-rules-request-'))
  const ctx = new Context()
  resources.push({ ctx, root })
  const home = join(root, 'configured-home')
  const cwd = join(root, 'project')
  await mkdir(home)
  await mkdir(join(cwd, '.git'), { recursive: true })
  await writeFile(join(home, 'AGENTS.md'), OLD)
  if (options.project !== false) await writeFile(join(cwd, 'AGENTS.md'), PROJECT)
  if (options.homeFromEnv) vi.stubEnv('DSH_HOME', home)
  else {
    const decoy = join(root, 'environment-home')
    await mkdir(decoy)
    await writeFile(join(decoy, 'AGENTS.md'), 'WRONG_ENVIRONMENT_RULES')
    vi.stubEnv('DSH_HOME', decoy)
  }
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-llm', LlmRuntime],
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-session-projection', SessionProjectionRegistry],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-fs-local', LocalFileSystem],
    ['@deepseek-ai/dsh-tool-fs', ToolFs],
    ['@deepseek-ai/dsh-agent-instructions', AgentInstructions],
    ['@deepseek-ai/dsh-agent-loop', AgentLoop],
    ...options.presets ? [['@deepseek-ai/dsh-agent-presets', AgentPresets]] as [string, unknown][] : [],
    ...options.subagent ? [
      ['@deepseek-ai/dsh-subagent', SubagentRuntime],
      ['@deepseek-ai/dsh-subagent-spawn-in-process', Spawn],
    ] as [string, unknown][] : [],
  ])
  const configPath = join(root, 'cordis.yml')
  const presetRoot = join(root, 'presets')
  if (options.presets) {
    for (const preset of ['standard-test', 'ptc-test']) {
      const directory = join(presetRoot, preset)
      await mkdir(directory, { recursive: true })
      await writeFile(join(directory, 'agent.cordis.yml'), [
        '- id: instructions', '  name: cordis:group', '  group: true',
        '  isolate:', '    globalRules: true', '  config:',
        '    - id: agent-instructions', `      name: ${JSON.stringify(new URL('../src/index.ts', import.meta.url).href)}`,
        '      config:', '        maxBytes: 65536', `        dshHome: ${JSON.stringify(home)}`, '',
      ].join('\n'))
    }
  }
  await writeFile(configPath, [...modules.keys()].filter(name => !options.presets || name !== '@deepseek-ai/dsh-agent-instructions').map((name) => {
    const lines = [`- name: '${name}'`]
    if (name === '@deepseek-ai/dsh-agent-instructions') {
      lines.push('  config:', `    maxBytes: ${options.maxBytes ?? 65536}`)
      if (!options.homeFromEnv) lines.push(`    dshHome: ${JSON.stringify(home)}`)
    }
    if (name === '@deepseek-ai/dsh-fs-local') lines.push('  config:', `    cwd: ${JSON.stringify(cwd)}`)
    if (name === '@deepseek-ai/dsh-agent-loop') lines.push('  config:', '    agents: []')
    if (name === '@deepseek-ai/dsh-agent-presets') lines.push(
      '  config:', '    default: standard-test', '    includeShippedRoot: false', '    includeUserRoot: false',
      '    roots:', `      - path: ${JSON.stringify(presetRoot)}`, '        trust: system',
    )
    return lines.join('\n')
  }).join('\n') + '\n')
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.builtins.group = Group
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (specifier === new URL('../src/index.ts', import.meta.url).href) return AgentInstructions
      if (!modules.has(specifier)) throw new Error(`Unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  expect([...ctx.loader.entries()].filter(entry => entry.fiber === undefined && !entry.disabled)
    .map(entry => entry.options.name)).toEqual([])
  const adapter = new MockAdapter(script)
  ctx.llm.registerAdapter(['grok'], adapter)
  const createAgent = async (id: string, preset?: string) => options.presets
    ? (await ctx.agents.create({
      sessionId: SessionId(id), agentOptions: { provider: 'grok', model: 'grok-4' }, meta: { cwd },
      setup: async (agentCtx) => { await ctx.agentPresets.mount(agentCtx, preset) },
    })).agent
    : ctx.agentLoop.create(SessionId(id), { provider: 'grok', model: 'grok-4' }, { cwd })
  const agent = await createAgent('ordinary-session')
  return { ctx, agent, adapter, home, cwd, createAgent }
}

async function turn(agent: Agent, text = 'Continue the ordinary conversation.'): Promise<void> {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
  await agent.whenIdle()
}

function requestText(request: GenerateOptions | undefined): string {
  expect(request).toBeDefined()
  return request!.messages.flatMap(message => message.content.flatMap(block => block.type === 'text' ? [block.text] : [])).join('\n')
}

function instructionEvents(agent: Agent) {
  return agent.session.snapshotEvents().filter(event => event.type === 'user/message' && event.data.source.kind === 'agent-instructions')
}

async function save(ctx: Context, content: string) {
  const before = await ctx.globalRules.read()
  return ctx.globalRules.save(content, before.revision)
}

describe('global rules through Loader and the real request assembler', () => {
  it('reads existing exact text and applies a saved file to a fresh ordinary Grok session', async () => {
    const { ctx, adapter, home, createAgent } = await harness([textResponse('done')])
    expect(await ctx.globalRules.read()).toMatchObject({ content: OLD, path: join(home, 'AGENTS.md'), exists: true, loadingEnabled: true })
    const content = `  ${NEW}\r\n\r\n`
    await save(ctx, content)
    expect(await readFile(join(home, 'AGENTS.md'), 'utf8')).toBe(content)
    const fresh = await createAgent('created-after-save')
    await turn(fresh)
    expect(adapter.requests[0]).toMatchObject({ provider: 'grok', model: 'grok-4' })
    const text = requestText(adapter.requests[0])
    expect(text).toContain(NEW)
    expect(text).toContain(PROJECT)
    expect(text.indexOf(NEW)).toBeLessThan(text.indexOf(PROJECT))
    expect(text).toContain('They do not override system, developer, or direct user instructions.')
    expect(text).not.toContain('WRONG_ENVIRONMENT_RULES')
    expect(instructionEvents(fresh)).toHaveLength(1)
    expect([...ctx.loader.entries()].map(entry => entry.options.name).some(name => name.includes('workflow'))).toBe(false)
  })

  it('replaces existing-session instructions on the next request and removes cleared text', async () => {
    const { ctx, agent, adapter } = await harness(Array.from({ length: 4 }, () => textResponse('done')))
    await turn(agent)
    const sentBeforeSave = JSON.stringify(adapter.requests[0]?.messages)
    expect(requestText(adapter.requests[0])).toContain(OLD)
    await save(ctx, NEW)
    expect(adapter.requests).toHaveLength(1)
    await turn(agent)
    expect(requestText(adapter.requests[1])).toContain(NEW)
    expect(requestText(adapter.requests[1])).not.toContain(OLD)
    expect(JSON.stringify(adapter.requests[0]?.messages)).toBe(sentBeforeSave)
    const replacement = instructionEvents(agent).at(-1)
    expect(replacement?.surfaceOp).toMatchObject({ op: 'replace' })
    expect(replacement?.sourceEventSeqs).toEqual([instructionEvents(agent)[0]?.seq])
    await save(ctx, '')
    await turn(agent)
    const cleared = requestText(adapter.requests[2])
    expect(cleared).not.toContain(OLD)
    expect(cleared).not.toContain(NEW)
    expect(cleared).toContain(PROJECT)
    const count = instructionEvents(agent).length
    await turn(agent)
    expect(instructionEvents(agent)).toHaveLength(count)
    expect(requestText(adapter.requests[3])).not.toContain(NEW)
  })

  it('does not re-inject unchanged saved rules or unchanged turns', async () => {
    const { ctx, agent, adapter } = await harness(Array.from({ length: 3 }, () => textResponse('done')))
    await turn(agent)
    await turn(agent)
    await save(ctx, OLD)
    await turn(agent)
    expect(instructionEvents(agent)).toHaveLength(1)
    for (const request of adapter.requests) expect(requestText(request).split(OLD)).toHaveLength(2)
  })

  it.each(['request', 'prepareCall'] as const)('uses saved rules when an existing-session request is still waiting at %s', async (stage) => {
    const { ctx, agent, adapter } = await harness([textResponse('done'), textResponse('done')])
    await turn(agent)
    const waiting = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    if (stage === 'request') {
      ctx.on('agent/request', async (_payload, next) => {
        waiting.resolve(undefined)
        await release.promise
        return next()
      })
    } else {
      const prepare = adapter.prepareCall.bind(adapter)
      vi.spyOn(adapter, 'prepareCall').mockImplementation(async (...args) => {
        waiting.resolve(undefined)
        await release.promise
        return prepare(...args)
      })
    }
    const completed = turn(agent)
    try {
      await waiting.promise
      expect(adapter.requests).toHaveLength(1)
      await save(ctx, NEW)
    } finally {
      release.resolve(undefined)
      await completed
    }
    expect(requestText(adapter.requests[1])).toContain(NEW)
    expect(requestText(adapter.requests[1])).not.toContain(OLD)
  })

  it('clears the only instruction node without retaining an old global body', async () => {
    const { ctx, agent, adapter } = await harness([textResponse('done'), textResponse('done')], { project: false })
    await turn(agent)
    await save(ctx, '')
    await turn(agent)
    expect(requestText(adapter.requests[1])).not.toContain(OLD)
    const cleared = instructionEvents(agent).at(-1)
    expect(cleared?.surfaceOp).toMatchObject({ op: 'replace' })
    expect(cleared?.type).toBe('user/message')
    if (cleared?.type !== 'user/message') throw new Error('Missing cleared instruction event')
    expect(JSON.stringify(cleared.data.content)).not.toContain(OLD)
  })

  it('keeps an in-flight tool alive and retains discovered nested rules when saves supersede each other', async () => {
    const { ctx, agent, adapter, cwd } = await harness([
      toolCallResponse('read-nested', 'read', { file_path: 'nested/task.txt' }),
      toolCallResponse('wait-tool', 'wait_fixture', {}),
      textResponse('done'),
    ])
    await mkdir(join(cwd, 'nested'))
    await writeFile(join(cwd, 'nested', 'AGENTS.md'), NESTED)
    await writeFile(join(cwd, 'nested', 'task.txt'), 'ordinary task data')
    const started = Promise.withResolvers<AbortSignal>()
    const release = Promise.withResolvers<undefined>()
    ctx.tools.register(defineContentToolFixture({
      name: 'wait_fixture', description: 'Wait for the test to release this operation.', parameters: {},
      async execute(_args, exec) {
        started.resolve(exec.signal)
        await release.promise
        return [{ type: 'text', text: 'operation completed normally' }]
      },
    }))
    const completed = turn(agent)
    try {
      const signal = await started.promise
      expect(requestText(adapter.requests[1])).toContain(NESTED)
      await save(ctx, 'SUPERSEDED_INTERMEDIATE_RULE')
      await save(ctx, NEW)
      expect(signal.aborted).toBe(false)
      expect(adapter.requests).toHaveLength(2)
    } finally {
      release.resolve(undefined)
      await completed
    }
    const next = requestText(adapter.requests[2])
    expect(next).toContain(NEW)
    expect(next).toContain(NESTED)
    expect(next).toContain(PROJECT)
    expect(next).not.toContain(OLD)
    expect(next).not.toContain('SUPERSEDED_INTERMEDIATE_RULE')
    expect(JSON.stringify(adapter.requests[2]?.messages)).toContain('operation completed normally')
  })

  it('uses DSH_HOME when the plugin has no path override', async () => {
    const { ctx, agent, adapter, home } = await harness([textResponse('done')], { homeFromEnv: true })
    expect((await ctx.globalRules.read()).path).toBe(join(home, 'AGENTS.md'))
    await save(ctx, NEW)
    await turn(agent)
    expect(requestText(adapter.requests[0])).toContain(NEW)
  })

  it('reads Host globals even when the project filesystem offers another body at the same path', async () => {
    const { ctx, agent, adapter, home, cwd, createAgent } = await harness(
      Array.from({ length: 3 }, () => textResponse('done')),
    )
    const globalPath = join(home, 'AGENTS.md')
    const stream = ctx.fs.streamText.bind(ctx.fs)
    const providerRead = vi.spyOn(ctx.fs, 'streamText').mockImplementation(async (target, signal) => {
      if (target.displayPath === globalPath) {
        return (async function* () { yield 'DECOY_REMOTE_GLOBAL' })()
      }
      return stream(target, signal)
    })
    await turn(agent)
    expect(requestText(adapter.requests[0])).toContain(OLD)
    await save(ctx, NEW)
    await turn(agent)
    await turn(await createAgent('new-after-host-save'))
    for (const request of adapter.requests.slice(1)) {
      const text = requestText(request)
      expect(text).toContain(NEW)
      expect(text).not.toContain(OLD)
      expect(text).not.toContain('DECOY_REMOTE_GLOBAL')
      expect(text).toContain(PROJECT)
    }
    expect(providerRead.mock.calls.some(([target]) => target.displayPath === join(cwd, 'AGENTS.md'))).toBe(true)
    expect(providerRead.mock.calls.some(([target]) => target.displayPath === globalPath)).toBe(false)
  })

  it('reports disabled loading and still distinguishes file saving from model admission', async () => {
    const { ctx, agent, adapter, home } = await harness([textResponse('done')], { maxBytes: 0 })
    expect(await save(ctx, NEW)).toMatchObject({ content: NEW, loadingEnabled: false })
    expect(await readFile(join(home, 'AGENTS.md'), 'utf8')).toBe(NEW)
    await turn(agent)
    expect(requestText(adapter.requests[0])).not.toContain(NEW)
    expect(instructionEvents(agent)).toHaveLength(0)
  })

  it('omits a broad global rule when the request budget retains the specific project rule', async () => {
    const { ctx, agent, adapter } = await harness([textResponse('done')], { maxBytes: 600 })
    await save(ctx, NEW.repeat(100))
    await turn(agent)
    const text = requestText(adapter.requests[0])
    expect(text).not.toContain(NEW)
    expect(text).toContain(PROJECT)
    expect(text).toContain('Workspace instruction budget')
  })

  it('loads the same saved Host file for a real in-process spawned child', async () => {
    const { ctx, agent, adapter } = await harness([textResponse('parent'), textResponse('child')], { subagent: true })
    await turn(agent)
    await save(ctx, NEW)
    const run = await ctx.subagents.start('spawn', {
      parent: agent, prompt: [{ type: 'text', text: 'Do the delegated task.' }], signal: new AbortController().signal,
    })
    try {
      expect((await run.result).stopReason).toBe('completed')
      const child = ctx.agents.get(run.id)
      expect(child?.session.header.parentSession).toBe(agent.session.header.id)
      expect(instructionEvents(child!)).toHaveLength(1)
      expect(requestText(adapter.requests[1])).toContain(NEW)
      expect(requestText(adapter.requests[1])).toContain(PROJECT)
      expect(requestText(adapter.requests[1])).not.toContain(OLD)
    } finally {
      await run.dispose()
    }
  })

  it('refreshes another isolated preset from the default preset editor over the shared Host file', async () => {
    const { ctx, agent, adapter, createAgent, home } = await harness(
      Array.from({ length: 4 }, () => textResponse('done')), { presets: true },
    )
    const other = await createAgent('ptc-session', 'ptc-test')
    await turn(agent)
    await turn(other)
    expect(ctx.get('globalRules')).toBeUndefined()
    const defaultRules = serviceForScope(ctx, await ctx.agentPresets.standingKeyFor(), 'globalRules')
    const otherRules = serviceForAgent(ctx, other, 'globalRules')
    expect(defaultRules).toBeDefined()
    expect(otherRules).toBeDefined()
    expect(defaultRules).not.toBe(otherRules)
    expect((await defaultRules!.read()).path).toBe(join(home, 'AGENTS.md'))
    expect((await otherRules!.read()).path).toBe(join(home, 'AGENTS.md'))
    const document = await defaultRules!.read()
    await defaultRules!.save(NEW, document.revision)
    await turn(other)
    await turn(agent)
    for (const request of adapter.requests.slice(2)) {
      expect(requestText(request)).toContain(NEW)
      expect(requestText(request)).not.toContain(OLD)
    }
  })
})
