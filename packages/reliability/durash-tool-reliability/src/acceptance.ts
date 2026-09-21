/** Direct-mode evidence tools; calls record observations without starting another model.
 * @module @durash/dsh-tool-reliability/acceptance
 */
import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { AcceptanceTaskId } from '@durash/dsh-reliability-loop'

const DESCRIPTION = 'Declare acceptance requirements, run a declared check, or read executor evidence. No second model is called. '
  + 'Use plan with JSON requirements before validation; origin=user requires a verbatim quote from the human request and cannot later be weakened. '
  + 'Each requirement has id, origin(user|plan), description, command, scope(relative Git input paths), kind(command|pytest-junit|xcresult), '
  + 'level(process|test|ui), required(boolean), attachments(paths), produces(build output paths), allowSkipIf(check ids). '
  + 'Optional fields: userQuote, reportPath, buildCheckId, externalBoundary, skipBindings([{testId,reason,prerequisite}]), target({adapter,constraints,expected,options}). '
  + 'Each skipped test needs an exact observed testId and reason binding to a check listed in allowSkipIf; a suite-wide prerequisite is insufficient. Target constraints fix logical identity; expected digest and selector options may change with a recorded plan revision, invalidating old evidence. Use action=target to observe identity before pinning constraints and expected. Test reportPath and command must include {run} for fresh unique reports. UI requires observable-result attachments plus semantic review; logs are insufficient. '
  + 'Run accepts only an existing checkId; the host executes its stored command and captures source before execution. '
  + 'Status with checkId opens raw receipts and attachment indexes; status without it gives a bounded overview. TaskId is required for stage children. '
  + 'Plan revisions require a factual reason. Do not convert unresolved work into a human prerequisite or lower success criteria.'

/** Contribute always-available direct evidence tools to the existing tool consumer.
 * @param ctx - reliability and tools context.
 */
