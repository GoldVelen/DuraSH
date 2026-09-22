/** Real browser and authenticated Host file edits in an isolated harness home; no model calls. */
import { mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { captureStableAria, compareOrRefreshGolden, launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold } from './scaffold.ts'
import { ZH_BROWSER_LOCALE } from './support.ts'

const expectedPath = fileURLToPath(new URL('./expected/global-rules-settings/editor.expected.md', import.meta.url))
const mode = webSnapshotMode()
const original = '# User rules\n\n  Preserve this text.  \n'

describe('web e2e: global instruction file settings', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let temporaryRoot: string
  let rulesPath: string
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), 'dsh-global-rules-ui-'))
    const harnessHome = join(temporaryRoot, 'home')
    await mkdir(harnessHome)
    rulesPath = join(harnessHome, 'AGENTS.md')
    await writeFile(rulesPath, original)
    scaffold = await launchWebScaffold({ harnessHome })
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1360, height: 1000 }, locale: ZH_BROWSER_LOCALE })
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.getByRole('button', { name: '全局规则', exact: true }).click()
    await page.getByRole('textbox', { name: '规则正文' }).waitFor({ timeout: 15_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
    if (temporaryRoot !== undefined) await rm(temporaryRoot, { recursive: true, force: true })
  })

  it('loads the actual Host file, saves edits, protects concurrent writes, and reports read failures', async () => {
    const editor = page.getByRole('textbox', { name: '规则正文' })
    const save = page.getByRole('button', { name: '保存', exact: true })
    expect(await editor.inputValue()).toBe(original)
    expect(await page.getByText(rulesPath, { exact: true }).count()).toBe(1)
    expect(await save.isDisabled()).toBe(true)
    const aria = await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(expectedPath, aria.replaceAll(scaffold.harnessHome, '<HOST_HOME>'), mode)
    const next = '# Edited rules\n\n  Keep exact whitespace.  \n'
    await editor.fill(next)
    await page.getByText('有未保存的修改', { exact: true }).waitFor()
    await save.click()
    await page.getByText('已保存；尚未确认任何请求已加载。', { exact: true }).waitFor()
    expect(await readFile(rulesPath, 'utf8')).toBe(next)
    await page.screenshot({ path: join(tmpdir(), 'dsh-global-rules-saved.png'), fullPage: true })

    const targetPath = join(temporaryRoot, 'symlink-target.md')
    await rename(rulesPath, targetPath)
    await symlink(targetPath, rulesPath)
    await Promise.all([
      page.waitForResponse(response => response.url().endsWith('/api/settings/readGlobalRules')),
      page.getByRole('button', { name: '重新读取文件', exact: true }).click(),
    ])
    await expect.poll(() => save.isDisabled()).toBe(true)
    await expect.poll(() => editor.isEnabled()).toBe(true)
    await editor.fill('Rejected draft')
    await save.click()
    await page.getByText('保存规则失败：', { exact: false }).waitFor()
    expect(await editor.inputValue()).toBe('Rejected draft')
    expect(await readFile(targetPath, 'utf8')).toBe(next)
    expect(await page.getByText('已保存；尚未确认任何请求已加载。', { exact: true }).count()).toBe(0)
    await page.screenshot({ path: join(tmpdir(), 'dsh-global-rules-save-error.png'), fullPage: true })
    await rm(rulesPath)
    await rename(targetPath, rulesPath)
    await page.getByRole('button', { name: '重新读取并放弃本页修改' }).click()
    await expect.poll(() => editor.inputValue()).toBe(next)

    await editor.fill('Browser draft')
    await writeFile(rulesPath, 'Concurrent external edit')
    await save.click()
    await page.getByText('文件已被其他编辑修改。', { exact: false }).waitFor()
    expect(await editor.inputValue()).toBe('Browser draft')
    expect(await readFile(rulesPath, 'utf8')).toBe('Concurrent external edit')
    expect(await save.isDisabled()).toBe(true)
    await page.screenshot({ path: join(tmpdir(), 'dsh-global-rules-conflict.png'), fullPage: true })
    await page.getByRole('button', { name: '重新读取并放弃本页修改' }).click()
    await expect.poll(() => editor.inputValue()).toBe('Concurrent external edit')

    await editor.fill('')
    await save.click()
    await page.getByText('已保存；尚未确认任何请求已加载。', { exact: true }).waitFor()
    expect(await readFile(rulesPath, 'utf8')).toBe('')

    await rm(rulesPath)
    await mkdir(rulesPath)
    await page.getByRole('button', { name: '重新读取文件', exact: true }).click()
    await page.getByText('读取规则失败：', { exact: false }).waitFor()
    expect(await page.getByText('已保存；尚未确认任何请求已加载。', { exact: true }).count()).toBe(0)
    await page.screenshot({ path: join(tmpdir(), 'dsh-global-rules-read-error.png'), fullPage: true })
    await rm(rulesPath, { recursive: true })
    await page.getByRole('button', { name: '重新读取文件', exact: true }).click()
    await page.getByText('尚无规则文件。首次保存时才会创建。', { exact: true }).waitFor()
    await save.click()
    await page.getByText('已保存；尚未确认任何请求已加载。', { exact: true }).waitFor()
    expect(await readFile(rulesPath, 'utf8')).toBe('')
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 90_000)
})
