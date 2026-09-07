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
import reliabilityPolicyRemote from '@durash/dsh-reliability-policy/remote'
import type {} from '@durash/dsh-reliability-policy/remote'
import { ReliabilityPolicyController } from './controller.ts'
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

/** Required carrier, locale, and conversation slot services. The generated namespace is mounted in apply before consumers wait on it. */
export const inject = [
  'slots', 'remote', 'locale',
]

function registerUi(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-reliability: dictionaries')
  const controller = new ReliabilityPolicyController(ctx.remote.reliabilityPolicy)
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

/**
 * Mount the generated reliability-policy Remote, then register its browser UI.
 * @param ctx - Client Context carrying Remote, locale, and slot services.
 * @returns disposer for both the UI registrations and Remote namespace.
 */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(reliabilityPolicyRemote)
  const ui = ctx.inject(['slots', 'remote.reliabilityPolicy', 'locale'], registerUi)
  try {
    await ui
  } catch (error) {
    await ui.dispose()
    await disposeRemote()
    throw error
  }
  return async () => {
    await ui.dispose()
    await disposeRemote()
  }
}
