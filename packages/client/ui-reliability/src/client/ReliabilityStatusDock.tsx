import { useEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import {
  IconCloseOutline16, IconStopFill16, StateDot, useAnchoredMaxHeight, useAnchoredPosition,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  ReliabilityLoopDetails,
  ReliabilityLoopRef,
  ReliabilityLoopStage,
  ReliabilityLoopStatusView,
} from '@durash/dsh-reliability-loop/client'
import { NS } from './locales.ts'
import css from './ReliabilityStatusDock.module.css'

/** Session-bound status mutations and authenticated detail lookup. */
export interface ReliabilityStatusDockInjected {
  details: (ref: ReliabilityLoopRef) => Promise<RemoteResult<ReliabilityLoopDetails>>
  cancel: (ref: ReliabilityLoopRef) => Promise<RemoteResult<ReliabilityLoopStatusView>>
  dismiss: (ref: ReliabilityLoopRef) => Promise<RemoteResult<ReliabilityLoopRef>>
}

/** Input-dock status component props. */
export type ReliabilityStatusDockProps = PropsRuntime<'conversation.input.dock'>
  & InjectFace<ReliabilityStatusDockInjected>
  & PropsLocale<typeof NS>

/** Authenticated details button used by both the dock and terminal Chat node. */
export interface ReliabilityDetailsButtonProps {
  loopRef: ReliabilityLoopRef
  details: ReliabilityStatusDockInjected['details']
  t: ReliabilityStatusDockProps['t']
  className?: string | undefined
}

const TERMINAL = new Set<ReliabilityLoopStage>(['completed', 'blocked', 'failed', 'cancelled'])

function stageKey(stage: ReliabilityLoopStage): `status.${ReliabilityLoopStage}` {
  return `status.${stage}`
}

function stateDot(stage: ReliabilityLoopStage): 'done' | 'warning' | 'ongoing' | 'error' {
  if (stage === 'completed') return 'done'
  if (stage === 'blocked' || stage === 'cancelled') return 'warning'
  if (stage === 'failed') return 'error'
  return 'ongoing'
}

function refKey(ref: ReliabilityLoopRef): string {
  return `${String(ref.loopId)}:${ref.revision}`
}

function exactRef(ref: ReliabilityLoopRef): ReliabilityLoopRef {
  return { loopId: ref.loopId, revision: ref.revision }
}

interface DetailsPanelProps {
  anchorRef: RefObject<HTMLElement | null>
  open: boolean
  loading: boolean
  details: ReliabilityLoopDetails | null
  error: string | null
  t: ReliabilityStatusDockProps['t']
  onClose: () => void
}

function laneText(
  lane: ReliabilityLoopDetails['implementation'],
  t: ReliabilityStatusDockProps['t'],
): string {
  const effort = lane.reasoningEffort === undefined ? t('details.noEffort') : String(lane.reasoningEffort)
  return `${lane.provider}/${lane.model} · ${t('details.effort')}: ${effort}`
}

/** Compact, body-portaled full report panel. */
function DetailsPanel({ anchorRef, open, loading, details, error, t, onClose }: DetailsPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const position = useAnchoredPosition({
    open,
    anchorRef,
    panelRef,
    gap: 8,
    margin: 12,
    side: 'top',
  })
  const maxHeight = useAnchoredMaxHeight(panelRef, 480, position?.top)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (anchorRef.current?.contains(target) || panelRef.current?.contains(target)) return
      onClose()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [anchorRef, onClose, open])

  if (!open) return null
  return createPortal((
    <div
      ref={panelRef}
      className={css.detailsPanel}
      style={{
        ...(position ?? { visibility: 'hidden', left: 0, top: 0 }),
        maxHeight,
      }}
      role="dialog"
      aria-label={t('details.title')}
      data-reliability-details=""
    >
      <header className={css.detailsHeader}>
        <h3>{t('details.title')}</h3>
        <button type="button" className={css.iconButton} aria-label={t('details.close')} onClick={onClose}>
          <IconCloseOutline16 size={14} />
        </button>
      </header>
      {loading ? <p className={css.detailsMuted}>{t('details.loading')}</p> : null}
      {error === null ? null : <p className={css.actionError} role="alert">{error}</p>}
      {details === null ? null : (
        <div className={css.detailsBody}>
          <section>
            <h4>{t('details.objective')}</h4>
            <p>{details.objective}</p>
          </section>
          <div className={css.lanes}>
            <section>
              <h4>{t('details.implementation')}</h4>
              <p>{laneText(details.implementation, t)}</p>
            </section>
            <section>
              <h4>{t('details.review')}</h4>
              <p>{laneText(details.review, t)}</p>
            </section>
          </div>
          {details.rounds.map(round => (
            <section key={round.round} className={css.round}>
              <h4>{t('details.round', { round: round.round })}</h4>
              {round.implementation === undefined ? null : (
                <div>
                  <strong>{t('details.implementationResult')}</strong>
                  <p>{round.implementation.summary}</p>
                </div>
              )}
              {round.review === undefined ? null : (
                <div>
                  <strong>{t('details.reviewResult')} · {t(`details.verdict.${round.review.verdict}`)}</strong>
                  <p>{round.review.feedback}</p>
                </div>
              )}
            </section>
          ))}
          {details.error === undefined ? null : (
            <section>
              <h4>{t('details.error')}</h4>
              <p className={css.actionError}>{details.error}</p>
            </section>
          )}
        </div>
      )}
    </div>
  ), document.body)
}

