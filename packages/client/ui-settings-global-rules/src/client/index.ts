/** Global instruction file settings, using the authenticated Host settings API. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { GlobalRulesSection } from './GlobalRulesSection.tsx'
import type { GlobalRulesSectionInjected } from './GlobalRulesSection.tsx'
import { en, zh, type GlobalRulesKey } from './locales.ts'

export type { GlobalRulesSectionInjected, GlobalRulesSectionProps } from './GlobalRulesSection.tsx'
export type { GlobalRulesKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Global instruction file editor copy. */
    'settings.globalRules': GlobalRulesKey
  }
}

/** Services required for localization, registration, and authenticated file operations. */
export const inject = ['slots', 'locale', 'remote', 'remote.settings']

/**
 * Register the editor without reading the file until the user opens its page.
 * @param ctx - browser plugin context.
 */
export function apply(ctx: Context): void {
  const ns = 'settings.globalRules'
  ctx.effect(() => ctx.locale.register(ns, { zh, en }), 'ui-settings-global-rules: dictionaries')
  const t = ctx.locale.bind(ns)
  const operations: GlobalRulesSectionInjected = {
    read: async () => {
      const result = await ctx.remote.settings.readGlobalRules()
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    },
    save: async (content, revision) => {
      try {
        const result = await ctx.remote.settings.saveGlobalRules(content, revision)
        if (result.ok) return { kind: 'saved', document: result.value }
        return result.error.code === 'global-rules/conflict'
          ? { kind: 'conflict' }
          : { kind: 'failed', message: result.error.message }
      } catch (error: unknown) {
        return { kind: 'failed', message: error instanceof Error ? error.message : String(error) }
      }
    },
  }
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'global-rules', order: 15,
    label: () => t('nav'), locale: ns, inject: () => operations,
  }, GlobalRulesSection))
}
