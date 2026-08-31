import { memo } from 'react'
import { StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ReliabilityLoopRef } from '@durash/dsh-reliability-loop/client'
import { ReliabilityDetailsButton, type ReliabilityStatusDockInjected } from './ReliabilityStatusDock.tsx'
import type { ReliabilityTerminalNodeData } from './reliability-terminal-definition.ts'
import { NS } from './locales.ts'
import css from './ReliabilityTerminalView.module.css'

/** Authenticated details action for a terminal Chat node. */
export interface ReliabilityTerminalViewInjected {
  details: ReliabilityStatusDockInjected['details']
}

type ReliabilityTerminalViewProps = PropsRuntime<'conversation.chat.node', 'reliability-loop-terminal'>
  & InjectFace<ReliabilityTerminalViewInjected>
  & PropsLocale<typeof NS>

/** One compact, deterministic result row; it never renders live stage telemetry. */
export const ReliabilityTerminalView = memo(function ReliabilityTerminalView({ node, details, t }: ReliabilityTerminalViewProps) {
  const data: ReliabilityTerminalNodeData = node.data
  const loopRef: ReliabilityLoopRef = { loopId: data.loopId, revision: data.revision }
  const dot = data.stage === 'completed' ? 'done' : data.stage === 'failed' ? 'error' : 'warning'
  return (
    <div className={css.row} data-reliability-terminal="" role="group" aria-label={t('terminal.aria')}>
      <div className={css.card}>
        <div className={css.header}>
          <StateDot state={dot} size={10} />
          <strong>{t(`status.${data.stage}`)}</strong>
          <ReliabilityDetailsButton loopRef={loopRef} details={details} t={t} className={css.detailsButton} />
        </div>
        <p>{data.summary}</p>
      </div>
    </div>
  )
})
