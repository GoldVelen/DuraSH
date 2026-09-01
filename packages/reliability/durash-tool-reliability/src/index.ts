/**
 * Model-facing foreground handoff into the DuraSH reliability loop. The tool
 * is registered process-wide and fails closed unless this Session's composer
 * switch is on.
 * @module @durash/dsh-tool-reliability
 */

import type { Context } from '@deepseek-ai/cordis'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { ReliabilityLoopRecord } from '@durash/dsh-reliability-loop'
import type {} from '@durash/dsh-reliability-policy'
import type {} from '@deepseek-ai/dsh-agent'

export const name = 'tool-reliability'
export const inject = ['tools', 'systemPrompt', 'agents', 'reliabilityPolicy', 'reliabilityLoopRuntime']

const TOOL_NAME = 'dsh_reliability_handoff'
const SECTION_ORDER = 2650
const COMPACT_SUMMARY_CHARS = 800

const DESCRIPTION = 'After presenting the implementation plan in the ordinary assistant response, hand the '
  + 'current objective to the enabled reliability loop and wait for one implementation stage, one '
  + 'independent review, and at most one rework pass to reach a terminal result. Supply the complete '
  + 'objective. This is a foreground call: do not poll or repeat the same handoff while it is pending.'

const GUIDANCE = 'For this Session the reliability loop is enabled. This tool is the only implementer '
  + 'dispatch path. Never write an execution prompt or copy-paste brief for the human to give to another '
  + 'model or agent. Analyze the human request, present a concise implementation plan in the same Step, '
  + 'then call dsh_reliability_handoff with the complete objective. Ordinary questions and read-only '
  + 'review stay on this Session and do not hand off. The call remains in the current model turn until '
  + 'the loop is completed, blocked, cancelled, or failed; after its compact result arrives, explain '
  + 'that result to the human. If the workflow is disabled, the tool fails closed.'

interface HandoffArgs {
  readonly objective: string
}

function compactText(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/gu, ' ').trim()
  const characters = Array.from(normalized)
  if (characters.length <= maxChars) return normalized
  return `${characters.slice(0, Math.max(0, maxChars - 1)).join('')}…`
}

function compactRecord(record: ReliabilityLoopRecord) {
  const summary = record.stage === 'completed'
    ? (record.implement?.summary ?? record.review?.feedback ?? 'completed')
    : record.stage === 'blocked'
      ? (record.review?.feedback ?? 'blocked')
      : record.error ?? record.stage
  return {
    status: record.stage,
    summary: compactText(summary, COMPACT_SUMMARY_CHARS),
    ...record.review === undefined ? {} : { verdict: record.review.verdict },
  }
}

function requireRootHandoff(ctx: Context, exec: ToolRunContext) {
  const agent = exec.agent
  if (agent === undefined) {
    throw new HarnessError(`${TOOL_NAME} requires a calling agent`, 'RELIABILITY_TOOL_AGENT_REQUIRED')
  }
  if (ctx.agents.get(agent.id) !== agent || agent.status !== 'running'
    || ctx.agents.currentInitiator() !== agent || !ctx.agents.roots().includes(agent)) {
    throw new HarnessError(
      `${TOOL_NAME} requires the exact live root agent inside its active driver`,
      'RELIABILITY_TOOL_DRIVER_REQUIRED',
    )
  }
  const human = agent.session.events.some(event =>
    event.type === 'user/message' && event.data.source.kind === 'user')
  if (!human) {
    throw new HarnessError(`${TOOL_NAME} requires a direct human turn on a top-level agent`, 'RELIABILITY_TOOL_HUMAN_REQUIRED')
  }
  return agent
}

/** Loader entrypoint: contribute the gated reliability handoff tool. */
export function apply(ctx: Context): void {
  ctx.systemPrompt.section({
    name: 'tool:reliability-handoff',
    order: SECTION_ORDER,
    text: ({ scope }) => {
      if (scope === undefined) return GUIDANCE
      const agent = ctx.agents.roots().find(candidate => candidate === scope)
      if (agent === undefined) return ''
      return ctx.reliabilityPolicy.workflowEnabled(agent.id) ? GUIDANCE : ''
    },
  })

  ctx.tools.register(defineTool({
    name: TOOL_NAME,
    description: DESCRIPTION,
    parameters: {
      objective: {
        type: 'string',
        required: true,
        description: 'Complete implementation objective and user-visible outcome.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string', required: true },
          summary: { type: 'string', required: true },
          verdict: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(rawArgs, exec) {
      const objective = rawArgs.objective.trim()
      if (objective.length === 0) {
        throw new HarnessError(`${TOOL_NAME} requires a non-empty objective`, 'RELIABILITY_TOOL_INVALID_OBJECTIVE')
      }
      const agent = requireRootHandoff(ctx, exec)
      const routes = ctx.reliabilityPolicy.enabledRoutes(agent.id)
      if (routes === undefined) {
        throw new HarnessError(
          'Reliability loop is unavailable for this Session. Turn on the composer workflow switch and pick both models.',
          'RELIABILITY_TOOL_DISABLED',
        )
      }
      const handle = await ctx.reliabilityLoopRuntime.start({
        parent: agent,
        objective,
        implementation: routes.implementation,
        review: routes.review,
      })
      exec.signal.addEventListener('abort', () => { handle.cancel('reliability handoff cancelled') }, { once: true })
      try {
        const record = await handle.result
        return compactRecord(record)
      } finally {
        await handle.dispose()
      }
    },
    presentCall: (args: HandoffArgs) => ({
      card: 'generic',
      title: 'Reliability loop',
      kind: 'execute',
      rawInput: args.objective,
    } satisfies GenericCallView),
  }))
}
