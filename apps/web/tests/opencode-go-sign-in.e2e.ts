/** Go browser and API-key sign-in through real Host RPCs against an isolated Console transport. */
import { createServer, type Server } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as yaml from 'js-yaml'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed, vi } from 'vitest'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { ZH_BROWSER_LOCALE, connectFreshWorkspaceZh, saveFailureShot } from './support.ts'

const mode = webSnapshotMode()
const expectedDir = fileURLToPath(new URL('./expected/opencode-go-sign-in', import.meta.url))
const key = credentialKey('llm-pi-ai', 'opencode-go')
const fixtureAccess = 'go-browser-fixture-access'
const fixtureApiKey = 'go-api-key-fixture'
const accessLifetimeSeconds = 30 * 24 * 60 * 60
const firstModel = 'deepseek-v4.1-flash'
const addedModel = 'deepseek-v4.1-pro'

const publicModels = {
  'opencode-go': {
    api: 'https://opencode.ai/inference/go/openai/v1', npm: '@ai-sdk/openai-compatible',
    models: Object.fromEntries([firstModel, addedModel].map(id => [id, {
      id, name: id === firstModel ? 'DeepSeek V4.1 Flash' : 'DeepSeek V4.1 Pro',
      canonical_model_id: `deepseek/${id}`, limit: { context: 1048576, output: 98304 },
      modalities: { input: ['text'], output: ['text'] }, reasoning: true,
      reasoning_options: [{ type: 'effort', values: ['low', 'high', 'max'] }],
    }])),
  },
}

