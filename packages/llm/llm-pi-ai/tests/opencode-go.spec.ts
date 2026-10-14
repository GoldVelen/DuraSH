import { createServer, type Server } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import type { AuthEvent } from '@earendil-works/pi-ai'
import { userAgent } from '@deepseek-ai/dsh-llm'
import { PiAiAdapter } from '../src/adapter.ts'
import { credentialStoreFrom, authContextFrom, recordKeyFor } from '../src/auth.ts'
import { catalogModels, catalogProvider } from '../src/catalog.ts'
import { resolveProfiles } from '../src/config.ts'
import { createModels } from '../src/models.ts'
import { openCodeGoOAuth, openCodeSessionHeaders } from '../src/opencode-go.ts'
import { memoryAuth } from './auth-double.ts'

const device = { device_code: 'device-fixture', user_code: 'GO-1234', verification_uri_complete: '/console/device?user_code=GO-1234',
  expires_in: 600, interval: 0.001 }
const token = { access_token: 'fixture-access', refresh_token: 'fixture-refresh', expires_in: 3600, org_id: 'fixture-org' }
const roots: string[] = []
const contexts: Context[] = []
const servers: Server[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.closeAllConnections()
    server.close((error) => { if (error === undefined) resolve(); else reject(error) })
  })))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function credentials(path?: string): Promise<{ ctx: Context; path: string }> {
  if (path === undefined) {
    const root = await mkdtemp(join(tmpdir(), 'durash-go-credentials-'))
    roots.push(root)
    path = join(root, 'credentials.yaml')
  }
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LocalCredentialProvider, { path, watch: false })
  return { ctx, path }
}

function requestUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
}

function formBody(init: RequestInit | undefined): URLSearchParams {
  if (!(init?.body instanceof URLSearchParams)) throw new Error('fixture expected a form request')
  return init.body
}

