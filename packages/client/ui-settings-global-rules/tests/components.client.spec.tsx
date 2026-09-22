// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { GlobalRulesDocument } from '@deepseek-ai/dsh-api-settings-controller/types'
import { GlobalRulesSection } from '../src/client/GlobalRulesSection.tsx'
import type { GlobalRulesSectionInjected, GlobalRulesSectionProps } from '../src/client/GlobalRulesSection.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const document: GlobalRulesDocument = {
  path: '/host/custom/rules/AGENTS.md', content: '# Existing\n\nUser rules.  \n',
  revision: 'revision-one', exists: true, loadingEnabled: true, maxBytes: 32768, maxSourceBytes: 65536,
}
const unusedHook = (() => { throw new Error('The file editor does not consume session hooks') }) as never
const kit = {
  useSessions: unusedHook, useSessionStatus: unusedHook, usePanelInfo: unusedHook,
  useSessionRetainInfo: unusedHook, useResource: unusedHook, useWorkspaces: unusedHook,
  close: vi.fn(),
}
const t: GlobalRulesSectionProps['t'] = (key, values) => {
  let value: string = en[key as keyof typeof en] ?? key
  for (const [name, replacement] of Object.entries(values ?? {})) value = value.replace(`{${name}}`, String(replacement))
  return value
}

function mount(overrides: Partial<GlobalRulesSectionInjected> = {}) {
  const read = vi.fn<GlobalRulesSectionInjected['read']>(async () => document)
  const save = vi.fn<GlobalRulesSectionInjected['save']>(async content => ({
    kind: 'saved', document: { ...document, content, revision: 'revision-two', exists: true },
  }))
  const operations = { read, save, ...overrides }
  const view = render(<GlobalRulesSection {...kit} {...operations} t={t} />)
  return { ...view, ...operations }
}

async function editor(): Promise<HTMLTextAreaElement> {
  return screen.findByRole('textbox', { name: en.editor }) as Promise<HTMLTextAreaElement>
}

describe('global-rules settings editor', () => {
  it('loads the original Host file, saves exact edited text with its revision, and only confirms persistence', async () => {
    const b = mount()
    const input = await editor()
    expect(input.value).toBe(document.content)
    expect(screen.getByText(document.path)).toBeTruthy()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en.save }).disabled).toBe(true)
    const edited = '# Edited\n\n  Keep whitespace.  \n'
    fireEvent.change(input, { target: { value: edited } })
    expect(screen.getByText(en.dirty)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await screen.findByText(en.saved)
    expect(b.save).toHaveBeenCalledWith(edited, document.revision)
    expect(b.read).toHaveBeenCalledTimes(1)
    expect(screen.getByText(en.budget)).toBeTruthy()
    expect(input.value).toBe(edited)
  })

  it('permits a first empty save without creating a file on read', async () => {
    const save = vi.fn<GlobalRulesSectionInjected['save']>(async content => ({
      kind: 'saved', document: { ...document, content, exists: true },
    }))
    mount({ read: async () => ({ ...document, content: '', exists: false }), save })
    expect((await editor()).value).toBe('')
    expect(screen.getByText(en.empty)).toBeTruthy()
    expect(save).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await screen.findByText(en.saved)
    expect(save).toHaveBeenCalledWith('', document.revision)
    expect(screen.queryByText(en.empty)).toBeNull()
  })

  it('saves clearing as an empty body and retains a failed draft for retry', async () => {
    const save = vi.fn<GlobalRulesSectionInjected['save']>()
      .mockResolvedValueOnce({ kind: 'failed', message: 'EACCES: write denied' })
      .mockResolvedValueOnce({ kind: 'saved', document: { ...document, content: '' } })
    mount({ save })
    const input = await editor()
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await screen.findByText('Could not save rules: EACCES: write denied')
    expect(input.value).toBe('')
    expect(screen.queryByText(en.saved)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await screen.findByText(en.saved)
    expect(save).toHaveBeenLastCalledWith('', document.revision)
  })

  it('preserves the draft on conflict and requires explicit reload before another save', async () => {
    const read = vi.fn<GlobalRulesSectionInjected['read']>()
      .mockResolvedValueOnce(document)
      .mockResolvedValueOnce({ ...document, content: 'External edit', revision: 'external-revision' })
    const save = vi.fn<GlobalRulesSectionInjected['save']>().mockResolvedValue({ kind: 'conflict' })
    mount({ read, save })
    const input = await editor()
    fireEvent.change(input, { target: { value: 'My draft' } })
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await screen.findByText(en.conflict)
    expect(input.value).toBe('My draft')
    expect(screen.queryByText(en.saved)).toBeNull()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en.save }).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: en.replaceDraft }))
    await waitFor(() => { expect(input.value).toBe('External edit') })
    expect(screen.queryByText(en.conflict)).toBeNull()
    fireEvent.change(input, { target: { value: 'Merged edit' } })
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await waitFor(() => { expect(save).toHaveBeenLastCalledWith('Merged edit', 'external-revision') })
  })

  it('shows read permission failure without a writable editor and supports retry', async () => {
    const read = vi.fn<GlobalRulesSectionInjected['read']>()
      .mockRejectedValueOnce(new Error('EACCES: read denied')).mockResolvedValue(document)
    const b = mount({ read })
    await screen.findByText('Could not read rules: EACCES: read denied')
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(b.save).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: en.reload }))
    expect((await editor()).value).toBe(document.content)
  })

  it('shows absent and disabled loading accurately without inventing a file path', async () => {
    const view = mount({ read: async () => null })
    await screen.findByText(en.unavailable)
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByText(document.path)).toBeNull()
    view.unmount()
    mount({ read: async () => ({ ...document, loadingEnabled: false }) })
    await editor()
    expect(screen.getByText(en.disabled)).toBeTruthy()
  })

  it('warns when multibyte content exceeds the file or instruction budget', async () => {
    mount({ read: async () => ({ ...document, content: '规则', maxSourceBytes: 4, maxBytes: 3 }) })
    await editor()
    expect(screen.getByText('The content exceeds the file read limit (4 bytes), so this rules file will be omitted.')).toBeTruthy()
    expect(screen.getByText('The content exceeds the total instruction budget (3 bytes); the complete rules cannot be guaranteed in a request.')).toBeTruthy()
  })

  it('keeps input and save disabled until the write settles', async () => {
    let finish!: (value: Awaited<ReturnType<GlobalRulesSectionInjected['save']>>) => void
    mount({ save: () => new Promise((resolve) => { finish = resolve }) })
    const input = await editor()
    fireEvent.change(input, { target: { value: 'Pending draft' } })
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    expect(input.disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en.saving }).disabled).toBe(true)
    expect(screen.queryByText(en.saved)).toBeNull()
    finish({ kind: 'saved', document: { ...document, content: 'Pending draft' } })
    await screen.findByText(en.saved)
    expect(input.disabled).toBe(false)
  })
})