describe.skipIf(mode === 'record')('web e2e: OpenCode Go sign-in', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let consoleServer: Server
  let allowToken = false
  let includeAddedModel = false
  const requests: string[] = []
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    const originalFetch = globalThis.fetch
    consoleServer = createServer((request, response) => {
      requests.push(`${request.method ?? ''} ${request.url ?? ''}`)
      response.setHeader('content-type', 'application/json')
      if (request.method === 'POST' && request.url === '/console/auth/device/code') {
        response.end(JSON.stringify({ device_code: 'go-fixture-device', user_code: 'GO-LOGIN-CODE',
          verification_uri_complete: '/console/device?user_code=GO-LOGIN-CODE', expires_in: 60, interval: 0.05 }))
      } else if (request.method === 'POST' && request.url === '/console/auth/device/token') {
        if (!allowToken) response.writeHead(400).end(JSON.stringify({ error: 'authorization_pending' }))
        else response.end(JSON.stringify({ access_token: fixtureAccess, refresh_token: 'go-fixture-refresh',
          expires_in: accessLifetimeSeconds, org_id: 'go-fixture-workspace' }))
      } else if (request.method === 'GET' && request.url === '/console/api/v2/config') {
        if (![fixtureAccess, fixtureApiKey].some(value => request.headers.authorization === `Bearer ${value}`)) {
          response.writeHead(401).end(JSON.stringify({ _tag: 'Unauthorized' }))
          return
        }
        response.end(JSON.stringify({ providers: { 'opencode-go': {
          package: '@opencode/ai/providers/openai/chat',
          settings: { baseURL: 'https://opencode.ai/inference/go/openai/v1' },
          models: {
            [firstModel]: { name: 'DeepSeek V4.1 Flash' },
            ...includeAddedModel ? { [addedModel]: { name: 'DeepSeek V4.1 Pro' } } : {},
            'claude-fixture': { name: 'Claude Go Fixture', package: '@opencode/ai/providers/anthropic',
              settings: { baseURL: 'https://opencode.ai/inference/go/anthropic/v1' },
              limit: { context: 200000, output: 64000 }, capabilities: { input: ['text', 'image'] } },
          },
        } } }))
      } else if (request.method === 'GET' && request.url === '/models.dev/api.json') {
        response.end(JSON.stringify(publicModels))
      } else response.writeHead(404).end(JSON.stringify({ error: 'unexpected fixture request' }))
    })
    await new Promise<void>((resolve, reject) => {
      consoleServer.once('error', reject)
      consoleServer.listen(0, '127.0.0.1', resolve)
    })
    const address = consoleServer.address()
    if (address === null || typeof address === 'string') throw new Error('Console fixture did not bind TCP')
    const origin = `http://127.0.0.1:${String(address.port)}`
    vi.stubGlobal('fetch', ((input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      if (url.href === 'https://models.dev/api.json') {
        return originalFetch(new URL('/models.dev/api.json', origin), init)
      }
      if (url.origin === 'https://opencode.ai') {
        if (!['/console/auth/device/code', '/console/auth/device/token', '/console/api/v2/config'].includes(url.pathname)) {
          throw new Error(`unexpected OpenCode fixture request ${url.pathname}`)
        }
        return originalFetch(new URL(url.pathname, origin), init)
      }
      if (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return originalFetch(input, init)
      throw new Error(`unexpected external Go fixture request ${url.origin}${url.pathname}`)
    }) satisfies typeof fetch)
    vi.stubEnv('OPENCODE_API_KEY', undefined)
    scaffold = await launchWebScaffold()
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: ZH_BROWSER_LOCALE })
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspaceZh(page, scaffold.workspaceCwd)
  })

  afterAll(async () => {
    const failures: unknown[] = []
    try {
      await browser?.close().catch((error: unknown) => failures.push(error))
      await scaffold?.close().catch((error: unknown) => failures.push(error))
      if (consoleServer !== undefined) await new Promise<void>((resolve, reject) => {
        consoleServer.close((error) => { if (error === undefined) resolve(); else reject(error) })
        consoleServer.closeAllConnections()
      }).catch((error: unknown) => failures.push(error))
    } finally {
      vi.unstubAllEnvs()
      vi.unstubAllGlobals()
    }
    if (failures.length > 0) throw new AggregateError(failures, 'OpenCode Go fixture cleanup failed')
  })

  async function openModels() {
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const settings = page.getByRole('dialog', { name: '设置', exact: true })
    await settings.getByRole('button', { name: '模型', exact: true }).click()
    return settings
  }

  it('rejoins browser authorization, enables the Go route, and accepts its API-key alternative', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-opencode-go-sign-in'))
    let settings = await openModels()
    let go = settings.getByRole('listitem', { name: 'OpenCode Go', exact: true })
    await go.getByRole('button', { name: '浏览器登录', exact: true }).waitFor()
    expect(await go.count()).toBe(1)
    expect(await go.getByRole('link', { name: 'OpenCode Console', exact: true }).getAttribute('href'))
      .toBe('https://opencode.ai/console/')
    await compareOrRefreshGolden(join(expectedDir, 'methods.expected.md'),
      await captureStableAria(page, '[role="dialog"] li[aria-label="OpenCode Go"]', scaffold.workspaceCwd), mode)
    await go.getByRole('button', { name: '浏览器登录', exact: true }).click()
    await go.getByText('GO-LOGIN-CODE', { exact: true }).waitFor()
    await page.reload({ waitUntil: 'load' })
    settings = await openModels()
    go = settings.getByRole('listitem', { name: 'OpenCode Go', exact: true })
    await go.getByText('GO-LOGIN-CODE', { exact: true }).waitFor()
    expect(requests.filter(request => request === 'POST /console/auth/device/code')).toHaveLength(1)
    const authorizedAfter = Date.now()
    allowToken = true
    await go.getByText('已登录，该提供方已启用。可在对话中选择模型，或在下方编辑模型目录。', { exact: true }).waitFor()
    await vi.waitUntil(() => scaffold.ctx.llm.listProviders().some(provider => provider.id === 'opencode-go'))
    const settingsPath = join(scaffold.harnessHome, 'settings.yaml')
    const saved = yaml.load(await readFile(settingsPath, 'utf8')) as {
      'llm-pi-ai': { providers: Record<string, unknown> }
    }
    expect(saved['llm-pi-ai'].providers['opencode-go']).toEqual({})
    expect(saved['llm-pi-ai'].providers['opencode']).toBeUndefined()
    const record = await scaffold.ctx.credentials.readRecord(key)
    expect(record).toMatchObject({ kind: 'grant', payload: { access: fixtureAccess } })
    const payload = record?.kind === 'grant' ? record.payload : undefined
    if (typeof payload !== 'object' || payload === null || !('expires' in payload)) throw new Error('missing persisted token expiration')
    expect(payload.expires).toBeGreaterThanOrEqual(authorizedAfter + accessLifetimeSeconds * 1000)
    expect(payload.expires).toBeLessThanOrEqual(Date.now() + accessLifetimeSeconds * 1000)

    await vi.waitFor(async () => {
      expect((await scaffold.ctx.llm.listModels('opencode-go')).map(model => model.id)).toContain(firstModel)
    })
    expect(requests).toContain('GET /console/api/v2/config')
    expect(requests).toContain('GET /models.dev/api.json')
    await expect(scaffold.ctx.llm.resolveModelInfo('opencode-go', firstModel)).resolves.toMatchObject({
      context: { contextWindow: 1048576 }, inputModalities: ['text'],
    })
    await settings.getByText('自定义设置', { exact: true }).click()
    const following = settings.getByRole('checkbox', { name: '跟随账号模型列表', exact: true })
    expect(await following.isChecked()).toBe(true)
    // Explicitly record the already-following choice without replacing any model rows.
    await following.uncheck()
    await following.check()
    await compareOrRefreshGolden(join(expectedDir, 'follow-account.expected.md'),
      await captureStableAria(page, '[role="dialog"] details', scaffold.workspaceCwd), mode)
    await settings.getByRole('button', { name: '保存', exact: true }).click()
    await settings.getByText('已保存 opencode-go。', { exact: true }).waitFor()
    await expect.poll(async () => yaml.load(await readFile(settingsPath, 'utf8'))).toMatchObject({
      'llm-pi-ai': { providers: { 'opencode-go': { modelCatalogMode: 'live' } } },
    })
    await settings.getByRole('button', { name: '关闭', exact: true }).click()
    const trigger = page.getByRole('button', { name: /^选择模型/ })
    await trigger.click()
    await page.getByRole('menuitem', { name: /模型/ }).click()
    await page.getByRole('menuitemradio', { name: 'DeepSeek V4.1 Flash', exact: true }).click()
    await expect.poll(() => trigger.getAttribute('aria-label')).toContain('DeepSeek V4.1 Flash')
    await expect.poll(() => scaffold.ctx.agentDefaultModel.currentSelection()).toMatchObject({ provider: 'opencode-go', model: firstModel })

    includeAddedModel = true
    settings = await openModels()
    go = settings.getByRole('listitem', { name: 'OpenCode Go', exact: true })
    await settings.getByRole('button', { name: '编辑 opencode-go', exact: true }).click()
    await settings.getByText('自定义设置', { exact: true }).click()
    await settings.getByRole('button', { name: '获取可用模型', exact: true }).click()
    const candidates = page.getByRole('dialog', { name: '选择要添加的模型', exact: true })
    await candidates.getByRole('checkbox', { name: /deepseek-v4\.1-pro/ }).waitFor()
    await candidates.getByRole('button', { name: '取消', exact: true }).click()
    await settings.getByRole('button', { name: '取消', exact: true }).click()
    await settings.getByRole('button', { name: '关闭', exact: true }).click()
    await trigger.click()
    await page.getByRole('menuitem', { name: /模型/ }).click()
    await compareOrRefreshGolden(join(expectedDir, 'account-models.expected.md'),
      await captureStableAria(page, '[role="menu"]', scaffold.workspaceCwd), mode)
    await page.getByRole('menuitemradio', { name: 'DeepSeek V4.1 Pro', exact: true }).click()
    await expect.poll(() => trigger.getAttribute('aria-label')).toContain('DeepSeek V4.1 Pro')
    await expect.poll(() => scaffold.ctx.agentDefaultModel.currentSelection()).toMatchObject({ provider: 'opencode-go', model: addedModel })
    settings = await openModels()
    go = settings.getByRole('listitem', { name: 'OpenCode Go', exact: true })

    await go.getByRole('button', { name: '改用 API 密钥', exact: true }).click()
    const secret = go.getByLabel('Enter OpenCode API key', { exact: true })
    await secret.waitFor()
    expect(await secret.getAttribute('type')).toBe('password')
    await secret.fill(fixtureApiKey)
    await go.getByRole('button', { name: '提交', exact: true }).click()
    await go.getByText('已登录，该提供方已启用。可在对话中选择模型，或在下方编辑模型目录。', { exact: true }).waitFor()
    expect(await scaffold.ctx.credentials.readRecord(key)).toEqual({ kind: 'api-key', key: fixtureApiKey })
    expect(await settings.innerText()).not.toContain(fixtureApiKey)
    expect(await readFile(settingsPath, 'utf8')).not.toContain(fixtureApiKey)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  })

  it('keeps the owner-local expected inventory closed', async () => {
    await assertFixtureInventory(expectedDir, ['methods.expected.md', 'follow-account.expected.md', 'account-models.expected.md'])
  })
})