describe('OpenCode Go authorization', () => {
  it('uses the client-owned device flow, preserves the verification URL and polls pending before granting', async () => {
    const calls: { url: string; form: URLSearchParams }[] = []
    const replies = [Response.json(device), Response.json({ error: 'authorization_pending' }, { status: 400 }), Response.json(token)]
    const fetcher = vi.fn<typeof fetch>((input, init) => {
      calls.push({ url: requestUrl(input), form: formBody(init) })
      return Promise.resolve(replies.shift()!)
    })
    const notices: AuthEvent[] = []
    const grant = await openCodeGoOAuth(fetcher).login({ signal: new AbortController().signal,
      notify: event => notices.push(event), prompt: () => Promise.reject(new Error('device login must not prompt for a secret')) })
    expect(calls[0]?.url).toBe('https://opencode.ai/console/auth/device/code')
    expect(calls[0]?.form.get('client_id')).toBe('durash')
    expect(calls[0]?.form.get('supports_org_scope')).toBe('true')
    expect(calls.slice(1).map(call => call.form.get('device_code'))).toEqual(['device-fixture', 'device-fixture'])
    expect(notices).toEqual([{ type: 'device_code', userCode: 'GO-1234',
      verificationUri: 'https://opencode.ai/console/device?user_code=GO-1234' }])
    expect(grant).toMatchObject({ type: 'oauth', access: 'fixture-access', refresh: 'fixture-refresh', orgId: 'fixture-org' })
    expect(grant.expires).toBeGreaterThan(Date.now())
  })

  it('cancels the polling wait without requesting or returning a token', async () => {
    const controller = new AbortController()
    const fetcher = vi.fn<typeof fetch>(() => Promise.resolve(Response.json(device)))
    await expect(openCodeGoOAuth(fetcher).login({ signal: controller.signal,
      notify: () => { controller.abort() }, prompt: () => Promise.resolve('unused') })).rejects.toThrow()
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('rejects an unowned verification destination and failed refresh without exposing response tokens', async () => {
    const oauth = openCodeGoOAuth(() => Promise.resolve(Response.json({ ...device,
      verification_uri_complete: 'https://other.example/login' })))
    await expect(oauth.login({ signal: new AbortController().signal, notify: () => {}, prompt: () => Promise.resolve('unused') }))
      .rejects.toThrow('verification URL')
    const rejected = openCodeGoOAuth(() => Promise.resolve(Response.json({ error: 'invalid_grant', access_token: 'must-not-expose' }, { status: 400 })))
    await expect(rejected.refresh({ type: 'oauth', access: 'old', refresh: 'old-refresh', expires: 0 }, new AbortController().signal))
      .rejects.toThrow('sign in again')
    const malformed = openCodeGoOAuth(() => Promise.resolve(new Response('{"access_token":"must-not-expose",')))
    await expect(malformed.refresh({ type: 'oauth', access: 'old', refresh: 'old-refresh', expires: 0 }, new AbortController().signal))
      .rejects.toThrow('response is not valid JSON')
  })

  it('rotates a single-use refresh token once for concurrent requests and survives a Host restart', async () => {
    const { ctx, path } = await credentials()
    const store = credentialStoreFrom(ctx)
    await store.modify('opencode-go', () => Promise.resolve({ type: 'oauth', access: 'old', refresh: 'one-use', expires: 0 }))
    const started = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const refreshes: string[] = []
    const oauth = openCodeGoOAuth(async (_input, init) => {
      refreshes.push(formBody(init).get('refresh_token')!)
      started.resolve(undefined)
      await release.promise
      return Response.json(token)
    })
    const provider = catalogProvider('opencode-go')!
    const models = createModels({ credentials: store, authContext: authContextFrom(ctx) })
    models.setProvider({ ...provider, auth: { ...provider.auth, oauth } })
    const first = models.getAuth('opencode-go')
    await started.promise
    const second = models.getAuth('opencode-go')
    release.resolve(undefined)
    const [one, two] = await Promise.all([first, second])
    expect(refreshes).toEqual(['one-use'])
    expect(one?.auth.headers).toEqual({ authorization: 'Bearer fixture-access' })
    expect(two?.auth).toEqual(one?.auth)
    const restarted = await credentials(path)
    expect(await credentialStoreFrom(restarted.ctx).read('opencode-go')).toMatchObject({
      type: 'oauth', access: 'fixture-access', refresh: 'fixture-refresh', orgId: 'fixture-org',
    })
    expect(await restarted.ctx.credentials.readRecord(recordKeyFor('opencode-go'))).toMatchObject({ kind: 'grant' })
  })

  it('stores the rotated grant after caller cancellation, serializes a concurrent request and uses only the replacement next', async () => {
    const { ctx, path } = await credentials()
    const store = credentialStoreFrom(ctx)
    await store.modify('opencode-go', () => Promise.resolve({ type: 'oauth', access: 'old', refresh: 'one-use', expires: 0 }))
    const rotated = Promise.withResolvers<undefined>()
    const releaseBody = Promise.withResolvers<undefined>()
    const controller = new AbortController()
    const refreshes: string[] = []
    let refreshSignal: AbortSignal | undefined
    const oauth = openCodeGoOAuth((_input, init) => {
      refreshes.push(formBody(init).get('refresh_token')!)
      const response = Response.json(refreshes.length === 1 ? token : { ...token, refresh_token: 'next-refresh' })
      if (refreshes.length === 1) {
        refreshSignal = init?.signal ?? undefined
        vi.spyOn(response, 'json').mockImplementation(async () => {
          // The server has consumed one-use before the client receives its body.
          rotated.resolve(undefined)
          await releaseBody.promise
          return token
        })
      }
      return Promise.resolve(response)
    })
    const provider = catalogProvider('opencode-go')!
    const models = createModels({ credentials: store, authContext: authContextFrom(ctx) })
    models.setProvider({ ...provider, auth: { ...provider.auth, oauth } })
    const first = models.getAuth('opencode-go', { signal: controller.signal })
    await rotated.promise
    const second = models.getAuth('opencode-go')
    try {
      controller.abort(new Error('fixture caller cancelled'))
      // The caller finishes while refresh still owns the credential lock.
      await expect(first).rejects.toThrow('fixture caller cancelled')
      expect(refreshSignal?.aborted).toBe(false)
      expect(await store.read('opencode-go')).toMatchObject({ refresh: 'one-use' })
    } finally { releaseBody.resolve(undefined) }
    expect((await second)?.auth.headers).toEqual({ authorization: 'Bearer fixture-access' })
    expect(refreshes).toEqual(['one-use'])
    const restarted = await credentials(path)
    expect(await credentialStoreFrom(restarted.ctx).read('opencode-go')).toMatchObject({ refresh: 'fixture-refresh' })
    await store.modify('opencode-go', current => Promise.resolve(current?.type === 'oauth' ? { ...current, expires: 0 } : current))
    await models.getAuth('opencode-go')
    expect(refreshes).toEqual(['one-use', 'fixture-refresh'])
    expect(await store.read('opencode-go')).toMatchObject({ refresh: 'next-refresh' })
  })

  it('respects cancellation before refresh dispatch and bounds active refresh by the configured Go deadline', async () => {
    const before = new AbortController()
    before.abort(new Error('fixture cancelled before refresh'))
    const fetcher = vi.fn<typeof fetch>((_input, init) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal
      if (signal === undefined || signal === null) throw new Error('fixture requires a bounded refresh signal')
      signal.addEventListener('abort', () => {
        const reason: unknown = signal.reason
        reject(reason instanceof Error ? reason : new Error('fixture refresh aborted'))
      }, { once: true })
    }))
    await expect(openCodeGoOAuth(fetcher).refresh({ type: 'oauth', access: 'old', refresh: 'old', expires: 0 }, before.signal))
      .rejects.toThrow('fixture cancelled before refresh')
    expect(fetcher).not.toHaveBeenCalled()
    const original = globalThis.fetch
    globalThis.fetch = fetcher
    try {
      const profile = resolveProfiles({ 'opencode-go': { oauthRefreshTimeoutMs: 5 } }).get('opencode-go')!
      expect(profile.oauthRefreshTimeoutMs).toBe(5)
      await expect(profile.piProvider!.auth.oauth!.refresh({ type: 'oauth', access: 'old', refresh: 'old', expires: 0 }, new AbortController().signal))
        .rejects.toThrow('OPENCODE_REFRESH_TIMEOUT after 5ms')
    } finally { globalThis.fetch = original }
    expect(fetcher).toHaveBeenCalledTimes(1)
    for (const invalid of [0, -1, Infinity, NaN, 15_001, 2_147_483_648]) {
      expect(() => resolveProfiles({ 'opencode-go': { oauthRefreshTimeoutMs: invalid } })).toThrow('oauthRefreshTimeoutMs')
    }
  })
})

