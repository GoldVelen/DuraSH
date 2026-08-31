import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@durash/dsh-reliability-policy'

export const name = 'snapshot-enable-reliability'
export const inject = ['tools', 'reliabilityPolicy']

/** Snapshot-only model tool that enables both lanes on the exact calling Session. */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'snapshot_enable_reliability',
    description: 'Enable the keyless reliability snapshot policy for this Session.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { enabled: { type: 'boolean', required: true } },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(_args, exec) {
      if (exec.agent === undefined) throw new Error('snapshot reliability setup requires a calling Agent')
      await ctx.reliabilityPolicy.configure({
        sessionId: exec.agent.session.id,
        enabled: true,
        implementationModel: 'deepseek-official/reliability-replay',
        implementationThinking: null,
        reviewModel: 'deepseek-official/reliability-replay',
        reviewThinking: null,
      })
      return { enabled: true }
    },
  }))
}
