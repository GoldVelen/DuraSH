// @vitest-environment jsdom
/** Sign-in area: OAuth subscription flows only; API-key catalog logins stay off this list. */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import type { AuthorizationDescribeValue } from '@deepseek-ai/dsh-api-remotes/client'
import { oauthSignInFlows, SignInSection } from '../src/client/SignInSection.tsx'
import { SignInStore } from '../src/client/sign-in-store.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const MIXED: AuthorizationDescribeValue['flows'] = [
  {
    key: 'llm-pi-ai/deepseek',
    label: 'DeepSeek',
    methods: [{ id: 'api-key', label: 'DeepSeek API key' }],
    inFlight: false,
  },
  {
    key: 'llm-pi-ai/openai-codex',
    label: 'OpenAI Codex',
    methods: [{ id: 'oauth', label: 'OpenAI (ChatGPT Plus/Pro)' }],
    inFlight: false,
  },
  {
    key: 'llm-pi-ai/xai',
    label: 'xAI',
    methods: [
      { id: 'oauth', label: 'Sign in with SuperGrok or X Premium' },
      { id: 'api-key', label: 'xAI API key' },
    ],
    inFlight: false,
  },
]

function wire(
  flows: AuthorizationDescribeValue['flows'],
  attempts: AuthorizationDescribeValue['attempts'] = [],
) {
  return {
    describe: () => Promise.resolve({ ok: true as const, value: { flows, attempts } }),
    begin: () => Promise.resolve({ ok: true as const, value: { started: true as const } }),
    respond: () => Promise.resolve({ ok: true as const, value: undefined }),
    cancel: () => Promise.resolve({ ok: true as const, value: undefined }),
  }
}

describe('the Models sign-in area', () => {
  it('keeps only Host flows that declare an oauth method', () => {
    expect(oauthSignInFlows(MIXED).map(flow => flow.key)).toEqual([
      'llm-pi-ai/openai-codex',
      'llm-pi-ai/xai',
    ])
  })

  it('renders ChatGPT and Grok rows and omits API-key-only catalog logins', async () => {
    const signIn = new SignInStore(wire(MIXED))
    await signIn.refresh()
    render(
      <SignInSection
        controller={signIn}
        useSignIn={bindSnapshotSelector(signIn.store)}
        t={key => en[key]}
      />,
    )
    expect(screen.getByText(en.signInTitle)).toBeTruthy()
    expect(screen.getByText('OpenAI Codex')).toBeTruthy()
    expect(screen.getByText('xAI')).toBeTruthy()
    expect(screen.queryByText('DeepSeek')).toBeNull()
    expect(screen.getAllByRole('button', { name: en.signInAction })).toHaveLength(2)
  })

  it('renders nothing when the Host offers no OAuth flow', async () => {
    const signIn = new SignInStore(wire([MIXED[0]!]))
    await signIn.refresh()
    const { container } = render(
      <SignInSection
        controller={signIn}
        useSignIn={bindSnapshotSelector(signIn.store)}
        t={key => en[key]}
      />,
    )
    expect(container.textContent).toBe('')
  })

  it('hides in-progress notices once the attempt is authorized', async () => {
    const signIn = new SignInStore(wire(MIXED, [{
      key: 'llm-pi-ai/openai-codex',
      status: 'authorized',
      notices: [{
        message: 'A browser window should open. Complete login to finish.',
        url: 'https://auth.example/device',
      }],
    }]))
    await signIn.refresh()
    render(
      <SignInSection
        controller={signIn}
        useSignIn={bindSnapshotSelector(signIn.store)}
        t={key => en[key]}
      />,
    )
    expect(screen.queryByText('A browser window should open. Complete login to finish.')).toBeNull()
    expect(screen.queryByRole('link', { name: en.signInOpenPage })).toBeNull()
    expect(screen.getByText(en.signInAuthorized)).toBeTruthy()
  })
})
