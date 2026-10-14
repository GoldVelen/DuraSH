import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AuthorizationService from '@deepseek-ai/dsh-authorization'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import LlmRuntime, { userAgent } from '@deepseek-ai/dsh-llm'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import { recordKeyFor } from '../src/auth.ts'
import { assemble } from './assemble.ts'
import { closeMockServers, mockServer, textEvents } from './mock-server.ts'

it('loads Go through cordis.yml, commits browser credentials, and serves the selected route with session attribution', async () => {
  const root = await mkdtemp(join(tmpdir(), 'durash-go-loader-'))
  const ctx = new Context()
  const originalFetch = globalThis.fetch
  const authPaths: string[] = []
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url
    if (url === 'https://opencode.ai/console/auth/device/code') {
      authPaths.push(url)
      return Response.json({ device_code: 'loader-device', user_code: 'GO-0001',
        verification_uri_complete: '/console/device?user_code=GO-0001', interval: 0.001, expires_in: 600 })
    }
    if (url === 'https://opencode.ai/console/auth/device/token') {
      authPaths.push(url)
      return Response.json({ access_token: 'loader-go-access', refresh_token: 'loader-go-refresh', expires_in: 30 * 24 * 60 * 60 })
    }
    return originalFetch(input, init)
  }
  try {
    const server = await mockServer([{ events: textEvents }])
    const config = join(root, 'cordis.yml')
    await writeFile(config, [
      "- name: '@deepseek-ai/dsh-llm'",
      "- name: '@deepseek-ai/dsh-authorization'",
      "- name: '@deepseek-ai/dsh-credentials-local'",
      '  config:', `    path: ${JSON.stringify(join(root, 'credentials.yaml'))}`, '    watch: false',
      "- name: '@deepseek-ai/dsh-llm-pi-ai'", '  config:', '    providers:', '      opencode-go:',
      `        baseURL: ${server.url}/inference/go/v1`, '        models:', '          - id: deepseek-v4-flash', '',
    ].join('\n'))
    ctx.baseUrl = `${pathToFileURL(root).href}/`
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-llm', LlmRuntime], ['@deepseek-ai/dsh-authorization', AuthorizationService],
      ['@deepseek-ai/dsh-credentials-local', LocalCredentialProvider], ['@deepseek-ai/dsh-llm-pi-ai', LlmPiAi],
    ])
    ctx.loader.internal = { version: 'v2', import: async (specifier: string) => {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader module ${specifier}`)
      return modules.get(specifier)
    } } as unknown as NonNullable<typeof ctx.loader.internal>
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(config).href } })
    await ctx.loader.await()
    const notices: { url?: string; code?: string }[] = []
    expect(await ctx.authorization.begin({ key: recordKeyFor('opencode-go'), method: 'oauth', interaction: {
      notify: notice => notices.push(notice), prompt: () => Promise.reject(new Error('device flow must not collect a key')),
    } })).toEqual({ status: 'authorized' })
    expect(notices).toContainEqual(expect.objectContaining({
      url: 'https://opencode.ai/console/device?user_code=GO-0001', code: 'GO-0001',
    }))
    expect(await ctx.credentials.readRecord(recordKeyFor('opencode-go'))).toMatchObject({ kind: 'grant',
      payload: { type: 'oauth', access: 'loader-go-access', refresh: 'loader-go-refresh' } })
    const result = await assemble(ctx, { provider: 'opencode-go', model: 'deepseek-v4-flash', messages: [],
      sessionId: 'go-loader-conversation' as never })
    expect(result.message.content).toEqual([{ type: 'text', text: 'hello' }])
    expect(authPaths).toEqual(['https://opencode.ai/console/auth/device/code', 'https://opencode.ai/console/auth/device/token'])
    expect(server.headers[0]?.authorization).toBe('Bearer loader-go-access')
    expect(server.headers[0]?.['x-opencode-session']).toBe('go-loader-conversation')
    expect(server.headers[0]?.['user-agent']).toBe(userAgent())
  } finally {
    globalThis.fetch = originalFetch
    try { await ctx.fiber.dispose() } finally {
      try { await closeMockServers() } finally { await rm(root, { recursive: true, force: true }) }
    }
  }
})
