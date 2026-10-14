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

describe.skipIf(mode === 'record')('web e2e: OpenCode Go sign-in', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let consoleServer: Server
  let allowToken = false
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
          expires_in: 3600, org_id: 'go-fixture-workspace' }))
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
      if (url.origin !== 'https://opencode.ai') return originalFetch(input, init)
      if (!['/console/auth/device/code', '/console/auth/device/token'].includes(url.pathname)) {
        throw new Error(`unexpected OpenCode fixture request ${url.pathname}`)
      }
      return originalFetch(new URL(url.pathname, origin), init)
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
    allowToken = true
    await go.getByText('已登录，该提供方已启用。可在对话中选择模型，或在下方编辑模型目录。', { exact: true }).waitFor()
    await vi.waitUntil(() => scaffold.ctx.llm.listProviders().some(provider => provider.id === 'opencode-go'))
    const settingsPath = join(scaffold.harnessHome, 'settings.yaml')
    const saved = yaml.load(await readFile(settingsPath, 'utf8')) as {
      'llm-pi-ai': { providers: Record<string, unknown> }
    }
    expect(saved['llm-pi-ai'].providers['opencode-go']).toEqual({})
    expect(saved['llm-pi-ai'].providers['opencode']).toBeUndefined()
    expect(await scaffold.ctx.credentials.readRecord(key)).toMatchObject({ kind: 'grant', payload: { access: fixtureAccess } })

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
    await assertFixtureInventory(expectedDir, ['methods.expected.md'])
  })
})
