import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AuthorizationService from '@deepseek-ai/dsh-authorization'
import type { AuthorizationSession } from '@deepseek-ai/dsh-authorization'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { TypertRemoteFailure, remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import AuthorizationController from '../src/authorization.ts'
import { MemoryCredentials } from '../../../credentials/authorization/tests/memory.ts'

/** The key a test flow writes; the joined form is what the wire carries. */
const KEY = credentialKey('test-plugin', 'provider')
const KEY_WIRE = 'test-plugin/provider'

/**
 * A deferred the test holds so a flow can wait for the assertion phase before
 * finishing — prompts, notices, and settlement become observable states of one
 * controllable attempt instead of a race.
 */
class Gate {
  private available: Promise<void> = Promise.resolve()
  private release: (() => void) | undefined

  /** Block every current and future waiter until {@link open}. */
  close(): void {
    this.release = undefined
    this.available = new Promise((resolve) => { this.release = resolve })
  }

  /** Release every waiter. */
  open(): void {
    this.release?.()
    this.release = undefined
  }

  /** Wait until the gate is open. */
  wait(): Promise<void> {
    return this.available
  }
}

interface FlowScript {
  notify?: (session: AuthorizationSession) => void
  prompt?: (session: AuthorizationSession) => Promise<string | undefined>
  gate?: Gate
  /** When false the flow resolves without writing a record, failing the seam's commit check. */
  commit?: boolean
}

async function boot(flow: FlowScript | undefined): Promise<AuthorizationController> {
  const ctx = new Context()
  await ctx.plugin(MemoryCredentials)
  await ctx.plugin(AuthorizationService)
  await ctx.plugin(AuthorizationController)
  if (flow !== undefined) {
    ctx.authorization.registerFlow({
      key: KEY,
      label: 'Test Provider',
      methods: [{ id: 'oauth', label: 'Sign in with Test' }, { id: 'api-key', label: 'API key' }],
      async run(session) {
        flow.notify?.(session)
        await flow.prompt?.(session)
        await flow.gate?.wait()
        if (flow.commit !== false) {
          await ctx.credentials.modifyRecord(KEY, () =>
            Promise.resolve({ kind: 'api-key', key: 'sk-test' }))
        }
      },
    })
  }
  return ctx.authorizationController
}

/** The controller's projected refusal, whether the call threw or rejected. */
async function failureOf(call: () => unknown): Promise<TypertRemoteFailure> {
  try {
    await call()
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(TypertRemoteFailure)
    return error as TypertRemoteFailure
  }
  throw new Error('expected the call to fail')
}

/** Wait until the tracked attempt reaches one of the terminal statuses. */
async function awaitSettled(
  controller: AuthorizationController,
  status: 'authorized' | 'cancelled' | 'failed',
): Promise<void> {
  await vi.waitUntil(async () => (await controller.describe()).attempts[0]?.status === status)
}

describe('the authorization Remote namespace a sign-in surface calls', () => {
  it('publishes the authorization namespace from its own service key', async () => {
    const controller = await boot(undefined)
    const binding = controller.typertRemote
    expect(binding.serviceKey).toBe('authorizationController')
    expect(binding.namespace).toBe('authorization')
    expect(remoteMethods(controller)).toEqual([
      { method: 'describe', invocation: { kind: 'direct' } },
      { method: 'begin', invocation: { kind: 'direct' } },
      { method: 'respond', invocation: { kind: 'direct' } },
      { method: 'cancel', invocation: { kind: 'direct' } },
    ])
  })

  it('reports the actionable composition error while no authorization service is mounted', async () => {
    const ctx = new Context()
    await ctx.plugin(MemoryCredentials)
    await ctx.plugin(AuthorizationController)
    const failure = await failureOf(() => ctx.authorizationController.describe())
    expect(failure.failure.code).toBe('internal')
    expect(failure.failure.message).toContain('does not mount @deepseek-ai/dsh-authorization')
  })

  it('projects a stored grant as an authorized attempt when none is in flight', async () => {
    const ctx = new Context()
    await ctx.plugin(MemoryCredentials)
    await ctx.plugin(AuthorizationService)
    await ctx.plugin(AuthorizationController)
    ctx.authorization.registerFlow({
      key: KEY,
      label: 'Test Provider',
      methods: [{ id: 'oauth', label: 'Sign in with Test' }],
      run: () => Promise.resolve(),
    })
    await ctx.credentials.modifyRecord(KEY, () => Promise.resolve({ kind: 'grant', payload: { token: 'kept' } }))
    const described = await ctx.authorizationController.describe()
    expect(described.attempts).toEqual([{
      key: KEY_WIRE,
      status: 'authorized',
      notices: [],
    }])
  })

  it('lets an attempt started during a credential read override the stored projection', async () => {
    const ctx = new Context()
    const gate = new Gate()
    gate.close()
    await ctx.plugin(MemoryCredentials)
    await ctx.plugin(AuthorizationService)
    await ctx.plugin(AuthorizationController)
    ctx.authorization.registerFlow({
      key: KEY,
      label: 'Test Provider',
      methods: [{ id: 'oauth', label: 'Sign in with Test' }],
      async run() {
        await gate.wait()
        await ctx.credentials.modifyRecord(KEY, () =>
          Promise.resolve({ kind: 'grant', payload: { token: 'new' } }))
      },
    })
    await ctx.credentials.modifyRecord(KEY, () =>
      Promise.resolve({ kind: 'grant', payload: { token: 'kept' } }))
    const readStarted = Promise.withResolvers<undefined>()
    const allowRead = Promise.withResolvers<undefined>()
    const describeRecord = ctx.credentials.describeRecord.bind(ctx.credentials)
    vi.spyOn(ctx.credentials, 'describeRecord').mockImplementation(async (key) => {
      readStarted.resolve(undefined)
      await allowRead.promise
      return describeRecord(key)
    })

    const describing = ctx.authorizationController.describe()
    await readStarted.promise
    await ctx.authorizationController.begin({ key: KEY_WIRE })
    allowRead.resolve()

    expect((await describing).attempts).toEqual([{
      key: KEY_WIRE,
      status: 'running',
      notices: [],
    }])
    gate.open()
    await awaitSettled(ctx.authorizationController, 'authorized')
  })

  it('lists the registered flows', async () => {
    const controller = await boot({})
    const described = await controller.describe()
    expect(described.flows).toEqual([{
      key: KEY_WIRE,
      label: 'Test Provider',
      methods: [{ id: 'oauth', label: 'Sign in with Test' }, { id: 'api-key', label: 'API key' }],
      inFlight: false,
    }])
    expect(described.attempts).toEqual([])
  })

  it('refuses to begin a key no flow claims, as not-found', async () => {
    const controller = await boot({})
    const failure = await failureOf(() => controller.begin({ key: 'other-plugin/thing' }))
    expect(failure.failure.code).toBe('not-found')
  })

  it('rejects a key outside the credential grammar, as bad-request', async () => {
    const controller = await boot({})
    const failure = await failureOf(() => controller.begin({ key: 'Test Plugin/Thing' }))
    expect(failure.failure.code).toBe('bad-request')
  })

  it('refuses an unknown method, as bad-request', async () => {
    const controller = await boot({})
    const failure = await failureOf(() => controller.begin({ key: KEY_WIRE, method: 'device' }))
    expect(failure.failure.code).toBe('bad-request')
  })

  it('surfaces notices and prompts to describe, and a respond settles the attempt', async () => {
    const gate = new Gate()
    let received = ''
    const controller = await boot({
      notify: (session) => { session.notify({ message: 'Open the page', url: 'https://example.test/login' }) },
      prompt: session => session.prompt({ kind: 'text', message: 'Paste the code' })
        .then((code) => { received = code; return code }),
      gate,
    })

    await expect(controller.begin({ key: KEY_WIRE })).resolves.toEqual({ started: true })
    const running = await controller.describe()
    expect(running.attempts).toHaveLength(1)
    const attempt = running.attempts[0]
    expect(attempt?.status).toBe('running')
    expect(attempt?.notices).toEqual([{ message: 'Open the page', url: 'https://example.test/login' }])
    const pendingPrompt = attempt?.pendingPrompt
    expect(pendingPrompt?.kind).toBe('text')
    expect(pendingPrompt?.message).toBe('Paste the code')

    const promptId = pendingPrompt?.id ?? ''
    expect(promptId).not.toBe('')
    await controller.respond({ key: KEY_WIRE, promptId: promptId, value: '123456' })
    gate.open()
    await awaitSettled(controller, 'authorized')
    expect(received).toBe('123456')
    const settled = await controller.describe()
    expect(settled.attempts[0]).toMatchObject({ status: 'authorized', key: KEY_WIRE })
    expect(settled.attempts[0]?.pendingPrompt).toBeUndefined()
    expect(settled.flows[0]?.inFlight).toBe(false)
  })

  it('projects select options without their plumbing, and keeps secrets out of describe', async () => {
    const gate = new Gate()
    const controller = await boot({
      notify: (session) => { session.notify({ message: 'Enter this code', code: 'ABCD-1234' }) },
      prompt: session => session.prompt({
        kind: 'select',
        message: 'Pick an account',
        options: [{ id: 'a', label: 'Account A' }],
      }).then(() => 'a'),
      gate,
    })

    await controller.begin({ key: KEY_WIRE, method: 'api-key' })
    const attempt = (await controller.describe()).attempts[0]
    expect(attempt?.pendingPrompt).toMatchObject({
      kind: 'select',
      message: 'Pick an account',
      options: [{ id: 'a', label: 'Account A' }],
    })
    expect(typeof attempt?.pendingPrompt?.id).toBe('string')
    expect(attempt?.notices).toEqual([{ message: 'Enter this code', code: 'ABCD-1234' }])
    expect(JSON.stringify(attempt)).not.toContain('signal')
    await controller.respond({
      key: KEY_WIRE, promptId: attempt?.pendingPrompt?.id ?? '', value: 'a',
    })
    gate.open()
    await awaitSettled(controller, 'authorized')
  })

  it('settles a declined prompt as cancelled', async () => {
    const gate = new Gate()
    const controller = await boot({
      prompt: session => session.prompt({ kind: 'secret', message: 'Paste the code', placeholder: 'XYZ' }),
      gate,
    })

    await controller.begin({ key: KEY_WIRE })
    const attempt = (await controller.describe()).attempts[0]
    const promptId = attempt?.pendingPrompt?.id ?? ''
    await controller.respond({ key: KEY_WIRE, promptId: promptId, declined: true })
    gate.open()
    await awaitSettled(controller, 'cancelled')
  })

  it('withdraws a running attempt through cancel', async () => {
    const gate = new Gate()
    let withdrawn = false
    const controller = await boot({
      gate,
      prompt: session => new Promise<string>((_resolve, reject) => {
        session.signal.addEventListener('abort', () => {
          withdrawn = true
          reject(new Error('stopped'))
        }, { once: true })
      }),
    })

    await controller.begin({ key: KEY_WIRE })
    await controller.cancel({ key: KEY_WIRE })
    await awaitSettled(controller, 'cancelled')
    expect(withdrawn).toBe(true)
  })

  it('clears a pending prompt when the flow withdraws it, and refuses a stale id', async () => {
    const gate = new Gate()
    gate.close()
    const controller = await boot({
      // The flow races a typed code against a timeout and withdraws the losing
      // question through the prompt's own signal — the shape pi-ai logins run.
      prompt: (session) => {
        const question = new AbortController()
        const losing = session.prompt({
          kind: 'text', message: 'Losing question', signal: question.signal,
        }).catch(() => 'typed')
        setTimeout(() => { question.abort() }, 20)
        return losing
      },
      gate,
    })

    await controller.begin({ key: KEY_WIRE })
    const attempt = (await controller.describe()).attempts[0]
    const promptId = attempt?.pendingPrompt?.id ?? ''
    await vi.waitUntil(async () => (await controller.describe()).attempts[0]?.pendingPrompt === undefined)
    const failure = await failureOf(() => controller.respond({
      key: KEY_WIRE, promptId: promptId, value: 'late',
    }))
    expect(failure.failure.code).toBe('bad-request')
    gate.open()
    await awaitSettled(controller, 'authorized')
  })

  it('refuses a second begin while one is running, as conflict', async () => {
    const gate = new Gate()
    const controller = await boot({ gate })

    await controller.begin({ key: KEY_WIRE })
    const failure = await failureOf(() => controller.begin({ key: KEY_WIRE }))
    expect(failure.failure.code).toBe('conflict')
    gate.open()
    await awaitSettled(controller, 'authorized')
  })

  it('refuses a respond for a key with no running attempt, as not-found', async () => {
    const controller = await boot({})
    const failure = await failureOf(() => controller.respond({
      key: KEY_WIRE, promptId: 'prompt-1', value: 'x',
    }))
    expect(failure.failure.code).toBe('not-found')
  })

  it('records a flow that commits nothing as failed with the seam refusal', async () => {
    const controller = await boot({ commit: false })

    await controller.begin({ key: KEY_WIRE })
    await awaitSettled(controller, 'failed')
    const settled = (await controller.describe()).attempts[0]
    expect(settled?.message).toContain('reached credential storage')
    expect(settled?.message).toContain('without committing a credential record')
  })

  it('states when a flow failed before the controller received a notice or prompt', async () => {
    const controller = await boot({
      prompt: () => Promise.reject(new Error('provider failed before surface interaction')),
    })

    await controller.begin({ key: KEY_WIRE })
    await awaitSettled(controller, 'failed')
    const settled = (await controller.describe()).attempts[0]
    expect(settled?.message).toBe(
      'the sign-in attempt failed before the controller received a notice or prompt:'
      + ' provider failed before surface interaction',
    )
  })

  it('keeps the post-notice failure and only exposes allowlisted network metadata from the cause', async () => {
    const controller = await boot({
      notify: (session) => { session.notify({ message: 'Open the page', url: 'https://example.test/login' }) },
      prompt: () => {
        const cause = new Error('secret cause text must stay hidden')
        Object.assign(cause, {
          code: 'ECONNREFUSED',
          syscall: 'connect',
          hostname: 'auth.x.ai',
          address: '127.0.0.1',
          port: 443,
          access_token: 'should-not-appear',
        })
        return Promise.reject(new TypeError('fetch failed', { cause }))
      },
    })

    await controller.begin({ key: KEY_WIRE })
    await awaitSettled(controller, 'failed')
    const settled = (await controller.describe()).attempts[0]
    expect(settled?.message).toContain('failed after the controller received a notice or prompt')
    expect(settled?.message).toContain('fetch failed')
    expect(settled?.message).toContain('[code=ECONNREFUSED syscall=connect hostname=auth.x.ai address=127.0.0.1 port=443]')
    expect(settled?.message).not.toContain('secret cause text must stay hidden')
    expect(settled?.message).not.toContain('should-not-appear')
  })

  it('redacts outer-message bearer tokens and OAuth query parameters from a failed attempt message', async () => {
    const controller = await boot({
      notify: (session) => { session.notify({ message: 'Open the page', url: 'https://example.test/login' }) },
      prompt: () => Promise.reject(new Error(
        'provider returned Bearer topsecret and https://callback.test/cb?code=abc123&refresh_token=rt456',
      )),
    })

    await controller.begin({ key: KEY_WIRE })
    await awaitSettled(controller, 'failed')
    const settled = (await controller.describe()).attempts[0]
    expect(settled?.message).toContain('Bearer <redacted>')
    expect(settled?.message).toContain('code=<redacted>')
    expect(settled?.message).toContain('refresh_token=<redacted>')
    expect(settled?.message).not.toContain('topsecret')
    expect(settled?.message).not.toContain('abc123')
    expect(settled?.message).not.toContain('rt456')
  })

  it('keeps AggregateError network metadata but never its member messages', async () => {
    const controller = await boot({
      notify: (session) => { session.notify({ message: 'Open the page', url: 'https://example.test/login' }) },
      prompt: () => {
        const first = new Error('dns token leak')
        Object.assign(first, { code: 'ENOTFOUND', syscall: 'getaddrinfo', hostname: 'api.x.ai' })
        const second = new Error('socket secret leak')
        Object.assign(second, { code: 'ECONNREFUSED', address: '127.0.0.1', port: 443 })
        return Promise.reject(new TypeError('fetch failed', {
          cause: new AggregateError([first, second], 'aggregate secret text'),
        }))
      },
    })

    await controller.begin({ key: KEY_WIRE })
    await awaitSettled(controller, 'failed')
    const settled = (await controller.describe()).attempts[0]
    expect(settled?.message).toContain('fetch failed')
    expect(settled?.message).toContain('code=ENOTFOUND')
    expect(settled?.message).toContain('hostname=api.x.ai')
    expect(settled?.message).toContain('code=ECONNREFUSED')
    expect(settled?.message).toContain('address=127.0.0.1')
    expect(settled?.message).toContain('port=443')
    expect(settled?.message).not.toContain('dns token leak')
    expect(settled?.message).not.toContain('socket secret leak')
    expect(settled?.message).not.toContain('aggregate secret text')
  })

  it('caps the number of rendered network metadata entries from AggregateError causes', async () => {
    const controller = await boot({
      notify: (session) => { session.notify({ message: 'Open the page', url: 'https://example.test/login' }) },
      prompt: () => {
        const errors = [
          Object.assign(new Error('hidden-1'), { code: 'ECONNREFUSED', address: '127.0.0.1', port: 443 }),
          Object.assign(new Error('hidden-2'), { code: 'ENOTFOUND', hostname: 'api.x.ai', syscall: 'getaddrinfo' }),
          Object.assign(new Error('hidden-3'), { code: 'ECONNRESET', hostname: 'edge.x.ai', syscall: 'read' }),
          Object.assign(new Error('hidden-4'), { code: 'ETIMEDOUT', address: '10.0.0.8', port: 8443 }),
          Object.assign(new Error('hidden-5'), { code: 'EHOSTUNREACH', address: '10.0.0.9', port: 9443 }),
        ]
        return Promise.reject(new TypeError('fetch failed', { cause: new AggregateError(errors, 'hidden-agg') }))
      },
    })

    await controller.begin({ key: KEY_WIRE })
    await awaitSettled(controller, 'failed')
    const settled = (await controller.describe()).attempts[0]
    const message = settled?.message ?? ''
    expect(message).toContain('code=ECONNREFUSED')
    expect(message).toContain('code=ENOTFOUND')
    expect(message).toContain('code=ECONNRESET')
    expect(message).toContain('code=ETIMEDOUT')
    expect(message).not.toContain('code=EHOSTUNREACH')
    expect(message).not.toContain('hidden-1')
    expect(message).not.toContain('hidden-5')
    expect(message.split('; ')).toHaveLength(4)
  })

  it('rejects a respond payload naming neither value nor decline, as bad-request', async () => {
    const controller = await boot({})
    const failure = await failureOf(() => controller.respond({ key: KEY_WIRE, promptId: 'prompt-1' }))
    expect(failure.failure.code).toBe('bad-request')
  })
})
