import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { TOOL_RUNTIME_SCHEDULER } from '@deepseek-ai/dsh-tools'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ReliabilityLoopRecord } from '@durash/dsh-reliability-loop'
import * as tool from '../src/index.ts'

const testToolSignal = new AbortController().signal
const SESSION = SessionId('root-1')

function testAgent(options: { human?: boolean; status?: 'idle' | 'running'; id?: string } = {}): Agent {
  const session = Session.create(SessionId(options.id ?? SESSION))
  session.append('turn/start', { turn: 1 })
  if (options.human !== false) {
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'ship the widget' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
  }
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  const unsupported = (): never => { throw new Error('Unexpected test Agent capability access') }
  return {
    id: session.id, session, status: options.status ?? 'running', options: {}, ctx,
    inbox: {
      nextTurn: [], nextStep: [], clear: unsupported, append: unsupported,
      prepend: unsupported, replace: unsupported, remove: unsupported, splice: unsupported,
    },
    cancel: unsupported, whenIdle: unsupported, runMaintenance: unsupported,
    send: unsupported, followup: unsupported, steer: unsupported, inject: unsupported,
  }
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
  agent?: Agent
  getAgent?: (id: string) => Agent | undefined
  currentInitiator?: () => Agent | undefined
  roots?: () => Agent[]
} = {}): Promise<{ ctx: Context; agent: Agent; start: ReturnType<typeof vi.fn> }> {
  const agent = options.agent ?? testAgent()
  const start = options.start ?? vi.fn(async () => ({
    loopId: 'loop-1',
    result: Promise.resolve(completedRecord()),
    cancel: vi.fn(),
    dispose: async () => undefined,
  }))
  const ctx = new Context()
  ctx.provide('agents', {
    get: options.getAgent ?? ((id: string) => id === String(agent.id) ? agent : undefined),
    currentInitiator: options.currentInitiator ?? (() => agent),
    roots: options.roots ?? (() => [agent]),
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
  ctx.provide('reliabilityLoopRuntime', {
    start, acceptance: { activeTask: () => undefined }, acceptanceView: () => Promise.resolve(null),
  })
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(tool)
  return { ctx, agent, start }
}

describe('durash-tool-reliability', () => {
  it('registers the handoff tool', async () => {
    const { ctx } = await setup()
    expect(ctx.tools.schemas().some(schema => schema.name === 'dsh_reliability_handoff')).toBe(true)
    expect(ctx.tools.get('dsh_reliability_handoff')?.presentCall?.({ objective: 'ship the widget' })).toEqual({
      card: 'generic',
      title: 'Reliability loop',
      kind: 'execute',
      rawInput: 'ship the widget',
    })
  })

  it('omits guidance unless the session policy is enabled', async () => {
    const disabled = await setup({ enabled: false })
    const quiet = await disabled.ctx.systemPrompt.assemble({ scope: disabled.agent })
    expect(quiet.sections.some(section => section.text.includes('reliability loop is enabled'))).toBe(false)

    const enabled = await setup({ enabled: true })
    const guided = await enabled.ctx.systemPrompt.assemble({ scope: enabled.agent })
    expect(guided.sections.some(section => section.text.includes('reliability loop is enabled'))).toBe(true)

    const unscoped = await enabled.ctx.systemPrompt.assemble()
    expect(unscoped.sections.some(section => section.text.includes('reliability loop is enabled'))).toBe(true)
    const unrelated = testAgent({ id: 'unrelated' })
    const unrelatedPrompt = await enabled.ctx.systemPrompt.assemble({ scope: unrelated })
    expect(unrelatedPrompt.sections.some(section => section.text.includes('reliability loop is enabled'))).toBe(false)
  })

  it('rejects blank objectives and calls without an agent', async () => {
    const blank = await setup({ enabled: true })
    const blankResult = await blank.ctx.tools.execute({
      signal: testToolSignal,
      callId: ToolCallId('call-blank'),
      name: 'dsh_reliability_handoff',
      arguments: { objective: '   ' },
      agent: blank.agent,
    })
    expect(blankResult.isError).toBe(true)
    if (!blankResult.isError) throw new Error('expected blank objective failure')
    expect(blankResult.error.message).toContain('non-empty objective')

    const missingAgent = await setup({ enabled: true })
    const missingResult = await missingAgent.ctx.tools.execute({
      signal: testToolSignal,
      callId: ToolCallId('call-agentless'),
      name: 'dsh_reliability_handoff',
      arguments: { objective: 'ship the widget' },
    })
    expect(missingResult.isError).toBe(true)
    if (!missingResult.isError) throw new Error('expected agent-required failure')
    expect(missingResult.error.message).toContain('requires a calling agent')
  })

  it('requires the exact running root inside its active driver', async () => {
    const wrongLookup = await setup({ enabled: true, getAgent: () => undefined })
    const idleAgent = testAgent({ status: 'idle', id: 'idle-agent' })
    const idle = await setup({ enabled: true, agent: idleAgent })
    const wrongInitiator = await setup({ enabled: true, currentInitiator: () => undefined })
    const detachedRoot = await setup({ enabled: true, roots: () => [] })

    for (const [label, mounted] of [
      ['lookup', wrongLookup],
      ['idle', idle],
      ['initiator', wrongInitiator],
      ['root', detachedRoot],
    ] as const) {
      const result = await mounted.ctx.tools.execute({
        signal: testToolSignal,
        callId: ToolCallId(`call-driver-${label}`),
        name: 'dsh_reliability_handoff',
        arguments: { objective: 'ship the widget' },
        agent: mounted.agent,
      })
      expect(result.isError).toBe(true)
      if (!result.isError) throw new Error('expected driver-required failure')
      expect(result.error.message).toContain('exact live root agent')
    }
  })

  it('requires a direct human turn', async () => {
    const agent = testAgent({ human: false, id: 'no-human' })
    const { ctx } = await setup({ enabled: true, agent })
    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: ToolCallId('call-no-human'),
      name: 'dsh_reliability_handoff',
      arguments: { objective: 'ship the widget' },
      agent,
    })
    expect(result.isError).toBe(true)
    if (!result.isError) throw new Error('expected human-turn failure')
    expect(result.error.message).toContain('requires a direct human turn')
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

  it('compacts each terminal result and bounds a long implementation summary', async () => {
    const base = completedRecord()
    const records: ReliabilityLoopRecord[] = [
      {
        ...base,
        stage: 'completed',
        implement: { round: 1, summary: '界'.repeat(900), agentsStarted: 1 },
      },
      {
        ...base,
        stage: 'blocked',
        implement: { round: 2, summary: 'reworked', agentsStarted: 1 },
        review: { round: 2, verdict: 'changes-requested', feedback: 'still blocked', agentsStarted: 1 },
      },
      {
        ...base,
        stage: 'failed',
        implement: undefined,
        review: undefined,
        error: 'provider failed',
      },
      {
        ...base,
        stage: 'cancelled',
        implement: undefined,
        review: undefined,
      },
      { ...base, stage: 'completed', implement: undefined },
      { ...base, stage: 'completed', implement: undefined, review: undefined },
      { ...base, stage: 'blocked', implement: undefined, review: undefined },
    ]
    const expected = [
      { status: 'completed', verdict: 'approved' },
      { status: 'blocked', summary: 'still blocked', verdict: 'changes-requested' },
      { status: 'failed', summary: 'provider failed' },
      { status: 'cancelled', summary: 'cancelled' },
      { status: 'completed', summary: 'looks good', verdict: 'approved' },
      { status: 'completed', summary: 'completed' },
      { status: 'blocked', summary: 'blocked' },
    ]
    for (const [index, record] of records.entries()) {
      const start = vi.fn(async () => ({
        loopId: 'loop-1',
        result: Promise.resolve(record),
        cancel: vi.fn(),
        dispose: async () => undefined,
      }))
      const { ctx, agent } = await setup({ enabled: true, start })
      const result = await ctx.tools.execute({
        signal: testToolSignal,
        callId: ToolCallId(`call-terminal-${String(index)}`),
        name: 'dsh_reliability_handoff',
        arguments: { objective: 'ship the widget' },
        agent,
      })
      expect(result.isError).toBe(false)
      if (result.isError) throw new Error('expected terminal result')
      const expectation = expected[index]
      if (expectation === undefined) throw new Error('missing terminal expectation')
      expect(result.value).toMatchObject(expectation)
      if (index === 0) {
        const summary = (result.value as { summary: string }).summary
        expect(Array.from(summary)).toHaveLength(800)
        expect(summary.endsWith('…')).toBe(true)
      }
    }
  })

  it('cancels the live loop when the tool call is aborted and always disposes the handle', async () => {
    const settled = Promise.withResolvers<ReliabilityLoopRecord>()
    const cancel = vi.fn()
    const dispose = vi.fn(async () => undefined)
    const start = vi.fn(async () => ({
      loopId: 'loop-1', result: settled.promise, cancel, dispose,
    }))
    const { ctx, agent } = await setup({ enabled: true, start })
    const controller = new AbortController()
    const executing = ctx.tools.execute({
      signal: controller.signal,
      callId: ToolCallId('call-abort'),
      name: 'dsh_reliability_handoff',
      arguments: { objective: 'ship the widget' },
      agent,
    })
    await vi.waitUntil(() => start.mock.calls.length === 1)
    controller.abort()
    expect(cancel).toHaveBeenCalledWith('reliability handoff cancelled')
    settled.resolve(completedRecord())
    await expect(executing).resolves.toMatchObject({ isError: true })
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('refuses an already-cancelled handoff before starting a loop', async () => {
    const { ctx, agent, start } = await setup({ enabled: true })
    const controller = new AbortController()
    try {
      const handoff = ctx.tools.get('dsh_reliability_handoff')!
      const prepared = await ctx.tools[TOOL_RUNTIME_SCHEDULER].prepare({
        agent, signal: controller.signal, callId: ToolCallId('already-cancelled-handoff'),
        name: 'dsh_reliability_handoff', arguments: { objective: 'ship the widget' },
      })
      if (prepared.kind !== 'dispatch') throw new Error('Expected prepared handoff')
      controller.abort(new Error('already stopped'))
      // Exercise the executor's own cancellation check without the registry's pre-dispatch guard.
      await expect(handoff.execute(prepared.exec.arguments, prepared.exec)).rejects.toThrow('already stopped')
      expect(start).not.toHaveBeenCalled()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('cancels a loop published after its handoff was stopped during startup', async () => {
    const releaseStart = Promise.withResolvers<undefined>()
    const settled = Promise.withResolvers<ReliabilityLoopRecord>()
    const awaitingResult = vi.fn(() => settled.promise)
    const cancel = vi.fn()
    const dispose = vi.fn(async () => undefined)
    const start = vi.fn(async () => {
      await releaseStart.promise
      return {
        loopId: 'loop-1', cancel, dispose,
        get result() {
          return awaitingResult()
        },
      }
    })
    const { ctx, agent } = await setup({ enabled: true, start })
    const controller = new AbortController()
    const executing = ctx.tools.execute({
      signal: controller.signal, callId: ToolCallId('cancel-starting-handoff'),
      name: 'dsh_reliability_handoff', arguments: { objective: 'ship the widget' }, agent,
    })
    try {
      await vi.waitFor(() => { expect(start).toHaveBeenCalledOnce() })
      controller.abort()
      releaseStart.resolve(undefined)
      await vi.waitFor(() => { expect(awaitingResult).toHaveBeenCalledOnce() })
      expect(cancel).toHaveBeenCalledExactlyOnceWith('reliability handoff cancelled')
      settled.resolve({ ...completedRecord(), stage: 'cancelled', implement: undefined, review: undefined })
      const result = await executing
      expect(result).toMatchObject({ isError: true, error: { info: { code: 'ABORTED' } } })
      expect(result).not.toHaveProperty('value')
      expect(dispose).toHaveBeenCalledOnce()
    } finally {
      releaseStart.resolve(undefined)
      settled.resolve(completedRecord())
      try { await executing }
      finally { await ctx.fiber.dispose() }
    }
  })

  it.each(['completed', 'rejected'] as const)('detaches cancellation while disposing a %s loop result', async (outcome) => {
    const cancel = vi.fn()
    const disposal = Promise.withResolvers<undefined>()
    const dispose = vi.fn(() => disposal.promise)
    const start = vi.fn(async () => ({
      loopId: 'loop-1', cancel, dispose,
      get result() {
        return outcome === 'completed' ? Promise.resolve(completedRecord()) : Promise.reject(new Error('storage failed'))
      },
    }))
    const { ctx, agent } = await setup({ enabled: true, start })
    const controller = new AbortController()
    const executing = ctx.tools.execute({
      signal: controller.signal, callId: ToolCallId(`settled-handoff-${outcome}`),
      name: 'dsh_reliability_handoff', arguments: { objective: 'ship the widget' }, agent,
    })
    let executionSettled = false
    void executing.then(
      () => { executionSettled = true },
      () => { executionSettled = true },
    )
    try {
      await vi.waitFor(() => { expect(dispose).toHaveBeenCalledOnce() })
      expect(executionSettled).toBe(false)
      controller.abort()
      expect(cancel).not.toHaveBeenCalled()
      disposal.resolve(undefined)
      const result = await executing
      expect(result).toMatchObject(outcome === 'completed'
        ? { isError: true, error: { info: { code: 'ABORTED' } } }
        : { isError: true, error: { message: 'storage failed' } })
      expect(result).not.toHaveProperty('value')
    } finally {
      disposal.resolve(undefined)
      try { await executing }
      finally { await ctx.fiber.dispose() }
    }
  })
})
