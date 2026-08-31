/**
 * Model-facing fast handoff into the Host-owned DuraSH reliability loop.
 * @module @durash/dsh-tool-reliability
 */

import type { Context } from '@deepseek-ai/cordis'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@durash/dsh-reliability-loop'
import type {} from '@durash/dsh-reliability-policy'

export const name = 'tool-reliability'
export const inject = [
  'tools',
  'systemPrompt',
  'agents',
  'sessionProjections',
  'reliabilityPolicy',
  'reliabilityLoopRuntime',
]

const TOOL_NAME = 'dsh_reliability_handoff'
const SECTION_ORDER = 2650

const DESCRIPTION = 'After presenting the implementation plan in the ordinary assistant response, persist '
  + 'the complete objective for the enabled reliability workflow. The Host runs implementation, independent '
  + 'review, and at most one rework pass in the background. This call returns immediately after durable '
  + 'acceptance. Do not poll or repeat it; progress appears above the composer.'

const GUIDANCE = 'For this Session the reliability workflow is enabled. Analyze the direct human request, '
  + 'present a concise implementation plan in the same Step, then call dsh_reliability_handoff once with the '
  + 'complete objective. The call returns a durable acceptance receipt; implementation and review continue '
  + 'under Host ownership after this model turn ends. Do not poll, repeat the handoff, or narrate live telemetry. '
  + 'The composer status bar shows progress and the conversation receives one persistent terminal result. '
  + 'Ordinary questions and read-only review stay on this Session and do not hand off.'

interface HandoffArgs {
  readonly objective: string
}

/** Authenticate the exact live root and the initiating message of its current open turn. */
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
  const boundary = ctx.sessionProjections.stateOf(agent.session, 'turnBoundary')
  if (boundary === undefined || boundary.openTurnStartSeq === null) {
    throw new HarnessError(`${TOOL_NAME} requires an open model turn`, 'RELIABILITY_TOOL_DRIVER_REQUIRED')
  }
  const initiating = agent.session.events
    .slice(boundary.openTurnStartSeq + 1)
    .find(event => event.type === 'user/message')
  if (initiating?.type !== 'user/message' || initiating.data.source.kind !== 'user') {
    throw new HarnessError(
      `${TOOL_NAME} requires the current root turn to originate from direct human input`,
      'RELIABILITY_TOOL_HUMAN_REQUIRED',
    )
  }
  return agent
}

/** Loader entrypoint: contribute the policy-gated background handoff. */
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
          loopId: { type: 'string', required: true },
          revision: { type: 'number', required: true },
          status: { type: 'string', enum: ['accepted'], required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(rawArgs, exec) {
      const objective = typeof rawArgs.objective === 'string' ? rawArgs.objective.trim() : ''
      if (objective.length === 0) {
        throw new HarnessError(`${TOOL_NAME} requires a non-empty objective`, 'RELIABILITY_TOOL_INVALID_OBJECTIVE')
      }
      const agent = requireRootHandoff(ctx, exec)
      const routes = await ctx.reliabilityPolicy.enabledRoutes(agent.id)
      if (routes === undefined) {
        throw new HarnessError(
          'Reliability workflow is unavailable for this Session. Enable it and select both stage models.',
          'RELIABILITY_TOOL_DISABLED',
        )
      }
      return ctx.reliabilityLoopRuntime.startDetached({
        parent: agent,
        objective,
        implementation: routes.implementation,
        review: routes.review,
      })
    },
    presentCall: (args: HandoffArgs) => ({
      card: 'generic',
      title: 'Reliability workflow',
      kind: 'execute',
      rawInput: args.objective,
    } satisfies GenericCallView),
  }))
}
