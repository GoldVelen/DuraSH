// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { WorkflowPolicyDock, type WorkflowPolicyDockProps } from '../src/client/WorkflowPolicyDock.tsx'
import type { ReliabilityControllerView, ReliabilitySessionState } from '../src/client/controller.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t: WorkflowPolicyDockProps['t'] = makeTranslate(zh, commonZh)
const SID = 's-dock' as SessionId

function state(over: Partial<ReliabilitySessionState['policy']> = {}): ReliabilitySessionState {
  return {
    status: 'ready',
    error: null,
    policy: {
      sessionId: SID,
      revision: 1,
      enabled: false,
      implementationModel: null,
      implementationThinking: null,
      reviewModel: null,
      reviewThinking: null,
      updatedAt: 1,
      models: [
        {
          selector: 'deepseek-official/deepseek-v4-flash',
          label: 'DeepSeek V4 Flash',
          provider: 'deepseek-official',
          model: 'deepseek-v4-flash',
          badges: [
            { kind: 'channel', label: 'DuraSH' },
            { kind: 'provider', label: 'DeepSeek' },
          ],
          reasoningEfforts: [
            { id: 'off', name: 'Off', isDefault: false },
            { id: 'high', name: 'High', isDefault: true },
            { id: 'max', name: 'Max', isDefault: false },
          ],
        },
        {
          selector: 'cursor/deepseek-v4-pro',
          label: 'DeepSeek V4 Pro',
          provider: 'cursor',
          model: 'deepseek-v4-pro',
          badges: [
            { kind: 'channel', label: 'Cursor' },
            { kind: 'provider', label: 'DeepSeek' },
          ],
          reasoningEfforts: [
            { id: 'low', name: 'Low', isDefault: true },
            { id: 'xhigh', name: 'Extra high', isDefault: false },
          ],
        },
      ],
      validationError: null,
      ...over,
    },
  }
}

function setup(session = state(), container?: HTMLElement) {
  const store = createSnapshotStore<ReliabilityControllerView>({
    sessions: new Map([[SID, session]]),
  })
  const loadPolicy = vi.fn(() => Promise.resolve({ ok: true as const }))
  const ensurePolicy = vi.fn(() => Promise.resolve({ ok: true as const }))
  const configure = vi.fn(() => Promise.resolve({ ok: true as const }))
  const props = {
    usePolicy: bindSnapshotSelector(store),
    readPolicy: () => store.getSnapshot().sessions.get(SID) ?? session,
    loadPolicy,
    ensurePolicy,
    configure,
    sessionId: SID,
    t,
  } as unknown as WorkflowPolicyDockProps
  const rendered = render(<WorkflowPolicyDock {...props} />, container === undefined ? undefined : { container })
  return { ...rendered, store, loadPolicy, ensurePolicy, configure }
}

describe('WorkflowPolicyDock', () => {
  it('renders the composer chip off by default and loads policy', () => {
    const { loadPolicy } = setup()
    expect(screen.getByRole('button', { name: '工作流设置' }).textContent).toContain('工作流')
    expect(screen.getByRole('button', { name: '工作流设置' }).textContent).toContain('关')
    expect(loadPolicy).toHaveBeenCalled()
  })

  it('renders the settings panel in document.body and closes on outside pointer or Escape', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const { ensurePolicy, unmount } = setup(state(), host)

    fireEvent.click(screen.getByRole('button', { name: '工作流设置' }))
    const panel = screen.getByRole('dialog', { name: '工作流设置' })
    expect(panel.parentElement).toBe(document.body)
    expect(host.contains(panel)).toBe(false)
    expect(ensurePolicy).toHaveBeenCalled()

    fireEvent.pointerDown(document.body)
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '工作流设置' })).toBeNull()
    })

    fireEvent.click(screen.getByRole('button', { name: '工作流设置' }))
    expect(screen.getByRole('dialog', { name: '工作流设置' })).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '工作流设置' })).toBeNull()
    })

    unmount()
    host.remove()
  })

  it('uses the shared menu for thinking levels instead of a native select', () => {
    setup(state({
      implementationModel: 'deepseek-official/deepseek-v4-flash',
      implementationThinking: 'high',
      reviewModel: 'cursor/deepseek-v4-pro',
      reviewThinking: 'xhigh',
    }))

    fireEvent.click(screen.getByRole('button', { name: '工作流设置' }))
    fireEvent.click(screen.getByRole('button', { name: '实施思考强度' }))

    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.getByRole('menu')).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: '高' })).toBeTruthy()
    expect(screen.getByRole('dialog', { name: '工作流设置' })).toBeTruthy()
  })

  it('keeps the model picker in its own portal and applies the selected policy through the current API', async () => {
    const { configure } = setup(state({
      enabled: true,
      implementationModel: 'deepseek-official/deepseek-v4-flash',
      implementationThinking: 'high',
    }))

    fireEvent.click(screen.getByRole('button', { name: '工作流设置' }))
    fireEvent.click(screen.getByRole('button', { name: '审查模型' }))

    const picker = screen.getByRole('dialog', { name: '模型目录' })
    expect(picker.parentElement).toBe(document.body)
    fireEvent.click(screen.getByRole('button', { name: 'Cursor' }))
    fireEvent.click(screen.getByRole('button', { name: /DeepSeek V4 Pro/ }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '模型目录' })).toBeNull()
    })

    fireEvent.click(screen.getByRole('button', { name: '应用' }))
    await waitFor(() => {
      expect(configure).toHaveBeenLastCalledWith({
        sessionId: SID,
        enabled: true,
        implementationModel: 'deepseek-official/deepseek-v4-flash',
        implementationThinking: 'high',
        reviewModel: 'cursor/deepseek-v4-pro',
        reviewThinking: 'xhigh',
      })
    })
  })
})