export function registerAcceptanceTool(ctx: Context): void {
  const lastContext = new WeakMap<Agent, string>()
  ctx.on('agent/pre-step', async ({ agent, step }, next) => {
    const decision = await next()
    if (decision.kind === 'reject' || (step === 1 && decision.messages.length === 0)) return decision
    const state = await ctx.reliabilityLoopRuntime.acceptanceView(agent.id)
    if (!state) return decision
    const text = JSON.stringify({
      status: state.status, checksPassed: state.checksPassed, independentReview: state.independentReview,
      reasons: state.reasons, risks: state.risks,
    })
    if (lastContext.get(agent) === text) return decision
    lastContext.set(agent, text)
    return { ...decision, messages: [...decision.messages, createUserMessage({ content: [{ type: 'text', text: `Host acceptance observations (not model claims): ${text}` }], source: { kind: 'plugin', plugin: 'durash-acceptance', form: 'notice', summary: 'Host acceptance checks and unreviewed test changes' } })] }
  })
  ctx.tools.register(defineTool({
    name: 'dsh_acceptance', description: DESCRIPTION,
    parameters: {
      action: { type: 'string', enum: ['plan', 'run', 'status', 'target'], required: true, description: 'Declare/revise requirements, execute a stored check, or inspect evidence.' },
      adapter: { type: 'string', description: 'Trusted target adapter to observe before pinning its expected digest, e.g. ios-local-bundle.' },
      options: { type: 'string', description: 'JSON string map of adapter selectors, e.g. appPath and widgetPath; never a result.' },
      taskId: { type: 'string', description: 'Task id from the host, especially when working as a workflow child.' },
      checkId: { type: 'string', description: 'Exact declared check to run or inspect.' },
      objective: { type: 'string', description: 'Stable task objective when declaring a plan.' },
      requirements: { type: 'string', description: 'JSON array of task-specific requirements described above; only used by plan.' },
      reason: { type: 'string', description: 'Facts explaining the initial plan or its revision.' },
    },
    output: {
      schema: { type: 'object', properties: { taskId: { type: 'string' }, receiptId: { type: 'string' }, status: { type: 'string', required: true }, evidence: { type: 'string', required: true } }, additionalProperties: false },
      presentationMeta: (_args, value) => ({
        ...value.taskId ? { taskId: value.taskId } : {}, ...value.receiptId ? { receiptId: value.receiptId } : {},
      }),
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const agent = exec.agent
      if (!agent) throw new Error('Acceptance requires a calling agent')
      const runtime = ctx.reliabilityLoopRuntime
      const store = runtime.acceptance
      if (args.action === 'target') {
        const cwd = agent.session.header.cwd
        if (!cwd || !args.adapter || !args.options) throw new Error('Target observation requires workspace, adapter and options')
        const options: unknown = JSON.parse(args.options)
        if (!options || typeof options !== 'object' || Array.isArray(options)
          || Object.values(options).some(value => typeof value !== 'string')) throw new Error('Target options must be a string map')
        const target = await store.observeTarget(args.adapter, cwd, options as Record<string, string>, exec.signal)
        return { status: 'observed-not-accepted', evidence: JSON.stringify(target) }
      }
      if (args.action === 'plan') {
        if (!ctx.agents.roots().includes(agent)) throw new Error('Only the root conversation may revise the validation plan')
        if (!args.objective || !args.requirements || !args.reason) throw new Error('Plan requires objective, requirements, and reason')
        const cwd = agent.session.header.cwd
        if (!cwd) throw new Error('Acceptance requires a declared workspace')
        // oxlint-disable-next-line typescript/no-deprecated -- Human quotations are checked against original persisted messages.
        const humanTexts = agent.session.snapshotEvents().flatMap(event => event.type === 'user/message' && event.data.source.kind === 'user'
          ? event.data.content.flatMap(block => block.type === 'text' ? [block.text] : []) : [])
        const task = await store.plan({
          sessionId: agent.id, cwd, objective: args.objective, requirements: JSON.parse(args.requirements), reason: args.reason, humanTexts,
        }, exec.signal)
        return { taskId: task.taskId, status: 'pending', evidence: JSON.stringify({ taskId: task.taskId, revision: task.revision, requirements: task.requirements, independentReview: 'not-reviewed' }) }
      }
      const id = args.taskId as AcceptanceTaskId | undefined ?? store.activeTask(agent.id)
      if (!id) return { status: 'not-configured', evidence: 'No acceptance requirements declared; ordinary questions are unaffected.' }
      const taskOwner = store.get(id).sessionId
      let owner: Agent | undefined = agent
      const visited = new Set<string>()
      while (owner && owner.id !== taskOwner && !visited.has(owner.id)) {
        visited.add(owner.id)
        const parent: SessionId | undefined = owner.session.header.parentSession
        owner = parent ? ctx.agents.get(parent) : undefined
      }
      if (!owner || owner.id !== taskOwner) throw new Error('Acceptance task belongs to another root session')
      if (args.action === 'run') {
        if (!args.checkId) throw new Error('Run requires checkId')
        const receipt = await store.run(id, args.checkId, runtime.evidenceIO(agent.session), exec.signal)
        return { taskId: id, receiptId: receipt.id, status: receipt.outcome, evidence: JSON.stringify({ taskId: id, receiptId: receipt.id, problems: receipt.problems, independentReview: 'not-reviewed', inspect: 'Use status with checkId to open raw evidence.' }) }
      }
      const state = await store.inspect(id, exec.signal)
      if (args.checkId) {
        const task = store.get(id)
        const check = task.requirements.find(value => value.id === args.checkId)
        if (!check) throw new Error('Unknown checkId')
        const latest = task.evidence.findLast(value => value.checkId === args.checkId)
        return {
          taskId: id, status: state.status,
          evidence: JSON.stringify({
            check, latest,
            previousAttempts: task.evidence.filter(value => value.checkId === args.checkId)
              .map(value => ({ id: value.id, outcome: value.outcome, problems: value.problems })),
            independentReview: state.independentReview,
          }),
        }
      }
      return { taskId: id, status: state.status, evidence: state.index }
    },
    presentCall: args => ({ card: 'generic', title: 'Acceptance evidence', kind: 'execute', rawInput: JSON.stringify(args) }),
  }))
}
