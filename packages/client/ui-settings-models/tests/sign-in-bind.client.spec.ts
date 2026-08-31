/** Optional `remote.authorization` binding: empty until the namespace is provided. */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { AuthorizationDescribeValue } from '@deepseek-ai/dsh-api-remotes/client'
import { createSignInAuthorizationHandle } from '../src/client/sign-in-bind.ts'
import type { ModelsAuthorization } from '../src/client/sign-in-store.ts'

const FLOWS: AuthorizationDescribeValue['flows'] = [
  {
    key: 'llm-pi-ai/openai-codex',
    label: 'OpenAI Codex',
    methods: [{ id: 'oauth', label: 'OpenAI (ChatGPT Plus/Pro)' }],
    inFlight: false,
  },
]

function fakeAuthorization(): ModelsAuthorization & { describeCalls: number } {
  return {
    describeCalls: 0,
    describe() {
      this.describeCalls += 1
      return Promise.resolve({ ok: true as const, value: { flows: FLOWS, attempts: [] } })
    },
    begin: () => Promise.resolve({ ok: true as const, value: { started: true as const } }),
    respond: () => Promise.resolve({ ok: true as const, value: undefined }),
    cancel: () => Promise.resolve({ ok: true as const, value: undefined }),
  }
}

describe('the Models sign-in authorization bind', () => {
  it('answers an empty snapshot before the namespace exists, then forwards once provided', async () => {
    const ctx = new Context()
    const handle = createSignInAuthorizationHandle()
    handle.attach(ctx)

    await expect(handle.wire.describe()).resolves.toEqual({
      ok: true, value: { flows: [], attempts: [] },
    })

    const fake = fakeAuthorization()
    await ctx.plugin({
      apply: (child: Context) => { child.provide('remote.authorization', fake) },
    })

    await expect(handle.wire.describe()).resolves.toEqual({
      ok: true, value: { flows: FLOWS, attempts: [] },
    })
    expect(fake.describeCalls).toBe(1)
  })

  it('returns to the empty snapshot when the namespace unloads', async () => {
    const ctx = new Context()
    const handle = createSignInAuthorizationHandle()
    handle.attach(ctx)
    const fake = fakeAuthorization()
    const fiber = ctx.plugin({
      apply: (child: Context) => { child.provide('remote.authorization', fake) },
    })
    await fiber
    await expect(handle.wire.describe()).resolves.toMatchObject({ ok: true, value: { flows: FLOWS } })

    await fiber.dispose()
    await expect(handle.wire.describe()).resolves.toEqual({
      ok: true, value: { flows: [], attempts: [] },
    })
  })
})
