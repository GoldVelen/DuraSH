/**
 * Reliability-loop Client surfaces: composer policy, projected status, and
 * one durable terminal Chat result.
 * @module @durash/dsh-client-ui-reliability/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@durash/dsh-reliability-loop/client'
import { ReliabilityPolicyController, type ReliabilityPolicyRemote } from './controller.ts'
import { ReliabilityStatusDock, type ReliabilityStatusDockInjected } from './ReliabilityStatusDock.tsx'
import { ReliabilityTerminalView, type ReliabilityTerminalViewInjected } from './ReliabilityTerminalView.tsx'
import { reliabilityTerminalDefinition } from './reliability-terminal-definition.ts'
import { WorkflowPolicyDock, type WorkflowPolicyDockInjected } from './WorkflowPolicyDock.tsx'
import { en, NS, zh, type ReliabilityKey } from './locales.ts'

export type { ReliabilityKey } from './locales.ts'
export type { ReliabilityStatusDockInjected } from './ReliabilityStatusDock.tsx'
export type { ReliabilityTerminalViewInjected } from './ReliabilityTerminalView.tsx'
export type { WorkflowPolicyDockInjected } from './WorkflowPolicyDock.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Copy owned by the composer reliability-loop switch. */
    reliability: ReliabilityKey
  }
}

/** Required controller, generated Remote, locale, and conversation slot services. */
export const inject = [
  'slots', 'remote', 'remote.reliabilityPolicy', 'remote.reliabilityLoopRuntime', 'locale', 'uiConversation',
]

/** Install the process-wide policy controller and the composer chip. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-reliability: dictionaries')
  ctx.uiConversation.events.register(reliabilityTerminalDefinition)
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

  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'reliability',
    order: -10,
    locale: NS,
    inject: (sessionId): ReliabilityStatusDockInjected => ({
      details: ref => ctx.remote.reliabilityLoopRuntime.details(sessionId, ref),
      cancel: ref => ctx.remote.reliabilityLoopRuntime.cancel(sessionId, ref),
      dismiss: ref => ctx.remote.reliabilityLoopRuntime.dismiss(sessionId, ref),
    }),
  }, ReliabilityStatusDock))

  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'reliability-loop-terminal',
    locale: NS,
    inject: (sessionId): ReliabilityTerminalViewInjected => ({
      details: ref => ctx.remote.reliabilityLoopRuntime.details(sessionId, ref),
    }),
  }, ReliabilityTerminalView))
}
