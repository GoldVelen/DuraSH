import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ReliabilityLoopRecord } from '@durash/dsh-reliability-loop'
import * as tool from '../src/index.ts'

const testToolSignal = new AbortController().signal
const SESSION = SessionId('root-1')

function agentWithUserTurn(): Agent {
  const session = Session.create(SESSION)
  session.append('turn/start', { turn: 1 })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'ship the widget' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  return { id: SESSION, session, status: 'running' } as unknown as Agent
}

function completedRecord(): ReliabilityLoopRecord {
  return {
    loopId: 'loop-1' as ReliabilityLoopRecord['loopId'],
    objective: 'ship the widget',
    createdAt: new Date().toISOString(),
    stage: 'completed',
    implement: { round: 1, summary: 'did the work', agentsStarted: 1 },
    review: { round: 1, verdict: 'approved', feedback: 'looks good', agentsStarted: 1 },
    settledAt: new Date().toISOString(),
  }
}

async function setup(options: {
  enabled?: boolean
  start?: ReturnType<typeof vi.fn>
} = {}): Promise<{ ctx: Context; agent: Agent; start: ReturnType<typeof vi.fn> }> {
  const agent = agentWithUserTurn()
  const start = options.start ?? vi.fn(async () => ({
    loopId: 'loop-1',
    result: Promise.resolve(completedRecord()),
    cancel: vi.fn(),
    dispose: async () => undefined,
  }))
  const ctx = new Context()
  ctx.provide('agents', {
    get: (id: string) => id === String(agent.id) ? agent : undefined,
    currentInitiator: () => agent,
    roots: () => [agent],
  })
  ctx.provide('reliabilityPolicy', {
    workflowEnabled: () => options.enabled === true,
    enabledRoutes: () => options.enabled === true
      ? {
        implementation: { provider: 'deepseek-official', model: 'deepseek-v4-pro' },
        review: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      }
      : undefined,
  })
  ctx.provide('reliabilityLoopRuntime', { start })
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(tool)
  return { ctx, agent, start }
}

describe('durash-tool-reliability', () => {
  it('registers the handoff tool', async () => {
    const { ctx } = await setup()
    expect(ctx.tools.schemas().some(schema => schema.name === 'dsh_reliability_handoff')).toBe(true)
  })

  it('omits guidance unless the session policy is enabled', async () => {
    const disabled = await setup({ enabled: false })
    const quiet = await disabled.ctx.systemPrompt.assemble({ scope: disabled.agent })
    expect(quiet.sections.some(section => section.text.includes('reliability loop is enabled'))).toBe(false)

    const enabled = await setup({ enabled: true })
    const guided = await enabled.ctx.systemPrompt.assemble({ scope: enabled.agent })
    expect(guided.sections.some(section => section.text.includes('reliability loop is enabled'))).toBe(true)
  })

  it('fails closed when the composer switch is off', async () => {
    const { ctx, agent } = await setup({ enabled: false })
    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: ToolCallId('call-off'),
      name: 'dsh_reliability_handoff',
      arguments: { objective: 'ship the widget' },
      agent,
    })
    expect(result.isError).toBe(true)
    if (!result.isError) throw new Error('expected disabled failure')
    expect(result.error.message).toMatch(/Turn on the composer workflow switch/)
  })

  it('starts the reliability loop with the session lanes when enabled', async () => {
    const { ctx, agent, start } = await setup({ enabled: true })
    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: ToolCallId('call-on'),
      name: 'dsh_reliability_handoff',
      arguments: { objective: 'ship the widget' },
      agent,
    })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    expect(start).toHaveBeenCalledWith({
      parent: agent,
      objective: 'ship the widget',
      implementation: { provider: 'deepseek-official', model: 'deepseek-v4-pro' },
      review: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    })
    expect(result.value).toMatchObject({ status: 'completed', verdict: 'approved' })
  })
})
