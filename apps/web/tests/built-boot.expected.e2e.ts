// @vitest-environment jsdom
// The built-bundle boot smoke: the assembled-jsdom test that owns the boot
// graph itself. Other files share the same scaffolding (assembled-boot.ts) to
// reach a surface only the built bundles expose; this one asserts that the
// graph assembles at all — staged activation across the immediately tier and
// the inject layers, per-plugin CSS injection, and a rendered journey reaching
// chat content from the keyless fixture Connection RPC.
//
// Component behavior remains owned by per-package suites (SlotTestRuntime
// benches over src). This smoke additionally pins the resident interaction
// fixture's cross-plugin projection because only the built connection,
// Controller, UI adapter, and Workspace graph can prove that transport-to-row
// path end to end.
import { resolve } from 'node:path'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { expect, it } from 'vitest'
import { installAssembledBootEnv, mountAssembledApp } from './assembled-boot.ts'
import { readVerifiedClientBuildEnvironment } from './client-build-record.ts'

installAssembledBootEnv()

const clientBuildEnvironment = readVerifiedClientBuildEnvironment(resolve(import.meta.dirname, '../../..'))
const assembledProfile = clientBuildEnvironment.DSH_CLIENT_BUILD_PROFILE === 'durash' ? 'durash' : 'web'