/** Session-authenticated details trigger shared by live and terminal views. */
export function ReliabilityDetailsButton({ loopRef, details: readDetails, t, className }: ReliabilityDetailsButtonProps) {
  const anchorRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [value, setValue] = useState<ReliabilityLoopDetails | null>(null)
  const [error, setError] = useState<string | null>(null)
  const key = refKey(loopRef)

  useEffect(() => {
    setOpen(false)
    setLoading(false)
    setValue(null)
    setError(null)
  }, [key])

  const show = (): void => {
    setOpen(true)
    setLoading(true)
    setError(null)
    void readDetails(exactRef(loopRef)).then((result) => {
      if (result.ok) setValue(result.value)
      else setError(`${result.error.message} (${result.error.code})`)
    }).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : String(cause))
    }).finally(() => { setLoading(false) })
  }

  return (
    <>
      <button ref={anchorRef} type="button" className={className} onClick={open ? () => { setOpen(false) } : show}>
        {t('status.details')}
      </button>
      <DetailsPanel
        anchorRef={anchorRef}
        open={open}
        loading={loading}
        details={value}
        error={error}
        t={t}
        onClose={() => { setOpen(false) }}
      />
    </>
  )
}

/** One-line status sourced only from the Host Session projection. */
export function ReliabilityStatusDock({ useProjection, details, cancel, dismiss, t }: ReliabilityStatusDockProps) {
  const status = useProjection('reliabilityLoop')
  const [pending, setPending] = useState(false)
  const [confirmingCancel, setConfirmingCancel] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const key = status === undefined || status === null ? 'none' : refKey(status)

  useEffect(() => {
    setPending(false)
    setConfirmingCancel(false)
    setError(null)
  }, [key])

  if (status === undefined || status === null) return null
  const terminal = TERMINAL.has(status.stage)
  const summary = status.error ?? status.terminalSummary ?? status.objectiveSummary

  const run = (action: () => Promise<RemoteResult<unknown>>): void => {
    if (pending) return
    setPending(true)
    setError(null)
    void action().then((result) => {
      if (!result.ok) setError(`${result.error.message} (${result.error.code})`)
    }).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : String(cause))
    }).finally(() => { setPending(false) })
  }

  return (
    <div className={css.dock} data-reliability-status="" role="status" aria-live="polite" aria-label={t('status.aria')}>
      <div className={css.bar} data-stage={status.stage}>
        <StateDot state={stateDot(status.stage)} size={10} />
        <span className={css.stage}>{t(stageKey(status.stage))}</span>
        <span className={css.objective} title={summary}>{summary}</span>
        {error === null ? null : <span className={css.actionError} role="alert">{error}</span>}
        <div className={css.actions}>
          <ReliabilityDetailsButton loopRef={status} details={details} t={t} className={css.actionButton} />
          {terminal
            ? (
              <button
                type="button"
                className={css.iconButton}
                disabled={pending}
                aria-label={t('status.dismiss')}
                onClick={() => { run(() => dismiss(exactRef(status))) }}
              >
                <IconCloseOutline16 size={14} />
              </button>
            )
            : (
              <button
                type="button"
                className={confirmingCancel ? `${css.actionButton} ${css.dangerButton}` : css.actionButton}
                disabled={pending}
                aria-label={t(confirmingCancel ? 'status.cancelConfirm' : 'status.cancel')}
                onClick={() => {
                  if (!confirmingCancel) { setConfirmingCancel(true); return }
                  run(() => cancel(exactRef(status)))
                }}
              >
                <IconStopFill16 size={12} />
                <span>{t(confirmingCancel ? 'status.cancelConfirm' : 'status.cancel')}</span>
              </button>
            )}
        </div>
      </div>
    </div>
  )
}
