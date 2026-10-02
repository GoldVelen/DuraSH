// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { WorkflowPolicyDock, type WorkflowPolicyDockProps } from '../src/client/WorkflowPolicyDock.tsx'
import type { ReliabilityControllerView, ReliabilitySessionState } from '../src/client/controller.ts'
import { en, zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t: WorkflowPolicyDockProps['t'] = makeTranslate(zh, commonZh)
const enT: WorkflowPolicyDockProps['t'] = makeTranslate(en, commonEn)
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
          thinkingLevels: ['off', 'high', 'max'],
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
          thinkingLevels: ['low', 'xhigh'],
        },
      ],
      ...over,
    },
  }
}

function unusedSlotSource(): never {
  throw new Error('Workflow policy dock does not use this standard slot source')
}

const standardProps = {
  usePanelInfo: unusedSlotSource,
  useSessions: unusedSlotSource,
  useSessionStatus: unusedSlotSource,
  useSessionRetainInfo: unusedSlotSource,
  useResource: unusedSlotSource,
  useWorkspaces: unusedSlotSource,
  useSession: unusedSlotSource,
  useProjection: unusedSlotSource,
  useConversation: unusedSlotSource,
  useInput: unusedSlotSource,
  useChat: unusedSlotSource,
  useTrajectory: unusedSlotSource,
  inputActions: {
    captureInsertion: unusedSlotSource, insertText: unusedSlotSource, setDraft: unusedSlotSource,
    addAttachments: unusedSlotSource, removeAttachment: unusedSlotSource,
    pruneAttachments: unusedSlotSource, submit: unusedSlotSource,
  },
}

function setup(session = state(), container?: HTMLElement, translate = t) {
  const store = createSnapshotStore<ReliabilityControllerView>({
    sessions: new Map([[SID, session]]),
  })
  const loadPolicy = vi.fn<WorkflowPolicyDockProps['loadPolicy']>(() => Promise.resolve({ ok: true }))
  const ensurePolicy = vi.fn<WorkflowPolicyDockProps['ensurePolicy']>(() => Promise.resolve({ ok: true }))
  const configure = vi.fn<WorkflowPolicyDockProps['configure']>(() => Promise.resolve({ ok: true }))
  const props: WorkflowPolicyDockProps = {
    ...standardProps,
    usePolicy: bindSnapshotSelector(store),
    readPolicy: () => store.getSnapshot().sessions.get(SID) ?? session,
    loadPolicy,
    ensurePolicy,
    configure,
    sessionId: SID,
    t: translate,
  }
  const rendered = render(<WorkflowPolicyDock {...props} />, container === undefined ? undefined : { container })
  return { ...rendered, store, loadPolicy, ensurePolicy, configure }
}