describe('OpenCode Go inference', () => {
  it('keeps all native protocols on subscription endpoints and leaves other providers untouched', () => {
    const go = catalogModels('opencode-go')
    expect(new Set([...go.values()].map(model => model.api))).toEqual(new Set(['openai-completions', 'openai-responses', 'anthropic-messages']))
    for (const model of go.values()) expect(model.baseUrl).toBe(model.api === 'anthropic-messages'
      ? 'https://opencode.ai/inference/go' : 'https://opencode.ai/inference/go/v1')
    const other = catalogModels('deepseek').values().next().value!
    expect(openCodeSessionHeaders(other, 'conversation')).toEqual({})
    expect(openCodeSessionHeaders(go.values().next().value!, undefined)).toEqual({})
  })

  it.each(['openai-completions', 'anthropic-messages', 'openai-responses'])('sends stable session and bearer headers through %s on a real loopback socket', async (api) => {
    const requests: { path: string; headers: Record<string, string | string[] | undefined> }[] = []
    const server = createServer((request, response) => {
      requests.push({ path: request.url!, headers: request.headers })
      request.resume()
      request.on('end', () => {
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        const events = api === 'openai-completions' ? [
          { choices: [{ delta: { role: 'assistant', content: 'hello' }, index: 0, finish_reason: null }] },
          { choices: [{ delta: {}, index: 0, finish_reason: 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 1 } },
        ] : api === 'anthropic-messages' ? [
          { type: 'message_start', message: { id: 'go-message', type: 'message', role: 'assistant', content: [], usage: { input_tokens: 2, output_tokens: 0 } } },
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hello' } },
          { type: 'content_block_stop', index: 0 },
          { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } },
          { type: 'message_stop' },
        ] : [
          { type: 'response.created', response: { id: 'go-response' } },
          { type: 'response.output_item.added', output_index: 0, item: { id: 'go-text', type: 'message', role: 'assistant', content: [] } },
          { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: 'hello' },
          { type: 'response.completed', response: { id: 'go-response', status: 'completed', usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 } } },
        ]
        for (const event of events) response.write(`${api === 'anthropic-messages' && 'type' in event ? `event: ${event.type}\n` : ''}data: ${JSON.stringify(event)}\n\n`)
        response.end()
      })
    })
    servers.push(server)
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('fixture did not bind a TCP port')
    const model = [...catalogModels('opencode-go').values()].find(value => value.api === api)!
    const baseURL = `http://127.0.0.1:${String(address.port)}/inference/go${api === 'anthropic-messages' ? '' : '/v1'}`
    const auth = memoryAuth({ 'opencode-go': { type: 'oauth', access: 'fixture-bearer', refresh: 'unused', expires: Date.now() + 3_600_000 } })
    const adapter = new PiAiAdapter({ profiles: () => resolveProfiles({ 'opencode-go': { baseURL, models: [{ id: model.id }],
      headers: { 'X-OpenCode-Session': 'spoof', 'USER-AGENT': 'spoof' } } }), resolveApiKey: () => Promise.resolve(undefined), auth })
    for (const session of ['conversation-a', 'conversation-a', 'conversation-b']) {
      const chunks = []
      for await (const chunk of adapter.stream({ provider: 'opencode-go', model: model.id, messages: [], sessionId: session as never })) chunks.push(chunk)
      expect(chunks).toContainEqual({ type: 'text-delta', index: 0, text: 'hello' })
      expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
    }
    expect(requests.map(request => request.headers['x-opencode-session'])).toEqual(['conversation-a', 'conversation-a', 'conversation-b'])
    for (const request of requests) {
      expect(request.headers.authorization).toBe('Bearer fixture-bearer')
      expect(request.headers['user-agent']).toBe(userAgent())
      expect(new URL(request.path, 'http://fixture').pathname)
        .toBe(`/inference/go/v1/${api === 'anthropic-messages' ? 'messages' : api === 'openai-responses' ? 'responses' : 'chat/completions'}`)
    }
  })
})
