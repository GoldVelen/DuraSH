import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  assertFixtureInventory,
  compareOrRefreshGolden,
  launchWebScaffold,
  watchConsole,
  webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspaceZh, saveFailureShot, ZH_BROWSER_LOCALE } from './support.ts'

const MODE = webSnapshotMode()
const OVERLAY = fileURLToPath(new URL('../../../packages/bundle/durash-web-profile/cordis.patch.yml', import.meta.url))
const INSTALL_ANCHOR = fileURLToPath(new URL('../../../packages/bundle/durash-web-profile/package.json', import.meta.url))
const SNAPSHOT_DIR = fileURLToPath(new URL('./expected/durash-workflow-settings', import.meta.url))
const LAYOUT_EXPECTED = fileURLToPath(new URL('./expected/durash-workflow-settings/layout.expected.md', import.meta.url))
const VIEWPORT = { width: 520, height: 720 } as const
const MARGIN = 12

interface PortalMetrics {
  panelParentIsBody: boolean
  panelAboveTrigger: boolean
  panelWithinViewportMargin: boolean
  panelUsesExpectedHorizontalClamp: boolean
  panelExercisesRightEdgeClamp: boolean
}

interface MenuMetrics extends PortalMetrics {
  effortMenuParentIsBody: boolean
  effortMenuOutsidePanel: boolean
  effortMenuWithinViewportMargin: boolean
  effortMenuUsesExpectedHorizontalClamp: boolean
}

interface PickerMetrics extends PortalMetrics {
  modelPickerParentIsBody: boolean
  modelPickerOutsidePanel: boolean
  modelPickerWithinViewportMargin: boolean
  modelPickerUsesExpectedHorizontalClamp: boolean
}

function renderExpected(menu: MenuMetrics, picker: PickerMetrics): string {
  return [
    '# DuraSH workflow settings portal geometry',
    '',
    `- Panel parent is body: ${String(menu.panelParentIsBody && picker.panelParentIsBody)}`,
    `- Panel is above trigger: ${String(menu.panelAboveTrigger && picker.panelAboveTrigger)}`,
    `- Panel stays inside viewport margin: ${String(menu.panelWithinViewportMargin && picker.panelWithinViewportMargin)}`,
    `- Panel uses the shared horizontal clamp: ${String(menu.panelUsesExpectedHorizontalClamp && picker.panelUsesExpectedHorizontalClamp)}`,
    `- Scenario exercises the right-edge clamp: ${String(menu.panelExercisesRightEdgeClamp && picker.panelExercisesRightEdgeClamp)}`,
    `- Effort menu parent is body: ${String(menu.effortMenuParentIsBody)}`,
    `- Effort menu stays outside panel clip: ${String(menu.effortMenuOutsidePanel)}`,
    `- Effort menu stays inside viewport margin: ${String(menu.effortMenuWithinViewportMargin)}`,
    `- Effort menu uses the shared horizontal clamp: ${String(menu.effortMenuUsesExpectedHorizontalClamp)}`,
    `- Model picker parent is body: ${String(picker.modelPickerParentIsBody)}`,
    `- Model picker stays outside panel clip: ${String(picker.modelPickerOutsidePanel)}`,
    `- Model picker stays inside viewport margin: ${String(picker.modelPickerWithinViewportMargin)}`,
    `- Model picker uses the shared horizontal clamp: ${String(picker.modelPickerUsesExpectedHorizontalClamp)}`,
  ].join('\n')
}

async function openWorkflowSettings(page: Page): Promise<void> {
  const trigger = page.getByRole('button', { name: '工作流设置' })
  await trigger.waitFor({ timeout: 15_000 })
  await trigger.click()
  await page.getByRole('dialog', { name: '工作流设置' }).waitFor({ timeout: 15_000 })
}

async function readPanelMetrics(page: Page): Promise<PortalMetrics> {
  return await page.evaluate((margin) => {
    const trigger = document.querySelector<HTMLElement>('[data-workflow-dock] > button[aria-label="工作流设置"]')
    const panel = document.querySelector<HTMLElement>('[data-workflow-panel]')
    if (trigger === null) throw new Error('workflow trigger not found')
    if (panel === null) throw new Error('workflow panel not found')

    const triggerBox = trigger.getBoundingClientRect()
    const panelBox = panel.getBoundingClientRect()
    const expectedLeft = Math.min(
      Math.max(triggerBox.left, margin),
      window.innerWidth - panelBox.width - margin,
    )
    const within = (box: DOMRect): boolean => (
      box.left >= margin - 0.5
      && box.top >= margin - 0.5
      && box.right <= window.innerWidth - margin + 0.5
      && box.bottom <= window.innerHeight - margin + 0.5
    )

    return {
      panelParentIsBody: panel.parentElement === document.body,
      panelAboveTrigger: panelBox.bottom <= triggerBox.top + 0.5,
      panelWithinViewportMargin: within(panelBox),
      panelUsesExpectedHorizontalClamp: Math.abs(panelBox.left - expectedLeft) <= 0.5,
      panelExercisesRightEdgeClamp: triggerBox.left > expectedLeft + 0.5,
    }
  }, MARGIN)
}