describe('WorkflowPolicyDock', () => {
  it.each([
    { lane: 'implementationModel', label: '实施模型', alert: '当前目录不再提供这些已选模型：', translate: t, settings: '工作流设置' },
    { lane: 'reviewModel', label: '审查模型', alert: '当前目录不再提供这些已选模型：', translate: t, settings: '工作流设置' },
    { lane: 'implementationModel', label: 'Implementation model', alert: 'The current directory no longer offers these selected models:', translate: enT, settings: 'Workflow settings' },
    { lane: 'reviewModel', label: 'Review model', alert: 'The current directory no longer offers these selected models:', translate: enT, settings: 'Workflow settings' },
  ] as const)('identifies a removed $lane without choosing another model in $settings', ({ lane, label, alert, translate, settings }) => {
    const unavailable = 'removed-provider/saved-model'
    const session = state({
      enabled: false,
      implementationModel: 'deepseek-official/deepseek-v4-flash', implementationThinking: 'high',
      reviewModel: 'cursor/deepseek-v4-pro', reviewThinking: 'xhigh',
      [lane]: unavailable,
    })
    const { configure } = setup(session, undefined, translate)
    fireEvent.click(screen.getByRole('button', { name: settings }))
    expect(screen.getByRole('alert').textContent).toContain(alert)
    expect(screen.getByRole('alert').textContent).toContain(unavailable)
    expect(screen.getByRole('button', { name: label }).textContent).toContain(unavailable)
    expect(configure).not.toHaveBeenCalled()
  })

  it.each([false, true])('saves the current model choices when toggling from enabled=%s', async (enabled) => {
    const original = state({
      enabled,
      implementationModel: 'deepseek-official/deepseek-v4-flash',
      implementationThinking: 'high',
      reviewModel: 'deepseek-official/deepseek-v4-flash',
      reviewThinking: 'high',
    })
    const { configure, store } = setup(original)
    configure.mockImplementation(async (request) => {
      store.set({ sessions: new Map([[SID, state({ ...original.policy, ...request, revision: 2 })]]) })
      return { ok: true }
    })
    fireEvent.click(screen.getByRole('button', { name: '工作流设置' }))
    fireEvent.click(screen.getByRole('button', { name: '审查模型' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cursor' }))
    fireEvent.click(screen.getByRole('button', { name: /DeepSeek V4 Pro/ }))
    expect(screen.getByRole('button', { name: '审查模型' }).textContent).toContain('DeepSeek V4 Pro')

    fireEvent.click(screen.getByRole('button', { name: enabled ? '关闭工作流' : '开启工作流' }))
    await waitFor(() => {
      expect(configure).toHaveBeenCalledWith({
        sessionId: SID, enabled: !enabled,
        implementationModel: 'deepseek-official/deepseek-v4-flash', implementationThinking: 'high',
        reviewModel: 'cursor/deepseek-v4-pro', reviewThinking: 'xhigh',
      })
    })
    expect(screen.getByRole('button', { name: '审查模型' }).textContent).toContain('DeepSeek V4 Pro')
    expect(screen.getByRole('button', { name: !enabled ? '关闭工作流' : '开启工作流' })).toBeTruthy()
  })

  it('uses ensured defaults when enabling before a policy snapshot is available', async () => {
    const { store, ensurePolicy, configure } = setup()
    store.set({ sessions: new Map() })
    const pending = Promise.withResolvers<{ ok: true }>()
    ensurePolicy.mockReturnValue(pending.promise)
    fireEvent.click(screen.getByRole('button', { name: '工作流设置' }))
    fireEvent.click(screen.getByRole('button', { name: '开启工作流' }))
    const ensured = state({
      implementationModel: 'deepseek-official/deepseek-v4-flash', implementationThinking: 'high',
      reviewModel: 'cursor/deepseek-v4-pro', reviewThinking: 'xhigh',
    })
    store.set({ sessions: new Map([[SID, ensured]]) })
    pending.resolve({ ok: true })
    await waitFor(() => {
      expect(configure).toHaveBeenCalledWith({
        sessionId: SID, enabled: true,
        implementationModel: ensured.policy.implementationModel,
        implementationThinking: ensured.policy.implementationThinking,
        reviewModel: ensured.policy.reviewModel,
        reviewThinking: ensured.policy.reviewThinking,
      })
    })
  })

  it('shows unresolved checks and test risks even when the workflow is off', () => {
    setup({ ...state(), acceptance: {
      taskId: 'task-direct', status: 'pending', checksPassed: false,
      independentReview: 'not-reviewed',
      reasons: ['Final full suite failed'], risks: ['A test assertion was removed'],
    } })
    expect(screen.getByText('未满足验收')).toBeTruthy()
    expect(screen.getByText('未独立审查')).toBeTruthy()
    expect(screen.getByText('Final full suite failed')).toBeTruthy()
    expect(screen.getByText('A test assertion was removed')).toBeTruthy()
    expect(screen.queryByText('已验收')).toBeNull()
  })

  it('separates checks passed from independent review and hides status without a task', () => {
    const view = setup({ ...state(), acceptance: {
      taskId: 'task-direct', status: 'checks-passed', checksPassed: true,
      independentReview: 'not-reviewed', reasons: [], risks: [],
    } })
    expect(screen.getByText('检查通过')).toBeTruthy()
    expect(screen.getByText('未独立审查')).toBeTruthy()
    expect(screen.queryByText('已验收')).toBeNull()
    view.unmount()
    setup()
    expect(screen.queryByRole('status')).toBeNull()
  })

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
