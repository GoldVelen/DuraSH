/**
 * Reliability-loop composer switch: one controller and the
 * `conversation.input.left` chip that reads and writes Host policy.
 * @module @durash/dsh-client-ui-reliability/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { ReliabilityPolicyController, type ReliabilityPolicyRemote } from './controller.ts'
import { WorkflowPolicyDock, type WorkflowPolicyDockInjected } from './WorkflowPolicyDock.tsx'
import { en, NS, zh, type ReliabilityKey } from './locales.ts'

export type { ReliabilityKey } from './locales.ts'
export type { WorkflowPolicyDockInjected } from './WorkflowPolicyDock.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Copy owned by the composer reliability-loop switch. */
    reliability: ReliabilityKey
  }
}

/** Required controller, generated Remote, locale, and conversation slot services. */
export const inject = [
  'slots', 'remote', 'remote.reliabilityPolicy', 'locale',
]

/** Install the process-wide policy controller and the composer chip. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-reliability: dictionaries')
  const remote = (ctx.remote as typeof ctx.remote & { reliabilityPolicy: ReliabilityPolicyRemote }).reliabilityPolicy
  const controller = new ReliabilityPolicyController(remote)
  ctx.effect(() => () => { controller.dispose() }, 'ui-reliability: controller')

  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: 'workflow',
    order: 20,
    locale: NS,
    inject: (sessionId): WorkflowPolicyDockInjected => ({
      hooks: { policy: controller },
      readPolicy: () => controller.sessionState(sessionId),
      loadPolicy: () => controller.loadPolicy(sessionId),
      ensurePolicy: () => controller.ensurePolicy(sessionId),
      configure: request => controller.configure(request),
      sessionId,
    }),
  }, WorkflowPolicyDock))
}
