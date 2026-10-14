// @vitest-environment jsdom
/** Sign-in area: OAuth subscription flows only; API-key catalog logins stay off this list. */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
const GO = {
  key: 'llm-pi-ai/opencode-go', label: 'OpenCode Go',
  methods: [{ id: 'oauth', label: 'Browser sign-in' }, { id: 'api-key', label: 'OpenCode API key' }],
  inFlight: false,
} satisfies AuthorizationDescribeValue['flows'][number]

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
  it('keeps a Go secret separate from another provider text prompt', async () => {
    let attempts: AuthorizationDescribeValue['attempts'] = [
      { key: 'llm-pi-ai/openai-codex', status: 'running', notices: [], pendingPrompt: {
        id: 'codex-code', kind: 'text', message: 'Codex callback code',
      } },
      { key: GO.key, status: 'running', notices: [], pendingPrompt: {
        id: 'go-key', kind: 'secret', message: 'OpenCode API key',
      } },
    ]
    const api = {
      ...wire([MIXED[1]!, GO]),
      describe: () => Promise.resolve({ ok: true as const, value: { flows: [MIXED[1]!, GO], attempts } }),
      respond: vi.fn(async () => {
        attempts = [attempts[0]!, { key: GO.key, status: 'authorized', notices: [] }]
        return { ok: true as const, value: undefined }
      }),
    }
    const signIn = new SignInStore(api)
    await signIn.refresh()
    render(<SignInSection controller={signIn} useSignIn={bindSnapshotSelector(signIn.store)} t={key => en[key]} />)
    const code = screen.getByLabelText('Codex callback code') as HTMLInputElement
    const secret = screen.getByLabelText('OpenCode API key') as HTMLInputElement
    expect(code.type).toBe('text')
    expect(secret.type).toBe('password')
    fireEvent.change(code, { target: { value: 'codex-fixture-code' } })
    fireEvent.change(secret, { target: { value: 'go-fixture-secret' } })
    expect(code.value).toBe('codex-fixture-code')
    expect(secret.value).toBe('go-fixture-secret')
    fireEvent.click(within(screen.getByRole('listitem', { name: GO.label })).getByRole('button', { name: en.signInSubmit }))
    await screen.findByText(en.signInAuthorized)
    expect(api.respond).toHaveBeenCalledWith({ key: GO.key, promptId: 'go-key', value: 'go-fixture-secret' })
    expect(code.value).toBe('codex-fixture-code')
    expect(screen.queryByLabelText('OpenCode API key')).toBeNull()
  })

  it('starts Go browser sign-in and exposes the Console usage setting', async () => {
    const api = { ...wire([GO, ...MIXED]), begin: vi.fn(wire([]).begin) }
    const signIn = new SignInStore(api)
    await signIn.refresh()
    render(<SignInSection controller={signIn} useSignIn={bindSnapshotSelector(signIn.store)} t={key => en[key]} />)
    expect(screen.getByText('OpenCode Go')).toBeTruthy()
    expect(screen.queryByText('DeepSeek')).toBeNull()
    expect(screen.getByText(en.openCodeGoUsageHint)).toBeTruthy()
    expect(screen.getByRole('link', { name: en.openCodeGoConsole }).getAttribute('href')).toBe('https://opencode.ai/console/')
    fireEvent.click(screen.getByRole('button', { name: en.signInBrowserAction }))
    await waitFor(() => { expect(api.begin).toHaveBeenCalledWith({ key: GO.key, method: 'oauth' }) })
  })

  it('runs the Go API-key alternative through the existing secret prompt', async () => {
    let attempts: AuthorizationDescribeValue['attempts'] = []
    const api = {
      ...wire([GO]),
      describe: () => Promise.resolve({ ok: true as const, value: { flows: [GO], attempts } }),
      begin: vi.fn(async () => {
        attempts = [{ key: GO.key, status: 'running', notices: [], pendingPrompt: {
          id: 'go-key', kind: 'secret', message: 'OpenCode API key',
        } }]
        return { ok: true as const, value: { started: true as const } }
      }),
      respond: vi.fn(async () => {
        attempts = [{ key: GO.key, status: 'authorized', notices: [] }]
        return { ok: true as const, value: undefined }
      }),
    }
    const signIn = new SignInStore(api)
    await signIn.refresh()
    render(<SignInSection controller={signIn} useSignIn={bindSnapshotSelector(signIn.store)} t={key => en[key]} />)
    fireEvent.click(screen.getByRole('button', { name: en.useApiKeyAuth }))
    const input = await screen.findByLabelText('OpenCode API key')
    expect(input.getAttribute('type')).toBe('password')
    expect(api.begin).toHaveBeenCalledWith({ key: GO.key, method: 'api-key' })
    fireEvent.change(input, { target: { value: 'go-fixture-secret' } })
    fireEvent.click(screen.getByRole('button', { name: en.signInSubmit }))
    await screen.findByText(en.signInAuthorized)
    expect(api.respond).toHaveBeenCalledWith({ key: GO.key, promptId: 'go-key', value: 'go-fixture-secret' })
    expect(screen.queryByLabelText('OpenCode API key')).toBeNull()
    expect(document.body.textContent).not.toContain('go-fixture-secret')
  })

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
