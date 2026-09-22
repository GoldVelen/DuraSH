/** Real settings and model-picker flow against isolated xAI directory responses; no model calls. */
import { createServer, type Server } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as yaml from 'js-yaml'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { ZH_BROWSER_LOCALE, connectFreshWorkspaceZh, saveFailureShot } from './support.ts'

const expectedDir = fileURLToPath(new URL('./expected/xai-model-sync', import.meta.url))
const mode = webSnapshotMode()
const fixtureKey = 'xai-browser-fixture-only'

describe('web e2e: xAI online model adoption', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let directory: Server
  let temporaryRoot: string
  let baseURL: string
  let rejectDirectory = false
  const requests: { method: string | undefined; path: string | undefined; authorized: boolean }[] = []
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), 'dsh-xai-browser-'))
    directory = createServer((request, response) => {
      const authorized = request.headers.authorization === `Bearer ${fixtureKey}`
      requests.push({ method: request.method, path: request.url, authorized })
      response.setHeader('content-type', 'application/json')
      if (rejectDirectory || !authorized) {
        response.writeHead(403).end(JSON.stringify({ error: 'fixture access denied' }))
      } else if (request.method === 'GET' && request.url === '/v1/models') {
        response.end(JSON.stringify({ data: [
          { id: 'grok-4.6', name: 'Grok 4.6', context_length: 128_000 },
          { id: 'grok-4.7', name: 'Grok 4.7', context_length: 500_000, max_output_tokens: 32_768 },
        ] }))
      } else if (request.method === 'GET' && request.url === '/v1/language-models') {
        response.end(JSON.stringify({ models: [
          { id: 'grok-4.6', input_modalities: ['text'] },
          {
            id: 'grok-4.7', input_modalities: ['text', 'image'],
            capabilities: { reasoning_effort: ['low', 'medium', 'high', 'xhigh'] },
          },
        ] }))
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
    baseURL = `http://127.0.0.1:${String(address.port)}/v1`
    const overlayPath = join(temporaryRoot, 'default-model.yml')
    await writeFile(overlayPath, '- id: agent-default-model\n  config:\n    provider: xai\n    model: grok-4.6\n')
    scaffold = await launchWebScaffold({ harnessHome: join(temporaryRoot, 'home'), extraOverlayPath: overlayPath })
    await scaffold.ctx.credentials.set(credentialRef('DSH_XAI_BROWSER_FIXTURE_KEY'), fixtureKey)
    await scaffold.ctx.settings.update('llm-pi-ai', {
      providers: {
        xai: {
          baseURL, apiKeyEnv: 'DSH_XAI_BROWSER_FIXTURE_KEY',
          models: [{ id: 'grok-4.6', name: 'My Grok 4.6', contextWindow: 12_000 }],
        },
      },
    })
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: ZH_BROWSER_LOCALE })
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspaceZh(page, scaffold.workspaceCwd)
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
    if (directory !== undefined) await new Promise<void>((resolve, reject) => {
      directory.close((error) => {
        if (error === undefined) resolve()
        else reject(error)
      })
      directory.closeAllConnections()
    })
    if (temporaryRoot !== undefined) await rm(temporaryRoot, { recursive: true, force: true })
  })

  it('adopts refreshed capabilities, selects xhigh, and retains models after a denied refresh', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-xai-model-sync'))
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const settings = page.getByRole('dialog', { name: '设置', exact: true })
    await settings.getByRole('button', { name: '模型', exact: true }).click()
    await settings.getByRole('button', { name: '编辑 xai', exact: true }).click()
    await settings.getByText('自定义设置', { exact: true }).click()
    expect(await settings.getByLabel('模型 ID 1').inputValue()).toBe('grok-4.6')
    expect(requests).toEqual([])
    await settings.getByRole('button', { name: '获取可用模型', exact: true }).click()
    const picker = page.getByRole('dialog', { name: '选择要添加的模型' })
    await picker.waitFor()
    expect(requests).toEqual([
      { method: 'GET', path: '/v1/models', authorized: true },
      { method: 'GET', path: '/v1/language-models', authorized: true },
    ])
    expect(await picker.getByRole('checkbox').evaluateAll(nodes => nodes.map(node => (node as HTMLInputElement).checked)))
      .toEqual([false, true])
    await compareOrRefreshGolden(join(expectedDir, 'candidates.expected.md'),
      await captureStableAria(page, '[role="dialog"][aria-label="选择要添加的模型"]', scaffold.workspaceCwd), mode)
    await picker.getByRole('button', { name: '添加所选', exact: true }).click()
    expect(await settings.getByLabel('模型 ID 2').inputValue()).toBe('grok-4.7')
    await settings.getByRole('button', { name: '保存', exact: true }).click()
    await settings.getByText('已保存 xai。', { exact: true }).waitFor()
    const settingsPath = join(scaffold.harnessHome, 'settings.yaml')
    const persisted = yaml.load(await readFile(settingsPath, 'utf8'))
    expect(persisted).toMatchObject({
      'llm-pi-ai': { providers: { xai: { models: [
        { id: 'grok-4.6', name: 'My Grok 4.6', contextWindow: 12_000 },
        {
          id: 'grok-4.7', name: 'Grok 4.7', contextWindow: 500_000, maxTokens: 32_768,
          input: ['text', 'image'], reasoningEfforts: { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh' },
        },
      ] } } },
    })
    await expect(scaffold.ctx.llm.resolveModelInfo('xai', 'grok-4.7')).resolves.toMatchObject({
      inputModalities: ['text', 'image'],
      reasoning: { efforts: [{ id: 'low' }, { id: 'medium' }, { id: 'high' }, { id: 'xhigh' }] },
    })
    await settings.getByRole('button', { name: '关闭', exact: true }).click()
    const trigger = page.getByRole('button', { name: /^选择模型/ })
    await trigger.click()
    await page.getByRole('menuitem', { name: /模型/ }).click()
    await page.getByRole('menuitemradio', { name: 'Grok 4.7', exact: true }).click()
    await trigger.click()
    await page.getByRole('menuitem', { name: /推理等级/ }).click()
    await page.getByRole('menuitemradio', { name: 'Xhigh', exact: true }).waitFor()
    await compareOrRefreshGolden(join(expectedDir, 'efforts.expected.md'),
      await captureStableAria(page, '[role="menu"]', scaffold.workspaceCwd), mode)
    await page.getByRole('menuitemradio', { name: 'Xhigh', exact: true }).click()
    await expect.poll(() => trigger.getAttribute('aria-label')).toBe('选择模型，当前 Grok 4.7，推理等级 Xhigh')
    await expect.poll(() => readFile(settingsPath, 'utf8')).toContain('reasoningEffort: xhigh')
    const saved = await readFile(settingsPath, 'utf8')

    rejectDirectory = true
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await settings.getByRole('button', { name: '模型', exact: true }).click()
    await settings.getByRole('button', { name: '编辑 xai', exact: true }).click()
    await settings.getByText('自定义设置', { exact: true }).click()
    await settings.getByRole('button', { name: '获取可用模型', exact: true }).click()
    await settings.getByText(/answered 403; check the API key or account sign-in/).waitFor()
    expect(await settings.getByLabel('模型 ID 1').inputValue()).toBe('grok-4.6')
    expect(await settings.getByLabel('模型 ID 2').inputValue()).toBe('grok-4.7')
    expect(await readFile(settingsPath, 'utf8')).toBe(saved)
    expect(await settings.getByText('已保存 xai。', { exact: true }).count()).toBe(0)
    const errorAria = await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(join(expectedDir, 'denied.expected.md'), errorAria.replaceAll(baseURL, '<XAI_ENDPOINT>'), mode)
    await page.screenshot({ path: join(tmpdir(), 'dsh-xai-model-sync-denied.png'), fullPage: true })
    expect(requests.map(request => request.path)).toEqual(['/v1/models', '/v1/language-models', '/v1/models'])
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  })

  it('keeps its snapshot inventory closed', async () => {
    await assertFixtureInventory(expectedDir, ['candidates.expected.md', 'efforts.expected.md', 'denied.expected.md'])
  })
})
