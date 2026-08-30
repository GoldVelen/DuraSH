/** DuraSH occupants for the generic browser-brand slots. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { DuraSHBrandMark, DuraSHBrandName } from './Brand.tsx'
import { en, zh, type DuraSHBrandKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** DuraSH's product name, preserved as text in every supported locale. */
    durashBrand: DuraSHBrandKey
  }
}

/** Dictionary namespace owned by the DuraSH identity package. */
const NS = 'durashBrand'

/** Required services: the UI slot and locale registries. */
export const inject = ['slots', 'locale']

/**
 * Fill every shipped brand slot as one declaration-aware registration set.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  if (process.env.DSH_CLIENT_BUILD_PROFILE !== 'durash') return
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'durash-brand: dictionaries')
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', () =>
      ctx.slots.inject('conversation.hero.brand.mark', function* () {
        yield ctx.slots.register({ name: 'sidebar.brand.mark' }, DuraSHBrandMark)
        yield ctx.slots.register({ name: 'sidebar.brand.name', locale: NS }, DuraSHBrandName)
        yield ctx.slots.register({ name: 'conversation.hero.brand.mark' }, DuraSHBrandMark)
      })))
}