it('boots the built plugin graph and renders a fixture session end to end', async () => {
  mountAssembledApp('?fixture', { profile: assembledProfile })

  // The sidebar renders from the boot graph: every inject layer activated.
  const tree = await screen.findByRole('tree', { name: 'Sessions' }, { timeout: 10_000 })
  const boot = Reflect.get(window, '__DSH_BOOT__') as { entries: Array<{ id: string }> } | undefined
  if (assembledProfile === 'web') {
    expect(document.querySelector('svg[viewBox="26 0 156 24"]')).not.toBeNull()
    expect(screen.queryByText('DSH Local Build')).toBeNull()
  } else {
    expect(boot?.entries.some(entry => entry.id === '@durash/dsh-client-ui-brand')).toBe(true)
    expect(document.querySelector('svg[viewBox="0 0 64 64"]')).not.toBeNull()
    expect(document.querySelector('svg[viewBox="0 0 23.16 17.04"]')).toBeNull()
    expect(document.querySelector('svg[viewBox="26 0 156 24"]')).toBeNull()
    screen.getByText('DuraSH')
  }
  // The compact layout dropped group session counts; the fixture workspace
  // group row renders immediately with its sessions beneath it.
  const fixtureGroup = (await within(tree).findAllByText('fixture'))
    .map(el => el.closest<HTMLElement>('[role="treeitem"]'))
    .find(el => el?.getAttribute('aria-expanded') !== null)
  if (fixtureGroup === undefined) throw new Error('fixture Workspace group missing')

  // The resident fixture has both a question and an approval; composer routing
  // exposes the question first, and the assembled workspace plugin mirrors that
  // actionable wait instead of the underlying running state.
  const waitingTitle = await within(tree).findByText('Fixture 历史会话')
  const waitingRow = waitingTitle.closest<HTMLElement>('[role="treeitem"]')
  if (waitingRow === null) throw new Error('fixture Session title must belong to a tree row')
  expect(waitingRow.querySelector('[data-state="warning"]')).not.toBeNull()
  expect(waitingRow.querySelector('[data-state="ongoing"]')).toBeNull()
  within(waitingRow).getByText('Waiting for answer')

  // Opening a session reaches chat content through the fixture transport.
  fireEvent.click(waitingTitle)
  await waitFor(() => {
    expect(document.querySelector('[data-sample="bash"]')).not.toBeNull()
  }, { timeout: 10_000 })
  // The generated bundle roster mounts the question UI before the approval UI.
  // Skip the resident fixture's three questions, then resolve its approval so
  // the ordinary composer bar (which owns ContextMeter) resumes.
  for (let index = 0; index < 3; index += 1) {
    fireEvent.click(await screen.findByRole('button', { name: 'Skip this question' }))
  }
  fireEvent.click(await screen.findByRole('button', { name: 'Allow once' }))

  // The fixture mirrors all three token-meter projections, so the assembled
  // ContextMeter reaches its composition panel instead of only the occupancy
  // fallback path.
  const contextTrigger = await screen.findByRole('button', { name: /of context used/ })
  fireEvent.click(contextTrigger)
  const contextPanel = await screen.findByRole('dialog', { name: 'of context used' })
  within(contextPanel).getByText('System prompt')
  within(contextPanel).getByText('Tools')
  within(contextPanel).getByText('Messages')

  // The write/edit turns render a real diff card through the assembled graph
  // (the keyed FileMutationRow composing ToolRow + DiffBlock), not just the
  // fixture's raw text. The card is collapsed by default, so expand each edit/
  // write row first. The write turn's `hello fixture\n` proves the terminator
  // rule end to end: a trailing newline terminates its line, so the footer reads
  // `+1` (not a phantom `+2`) and one distinct file. The `+ ` prefix is a CSS
  // ::before, so it is absent from textContent — assert on the line body and the
  // footer.
  const mutationRows = [...document.querySelectorAll('[data-variant="write"],[data-variant="edit"]')]
  expect(mutationRows.length).toBeGreaterThan(0)
  for (const row of mutationRows) {
    const toggle = row.querySelector('[data-expandable]')
    if (toggle !== null) act(() => { fireEvent.click(toggle) })
  }
  const diffCards = [...document.querySelectorAll('[data-diff]')]
  expect(diffCards.length).toBeGreaterThan(0)
  const footers = diffCards.map(card => card.textContent ?? '')
  expect(footers.some(text => text.includes('hello fixture') && text.includes('+1 -0 · 1 file'))).toBe(true)

  // The web render intent reaches the assembled boot graph: the fixture's
  // web_search / web_fetch turns render their keyed WebRow cards, proving the
  // registration, wire projection, and card rendering survive the real bundle
  // path (not just the per-package src benches). WebRow composes ToolRow, so the
  // card is collapsed behind the row; the keyed row is pinned by its `data-tool`
  // (ToolRow sets it from the wire tool name).
  const webSearchRow = await waitFor(() => {
    const row = document.querySelector('[data-tool="web_search"]')
    expect(row).not.toBeNull()
    expect(document.querySelector('[data-tool="web_fetch"]')).not.toBeNull()
    return row!
  }, { timeout: 10_000 })
  // Expand the web_search row to prove its WebBlock card renders end to end.
  const webToggle = webSearchRow.querySelector('[data-expandable]')
  if (webToggle !== null) act(() => { fireEvent.click(webToggle) })
  await waitFor(() => {
    expect(webSearchRow.querySelector('[data-web]')).not.toBeNull()
  }, { timeout: 10_000 })

  // Every bundle injected its plugin-owned style tag (the loader's CSS path).
  const styleOwners = [...document.head.querySelectorAll('style[data-plugin]')]
    .map(style => style.getAttribute('data-plugin'))
  for (const plugin of ['@deepseek-ai/dsh-client-ui-layout', '@deepseek-ai/dsh-client-ui-sidebar', '@deepseek-ai/dsh-client-ui-conversation', '@deepseek-ai/dsh-client-ui-tool']) {
    expect(styleOwners).toContain(plugin)
  }
})

it('boots without ui-chat and does not select another conversation view implicitly', async () => {
  mountAssembledApp('?fixture', {
    exclude: ['@deepseek-ai/dsh-client-ui-chat'],
    profile: assembledProfile,
  })

  const tree = await screen.findByRole('tree', { name: 'Sessions' }, { timeout: 10_000 })
  const boot = Reflect.get(window, '__DSH_BOOT__') as { entries: Array<{ id: string }> } | undefined
  expect(boot?.entries.some(entry => entry.id === '@deepseek-ai/dsh-client-ui-chat')).toBe(false)
  const sessionTitle = await within(tree).findByText('Fixture 历史会话')
  fireEvent.click(sessionTitle)
  await waitFor(() => {
    expect(document.querySelector('[data-slot="conversation.session"]')).not.toBeNull()
  }, { timeout: 10_000 })
  expect(document.querySelector('[data-slot="conversation.view"]')).toBeNull()
})
