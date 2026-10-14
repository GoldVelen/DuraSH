/** Real Codex subscription directory adoption and persistence against an isolated endpoint; no model calls. */
import { createServer, type Server } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as yaml from 'js-yaml'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-settings'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed, vi } from 'vitest'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { ZH_BROWSER_LOCALE, connectFreshWorkspaceZh, saveFailureShot } from './support.ts'

const expectedDir = fileURLToPath(new URL('./expected/codex-model-sync', import.meta.url))
const mode = webSnapshotMode()
const fixtureAccount = 'codex-browser-account'
const fixtureAccess = `fixture.${Buffer.from(JSON.stringify({
  'https://api.openai.com/auth': { chatgpt_account_id: fixtureAccount },
})).toString('base64url')}.fixture`
const subscriptionKey = credentialKey('llm-pi-ai', 'openai-codex')
const directoryPath = '/backend-api/codex/models?client_version=0.162.1'
const accountModels = [
  { id: 'gpt-6.1-sol', name: 'GPT-6.1-Sol', contextWindow: 500_000 },
  { id: 'gpt-6-luna', name: 'GPT-6-Luna', contextWindow: 272_000 },
]

describe('web e2e: Codex online model adoption', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let directory: Server
  let temporaryRoot: string
  let baseURL: string
  let rejectDirectory = false
  const requests: {
    method: string | undefined
    path: string | undefined
    authorized: boolean
    account: string | string[] | undefined
  }[] = []
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    const originalFetch = globalThis.fetch
    temporaryRoot = await mkdtemp(join(tmpdir(), 'dsh-codex-browser-'))
    directory = createServer((request, response) => {
      const authorized = request.headers.authorization === `Bearer ${fixtureAccess}`
      requests.push({ method: request.method, path: request.url, authorized, account: request.headers['chatgpt-account-id'] })
      response.setHeader('content-type', 'application/json')
      if (rejectDirectory || !authorized) {
        response.writeHead(403).end(JSON.stringify({ error: 'fixture access denied' }))
      } else if (request.method === 'GET' && request.url === directoryPath) {
        response.end(JSON.stringify({ models: accountModels.map(model => ({
          slug: model.id, display_name: model.name,
          visibility: 'list', context_window: model.contextWindow, input_modalities: ['text', 'image'],
          supported_reasoning_levels: ['low', 'medium', 'high', 'xhigh', 'max'].map(effort => ({ effort })),
        })) }))
      } else {
        response.writeHead(404).end(JSON.stringify({ error: 'unexpected fixture request' }))
      }
    })
    await new Promise<void>((resolve, reject) => {
      directory.once('error', reject)
      directory.listen(0, '127.0.0.1', resolve)
    })
    const address = directory.address()
    if (address === null || typeof address === 'string') throw new Error('directory did not bind TCP')
    const origin = `http://127.0.0.1:${String(address.port)}`
    baseURL = `${origin}/backend-api`
    vi.stubGlobal('fetch', ((input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      if (url.origin === 'https://chatgpt.com' && url.pathname === '/backend-api/codex/models') {
        return originalFetch(new URL(url.pathname + url.search, origin), init)
      }
      if (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return originalFetch(input, init)
      throw new Error(`unexpected external Codex fixture request ${url.origin}${url.pathname}`)
    }) satisfies typeof fetch)
    const overlayPath = join(temporaryRoot, 'default-model.yml')
    await writeFile(overlayPath, '- id: agent-default-model\n  config:\n    provider: openai-codex\n    model: gpt-6-astra\n')
    scaffold = await launchWebScaffold({ harnessHome: join(temporaryRoot, 'home'), extraOverlayPath: overlayPath })
    await scaffold.ctx.settings.update('llm-pi-ai', {
      providers: { 'openai-codex': {
        baseURL, models: [{ id: 'gpt-6-astra', name: 'My GPT-6-Astra', contextWindow: 12_000 }],
      } },
    })
    await scaffold.ctx.credentials.modifyRecord(subscriptionKey, async () => ({
      kind: 'grant', payload: {
        type: 'oauth', access: fixtureAccess, refresh: 'fixture-refresh', expires: Date.now() + 3_600_000,
      },
    }))
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
      if (directory !== undefined) await new Promise<void>((resolve, reject) => {
        directory.close((error) => { if (error === undefined) resolve(); else reject(error) })
        directory.closeAllConnections()
      }).catch((error: unknown) => failures.push(error))
      if (temporaryRoot !== undefined) {
        await rm(temporaryRoot, { recursive: true, force: true }).catch((error: unknown) => failures.push(error))
      }
    } finally {
      vi.unstubAllGlobals()
    }
    if (failures.length > 0) throw new AggregateError(failures, 'Codex fixture cleanup failed')
  })

  it('fetches subscription candidates, preserves capabilities on reload, and reports directory rejection without fallback', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-codex-model-sync'))
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const settings = page.getByRole('dialog', { name: '设置', exact: true })
    await settings.getByRole('button', { name: '模型', exact: true }).click()
    await settings.getByRole('button', { name: '编辑 openai-codex', exact: true }).click()
    await settings.getByText('自定义设置', { exact: true }).click()
    expect(await settings.getByLabel('模型 ID 1').inputValue()).toBe('gpt-6-astra')
    const following = settings.getByRole('checkbox', { name: '跟随账号模型列表', exact: true })
    expect(await following.isChecked()).toBe(false)
    const credentialsPath = join(scaffold.harnessHome, '.credentials.yaml')
    const originalCredentials = await readFile(credentialsPath, 'utf8')
    expect(requests).toEqual([])
    await settings.getByRole('button', { name: '获取可用模型', exact: true }).click()
    const picker = page.getByRole('dialog', { name: '选择要添加的模型' })
    await picker.waitFor()
    expect(requests).toHaveLength(1)
    expect(requests[0]?.path).toBe(directoryPath)
    expect(requests[0]).toMatchObject({ method: 'GET', authorized: true, account: fixtureAccount })
    expect(await picker.getByRole('checkbox').evaluateAll(nodes => nodes.map(node => (node as HTMLInputElement).checked)))
      .toEqual([true, true])
    await compareOrRefreshGolden(join(expectedDir, 'candidates.expected.md'),
      await captureStableAria(page, '[role="dialog"][aria-label="选择要添加的模型"]', scaffold.workspaceCwd), mode)
    await picker.getByRole('button', { name: '添加所选', exact: true }).click()
    expect(await settings.getByLabel('模型 ID 2').inputValue()).toBe('gpt-6.1-sol')
    expect(await settings.getByLabel('模型 ID 3').inputValue()).toBe('gpt-6-luna')
    await settings.getByRole('button', { name: '保存', exact: true }).click()
    await settings.getByText('已保存 openai-codex。', { exact: true }).waitFor()
    const settingsPath = join(scaffold.harnessHome, 'settings.yaml')
    await expect.poll(async () => yaml.load(await readFile(settingsPath, 'utf8'))).toMatchObject({
      'llm-pi-ai': { providers: { 'openai-codex': { models: [
        { id: 'gpt-6-astra', name: 'My GPT-6-Astra', contextWindow: 12_000 },
        ...accountModels.map(model => ({
          id: model.id, contextWindow: model.contextWindow, input: ['text', 'image'],
          reasoningEfforts: { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' },
        })),
      ] } } },
    })
    expect(await readFile(credentialsPath, 'utf8')).toBe(originalCredentials)
    await settings.getByRole('button', { name: '编辑 openai-codex', exact: true }).click()
    await settings.getByText('自定义设置', { exact: true }).click()
    await following.check()
    await settings.getByRole('button', { name: '保存', exact: true }).click()
    await expect.poll(async () => yaml.load(await readFile(settingsPath, 'utf8'))).toMatchObject({
      'llm-pi-ai': { providers: { 'openai-codex': {
        modelCatalogMode: 'live', models: [
          { id: 'gpt-6-astra', name: 'My GPT-6-Astra', contextWindow: 12_000 },
          { id: 'gpt-6.1-sol', contextWindow: 500_000 },
          { id: 'gpt-6-luna', contextWindow: 272_000 },
        ],
      } } },
    })
    await vi.waitFor(async () => {
      expect((await scaffold.ctx.llm.listModels('openai-codex')).map(model => model.id)).toEqual(accountModels.map(model => model.id))
    })
    await expect(scaffold.ctx.llm.resolveModelInfo('openai-codex', 'gpt-6.1-sol')).resolves.toMatchObject({
      context: { contextWindow: 500_000 },
      inputModalities: ['text', 'image'],
      reasoning: { efforts: [{ id: 'low' }, { id: 'medium' }, { id: 'high' }, { id: 'xhigh' }, { id: 'max' }] },
    })
    await settings.getByRole('button', { name: '关闭', exact: true }).click()
    await page.reload({ waitUntil: 'load' })
    const trigger = page.getByRole('button', { name: /^选择模型/ })
    await trigger.click()
    await page.getByRole('menuitem', { name: /模型/ }).click()
    await page.getByRole('menuitemradio', { name: 'GPT-6-Luna', exact: true }).waitFor()
    await page.getByRole('menuitemradio', { name: 'GPT-6.1-Sol', exact: true }).click()
    await expect.poll(() => scaffold.ctx.agentDefaultModel.currentSelection()).toMatchObject({ provider: 'openai-codex', model: 'gpt-6.1-sol' })
    await trigger.click()
    await page.getByRole('menuitem', { name: /推理等级/ }).click()
    await page.getByRole('menuitemradio', { name: 'Max', exact: true }).waitFor()
    await compareOrRefreshGolden(join(expectedDir, 'efforts.expected.md'),
      await captureStableAria(page, '[role="menu"]', scaffold.workspaceCwd), mode)
    await page.getByRole('menuitemradio', { name: 'Max', exact: true }).click()
    await expect.poll(() => trigger.getAttribute('aria-label')).toBe('选择模型，当前 GPT-6.1-Sol，推理等级 Max')
    await expect.poll(() => readFile(settingsPath, 'utf8')).toContain('reasoningEffort: max')
    const saved = await readFile(settingsPath, 'utf8')

    rejectDirectory = true
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await settings.getByRole('button', { name: '模型', exact: true }).click()
    await settings.getByRole('button', { name: '编辑 openai-codex', exact: true }).click()
    await settings.getByText('自定义设置', { exact: true }).click()
    await settings.getByRole('button', { name: '获取可用模型', exact: true }).click()
    await settings.getByText(/answered 403; check the API key or account sign-in/).waitFor()
    expect(await picker.count()).toBe(0)
    expect(await settings.getByLabel('模型 ID 1').inputValue()).toBe('gpt-6-astra')
    expect(await settings.getByLabel('模型 ID 2').inputValue()).toBe('gpt-6.1-sol')
    expect(await settings.getByLabel('模型 ID 3').inputValue()).toBe('gpt-6-luna')
    expect(await following.isChecked()).toBe(true)
    expect(await readFile(settingsPath, 'utf8')).toBe(saved)
    expect(await readFile(credentialsPath, 'utf8')).toBe(originalCredentials)
    expect(requests).toHaveLength(3)
    expect(requests.every(request => request.method === 'GET' && request.path === directoryPath
      && request.authorized && request.account === fixtureAccount)).toBe(true)
    const errorAria = await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(join(expectedDir, 'denied.expected.md'), errorAria.replaceAll(baseURL, '<CODEX_ENDPOINT>'), mode)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  })

  it('keeps its snapshot inventory closed', async () => {
    await assertFixtureInventory(expectedDir, ['candidates.expected.md', 'efforts.expected.md', 'denied.expected.md'])
  })
})
