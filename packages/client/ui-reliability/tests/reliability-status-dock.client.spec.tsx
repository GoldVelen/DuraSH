// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type {
  ReliabilityLoopDetails,
  ReliabilityLoopStage,
  ReliabilityLoopStatusView,
} from '@durash/dsh-reliability-loop/client'
import { ReliabilityStatusDock, type ReliabilityStatusDockProps } from '../src/client/ReliabilityStatusDock.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t: ReliabilityStatusDockProps['t'] = makeTranslate(zh, commonZh)

function status(stage: ReliabilityLoopStage, over: Partial<ReliabilityLoopStatusView> = {}): ReliabilityLoopStatusView {
  return {
    loopId: 'loop-status' as ReliabilityLoopStatusView['loopId'],
    revision: 3,
    stage,
    objectiveSummary: '实现可靠、可恢复的工作流',
    implementation: { provider: 'xai', model: 'grok-4.6', reasoningEffort: 'xhigh' as never },
    review: { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'high' as never },
    createdAt: '2026-08-31T00:00:00.000Z',
    updatedAt: '2026-08-31T00:01:00.000Z',
    ...over,
  }
}

function details(view: ReliabilityLoopStatusView): ReliabilityLoopDetails {
  return {
    ...view,
    objective: '实现可靠、可恢复的工作流，并在输入框上方显示状态。',
    rounds: [{
      round: 1,
      implementation: { round: 1, summary: '实施完成', agentsStarted: 1 },
      review: { round: 1, verdict: 'approved', feedback: '审查通过', agentsStarted: 1 },
    }],
  }
}

function setup(initial: ReliabilityLoopStatusView | null | undefined) {
  const store = createSnapshotStore<ReliabilityLoopStatusView | null | undefined>(initial)
  const useStatus = bindSnapshotSelector(store)
  const detailSource = initial ?? status('accepted')
  const readDetails = vi.fn(() => Promise.resolve({ ok: true as const, value: details(detailSource) }))
  const cancel = vi.fn(() => Promise.resolve({ ok: true as const, value: status('cancelled') }))
  const dismiss = vi.fn(() => Promise.resolve({
    ok: true as const,
    value: { loopId: status('completed').loopId, revision: 4 },
  }))
  const props = {
    useProjection: (_key: string, selector?: (value: unknown) => unknown) => useStatus(
      value => selector === undefined ? value : selector(value),
    ),
    details: readDetails,
    cancel,
    dismiss,
    t,
  } as unknown as ReliabilityStatusDockProps
  return { ...render(<ReliabilityStatusDock {...props} />), store, readDetails, cancel, dismiss }
}

describe('ReliabilityStatusDock', () => {
  it('occupies no space without a projected loop', () => {
    const { container } = setup(null)
    expect(container.innerHTML).toBe('')
  })

  it.each([
    ['accepted', '已接管'],
    ['implementing', '实施中'],
    ['reviewing', '审查中'],
    ['rework-implementing', '返工中'],
    ['rework-reviewing', '复审中'],
    ['completed', '已完成'],
    ['blocked', '需要处理'],
    ['failed', '失败'],
    ['cancelled', '已取消'],
  ] as const)('renders %s from the Host projection', (stage, label) => {
    setup(status(stage))
    expect(screen.getByText(label)).toBeTruthy()
  })

  it('loads authenticated loop details on demand', async () => {
    const view = status('completed', { terminalSummary: '工作流已通过审查' })
    const { readDetails } = setup(view)
    fireEvent.click(screen.getByRole('button', { name: '查看详情' }))
    await waitFor(() => { expect(screen.getByText('实施完成')).toBeTruthy() })
    expect(readDetails).toHaveBeenCalledWith({ loopId: view.loopId, revision: view.revision })
    expect(screen.getByText('工作流已通过审查')).toBeTruthy()
  })

  it('requires a second activation before explicit cancellation', async () => {
    const view = status('reviewing')
    const { cancel } = setup(view)
    fireEvent.click(screen.getByRole('button', { name: '取消工作流' }))
    expect(cancel).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '再次点击确认取消' }))
    await waitFor(() => {
      expect(cancel).toHaveBeenCalledWith({ loopId: view.loopId, revision: view.revision })
    })
  })

  it('dismisses a terminal dock without deleting its result node', async () => {
    const view = status('failed', { error: 'provider 流提前结束' })
    const { dismiss } = setup(view)
    expect(screen.getByText('provider 流提前结束')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '关闭状态条' }))
    await waitFor(() => {
      expect(dismiss).toHaveBeenCalledWith({ loopId: view.loopId, revision: view.revision })
    })
  })
})
