import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as tool from '../src/index.ts'

const SESSION = SessionId('root-1')

function rootTurn(source: 'user' | 'plugin' = 'user'): Agent {
  const session = Session.create(SESSION)
  session.append('turn/start', { turn: 1 })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'ship the widget' }],
    source: source === 'user' ? { kind: 'user' } : { kind: 'plugin', plugin: 'resume-notice' },
  }), { surfaceOp: 'append' })
  return { id: SESSION, session, status: 'running' } as unknown as Agent
}

interface SetupOptions {
  readonly enabled?: boolean
  readonly agent?: Agent
  readonly openTurnStartSeq?: number | null
  readonly startDetached?: ReturnType<typeof vi.fn>
}

async function setup(options: SetupOptions = {}) {
  const agent = options.agent ?? rootTurn()
  const startDetached = options.startDetached ?? vi.fn(async () => ({
    loopId: 'loop-1',
    revision: 1,
    status: 'accepted',
  }))
  const ctx = new Context()
  ctx.provide('agents', {
    get: (id: string) => id === String(agent.id) ? agent : undefined,
    currentInitiator: () => agent,
    roots: () => [agent],
  })
  ctx.provide('sessionProjections', {
    stateOf: () => ({
      openTurnStartSeq: options.openTurnStartSeq === undefined ? 0 : options.openTurnStartSeq,
      lastStepStartSeq: null,
      lastStepBoundary: null,
      lastTurn: 1,
    }),
  })
  ctx.provide('reliabilityPolicy', {
    workflowEnabled: () => options.enabled === true,
    enabledRoutes: async () => options.enabled === true
      ? {
        implementation: { provider: 'xai', model: 'grok-4.6', reasoningEffort: 'high' },
        review: { provider: 'xai', model: 'grok-4.6', reasoningEffort: 'xhigh' },
      }
      : undefined,
  })
  ctx.provide('reliabilityLoopRuntime', { startDetached })
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(tool)
  return { ctx, agent, startDetached }
}

async function execute(ctx: Context, agent: Agent, signal = new AbortController().signal) {
  return ctx.tools.execute({
    signal,
    callId: ToolCallId('call-handoff'),
    name: 'dsh_reliability_handoff',
    arguments: { objective: ' ship the widget ' },
    agent,
  })
}

describe('durash-tool-reliability', () => {
  it('registers the handoff tool and only advertises it for an enabled policy', async () => {
    const disabled = await setup()
    expect(disabled.ctx.tools.schemas().some(schema => schema.name === 'dsh_reliability_handoff')).toBe(true)
    expect((await disabled.ctx.systemPrompt.assemble({ scope: disabled.agent })).sections
      .some(section => section.text.includes('reliability workflow is enabled'))).toBe(false)

    const enabled = await setup({ enabled: true })
    expect((await enabled.ctx.systemPrompt.assemble({ scope: enabled.agent })).sections
      .some(section => section.text.includes('reliability workflow is enabled'))).toBe(true)
  })

  it('fails closed when the policy is disabled', async () => {
    const { ctx, agent } = await setup()
    const result = await execute(ctx, agent)
    expect(result.isError).toBe(true)
    if (!result.isError) throw new Error('expected disabled failure')
    expect(result.error.message).toMatch(/Enable it/)
  })

  it('returns the acceptance receipt without waiting for any workflow terminal', async () => {
    const { ctx, agent, startDetached } = await setup({ enabled: true })
    const result = await execute(ctx, agent)
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    expect(startDetached).toHaveBeenCalledWith({
      parent: agent,
      objective: 'ship the widget',
      implementation: { provider: 'xai', model: 'grok-4.6', reasoningEffort: 'high' },
      review: { provider: 'xai', model: 'grok-4.6', reasoningEffort: 'xhigh' },
    })
    expect(result.value).toEqual({ loopId: 'loop-1', revision: 1, status: 'accepted' })
  })

  it('does not pass the outer tool abort signal into the accepted background workflow', async () => {
    const accepted = Promise.withResolvers<{ loopId: string; revision: number; status: 'accepted' }>()
    const startDetached = vi.fn(() => accepted.promise)
    const { ctx, agent } = await setup({ enabled: true, startDetached })
    const controller = new AbortController()
    const pending = execute(ctx, agent, controller.signal)
    await vi.waitFor(() => { expect(startDetached).toHaveBeenCalledOnce() })
    controller.abort(new Error('outer tool ended'))
    accepted.resolve({ loopId: 'loop-1', revision: 1, status: 'accepted' })
    const result = await pending
    expect(result.isError).toBe(true)
    expect(startDetached).toHaveBeenCalledOnce()
  })

  it('requires the initiating message of the current open turn to be direct human input', async () => {
    const agent = rootTurn('plugin')
    agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'late human steering' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    const { ctx } = await setup({ enabled: true, agent })
    const result = await execute(ctx, agent)
    expect(result.isError).toBe(true)
    if (!result.isError) throw new Error('expected authority failure')
    expect(result.error.message).toMatch(/originate from direct human input/)
  })

  it('rejects a historical human message when no model turn is currently open', async () => {
    const { ctx, agent } = await setup({ enabled: true, openTurnStartSeq: null })
    const result = await execute(ctx, agent)
    expect(result.isError).toBe(true)
    if (!result.isError) throw new Error('expected driver failure')
    expect(result.error.message).toMatch(/open model turn/)
  })
})