async function readMenuMetrics(page: Page): Promise<MenuMetrics> {
  const panel = await readPanelMetrics(page)
  const menu = await page.evaluate((margin) => {
    const menus = document.body.querySelectorAll<HTMLElement>(':scope > [role="menu"]')
    const effortAnchor = document.querySelector<HTMLElement>('button[aria-label="审查思考强度"]')
    const panel = document.querySelector<HTMLElement>('[data-workflow-panel]')
    if (menus.length !== 1) throw new Error(`expected one body-owned effort menu, found ${String(menus.length)}`)
    const effortMenu = menus[0]
    if (effortMenu === undefined) throw new Error('effort menu not found')
    if (effortAnchor === null) throw new Error('review effort anchor not found')
    if (panel === null) throw new Error('workflow panel not found while reading effort menu')
    const box = effortMenu.getBoundingClientRect()
    const anchorBox = effortAnchor.getBoundingClientRect()
    const expectedLeft = Math.min(
      Math.max(anchorBox.right - box.width, margin),
      window.innerWidth - box.width - margin,
    )
    return {
      effortMenuParentIsBody: effortMenu.parentElement === document.body,
      effortMenuOutsidePanel: !panel.contains(effortMenu),
      effortMenuWithinViewportMargin:
        box.left >= margin - 0.5
        && box.top >= margin - 0.5
        && box.right <= window.innerWidth - margin + 0.5
        && box.bottom <= window.innerHeight - margin + 0.5,
      effortMenuUsesExpectedHorizontalClamp: Math.abs(box.left - expectedLeft) <= 0.5,
    }
  }, MARGIN)
  return { ...panel, ...menu }
}

async function readPickerMetrics(page: Page): Promise<PickerMetrics> {
  const panel = await readPanelMetrics(page)
  const picker = await page.evaluate((margin) => {
    const modelPicker = document.body.querySelector<HTMLElement>('[data-model-picker]')
    const modelAnchor = document.querySelector<HTMLElement>('button[data-lane="review"]')
    const panel = document.querySelector<HTMLElement>('[data-workflow-panel]')
    if (modelPicker === null) throw new Error('model picker not found')
    if (modelAnchor === null) throw new Error('review model anchor not found')
    if (panel === null) throw new Error('workflow panel not found while reading model picker')
    const box = modelPicker.getBoundingClientRect()
    const anchorBox = modelAnchor.getBoundingClientRect()
    const expectedLeft = Math.min(
      Math.max(anchorBox.left, margin),
      window.innerWidth - box.width - margin,
    )
    return {
      modelPickerParentIsBody: modelPicker.parentElement === document.body,
      modelPickerOutsidePanel: !panel.contains(modelPicker),
      modelPickerWithinViewportMargin:
        box.left >= margin - 0.5
        && box.top >= margin - 0.5
        && box.right <= window.innerWidth - margin + 0.5
        && box.bottom <= window.innerHeight - margin + 0.5,
      modelPickerUsesExpectedHorizontalClamp: Math.abs(box.left - expectedLeft) <= 0.5,
    }
  }, MARGIN)
  return { ...panel, ...picker }
}

describe.skipIf(MODE === 'record')('web e2e: DuraSH workflow settings stay portaled and unclipped', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({
      extraOverlayPath: OVERLAY,
      extraInstallAnchors: [INSTALL_ANCHOR],
    })
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: VIEWPORT, locale: ZH_BROWSER_LOCALE })
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspaceZh(page, scaffold.workspaceCwd)
    await page.setViewportSize(VIEWPORT)
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('keeps the panel, effort menu, and model picker in body portals at the narrow viewport', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-durash-workflow-settings'))
    await openWorkflowSettings(page)

    const reviewEffort = page.getByRole('button', { name: '审查思考强度' })
    await reviewEffort.waitFor({ timeout: 10_000 })
    await reviewEffort.click()
    await page.getByRole('menu').waitFor({ timeout: 10_000 })
    const menuMetrics = await readMenuMetrics(page)

    const reviewModel = page.getByRole('button', { name: '审查模型' })
    await reviewModel.waitFor({ timeout: 10_000 })
    await reviewModel.click()
    await page.locator('[data-model-picker]').waitFor({ timeout: 10_000 })
    const pickerMetrics = await readPickerMetrics(page)

    await compareOrRefreshGolden(LAYOUT_EXPECTED, renderExpected(menuMetrics, pickerMetrics), MODE)

    expect(menuMetrics.panelParentIsBody).toBe(true)
    expect(menuMetrics.panelAboveTrigger).toBe(true)
    expect(menuMetrics.panelWithinViewportMargin).toBe(true)
    expect(menuMetrics.panelUsesExpectedHorizontalClamp).toBe(true)
    expect(menuMetrics.panelExercisesRightEdgeClamp).toBe(true)
    expect(menuMetrics.effortMenuParentIsBody).toBe(true)
    expect(menuMetrics.effortMenuOutsidePanel).toBe(true)
    expect(menuMetrics.effortMenuWithinViewportMargin).toBe(true)
    expect(menuMetrics.effortMenuUsesExpectedHorizontalClamp).toBe(true)
    expect(pickerMetrics.panelParentIsBody).toBe(true)
    expect(pickerMetrics.panelAboveTrigger).toBe(true)
    expect(pickerMetrics.panelWithinViewportMargin).toBe(true)
    expect(pickerMetrics.panelUsesExpectedHorizontalClamp).toBe(true)
    expect(pickerMetrics.panelExercisesRightEdgeClamp).toBe(true)
    expect(pickerMetrics.modelPickerParentIsBody).toBe(true)
    expect(pickerMetrics.modelPickerOutsidePanel).toBe(true)
    expect(pickerMetrics.modelPickerWithinViewportMargin).toBe(true)
    expect(pickerMetrics.modelPickerUsesExpectedHorizontalClamp).toBe(true)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 90_000)

  it('keeps its owner-local expected inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['layout.expected.md'])
  })
})
