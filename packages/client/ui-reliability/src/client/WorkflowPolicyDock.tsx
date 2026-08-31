import { useDeferredValue, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import {
  IconChevronDownOutline14, IconCloseOutline16, IconSearchOutline16, Menu,
  useAnchoredMaxHeight, useAnchoredPosition,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  ReliabilityActionResult,
  ReliabilityPolicyRemote,
  ReliabilitySessionState,
} from './controller.ts'
import type {
  ReliabilityModelBadge,
  ReliabilityModelOption,
  ReliabilityPolicyConfigureRequest,
  ReliabilityThinking,
} from '@durash/dsh-reliability-policy/client'
import { NS } from './locales.ts'
import css from './WorkflowPolicyDock.module.css'

/** Session-bound reliability-loop controls injected into the compact composer row. */
export interface WorkflowPolicyDockInjected {
  hooks: { policy: import('@deepseek-ai/dsh-client-ui-slots').HostObservable<import('./controller.ts').ReliabilityControllerView> }
  readPolicy: () => ReliabilitySessionState
  loadPolicy: () => Promise<ReliabilityActionResult>
  ensurePolicy: () => Promise<ReliabilityActionResult>
  configure: (request: ReliabilityPolicyConfigureRequest) => Promise<ReliabilityActionResult>
  sessionId: SessionId
}

/** Composer-row chip plus the next-workflow settings panel. */
export type WorkflowPolicyDockProps =
  import('@deepseek-ai/dsh-client-ui-slots').PropsRuntime<'conversation.input.left'>
  & InjectFace<WorkflowPolicyDockInjected>
  & PropsLocale<typeof NS>

interface DraftState {
  enabled: boolean
  implementationModel: string | null
  implementationThinking: ReliabilityThinking | null
  reviewModel: string | null
  reviewThinking: ReliabilityThinking | null
}

type PickerLane = 'implementation' | 'review'
type PickerChannel = 'default' | 'cursor'

interface WorkflowModelGroup {
  readonly key: string
  readonly provider: string
  readonly options: readonly ReliabilityModelOption[]
}

interface ModelPickerProps {
  anchorRef: RefObject<HTMLElement | null>
  value: string | null
  options: readonly ReliabilityModelOption[]
  disabled: boolean
  t: WorkflowPolicyDockProps['t']
  onSelect: (selector: string | null) => void
}

interface ModelFieldProps {
  lane: PickerLane
  label: string
  value: string | null
  options: readonly ReliabilityModelOption[]
  disabled: boolean
  open: boolean
  t: WorkflowPolicyDockProps['t']
  onToggle: () => void
  onSelect: (selector: string | null) => void
}

interface EffortFieldProps {
  label: string
  value: ReliabilityThinking | null
  levels: readonly ReliabilityThinking[]
  disabled: boolean
  t: WorkflowPolicyDockProps['t']
  onChange: (value: ReliabilityThinking | null) => void
}

const EFFORT_ORDER = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
const OK_RESULT: ReliabilityActionResult = { ok: true }
const UNSET_EFFORT = 'unset'

function effortLabel(level: ReliabilityThinking, t: WorkflowPolicyDockProps['t']): string {
  const known = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
  return known.includes(level) ? t(`effort.${level}` as never) : level
}

function normalizeDraft(state: ReliabilitySessionState): DraftState {
  return {
    enabled: state.policy.enabled,
    implementationModel: state.policy.implementationModel,
    implementationThinking: state.policy.implementationThinking,
    reviewModel: state.policy.reviewModel,
    reviewThinking: state.policy.reviewThinking,
  }
}

function thinkingLevels(
  models: readonly ReliabilityModelOption[],
  selector: string | null,
): readonly ReliabilityThinking[] {
  return models.find(model => model.selector === selector)?.thinkingLevels ?? []
}

function preferredEffort(
  levels: readonly ReliabilityThinking[],
  preferred: ReliabilityThinking,
): ReliabilityThinking | null {
  if (levels.includes(preferred)) return preferred
  const start = EFFORT_ORDER.indexOf(preferred as typeof EFFORT_ORDER[number])
  for (let index = start; index >= 0; index -= 1) {
    const candidate = EFFORT_ORDER[index]
    if (candidate !== undefined && levels.includes(candidate)) return candidate
  }
  return levels[0] ?? null
}

function equalDraft(left: DraftState, right: DraftState): boolean {
  return left.enabled === right.enabled
    && left.implementationModel === right.implementationModel
    && left.implementationThinking === right.implementationThinking
    && left.reviewModel === right.reviewModel
    && left.reviewThinking === right.reviewThinking
}

function badgeLabel(badges: readonly ReliabilityModelBadge[], kind: ReliabilityModelBadge['kind']): string {
  return badges.find(badge => badge.kind === kind)?.label ?? ''
}

function channelOf(model: ReliabilityModelOption | undefined): PickerChannel {
  return badgeLabel(model?.badges ?? [], 'channel') === 'Cursor' ? 'cursor' : 'default'
}

function matchBadges(badges: readonly ReliabilityModelBadge[]): string {
  return badges.map(badge => badge.label).join(' ')
}

function groupWorkflowModels(
  models: readonly ReliabilityModelOption[],
  channel: PickerChannel,
  query: string,
): readonly WorkflowModelGroup[] {
  const needle = query.trim().toLocaleLowerCase()
  const visible = models.filter((model) => {
    if (needle.length > 0) {
      const haystack = `${matchBadges(model.badges)} ${model.selector} ${model.model} ${model.label} ${model.provider}`
        .toLocaleLowerCase()
      return haystack.includes(needle)
    }
    return channelOf(model) === channel
  })
  const grouped = new Map<string, ReliabilityModelOption[]>()
  for (const model of visible) {
    const provider = badgeLabel(model.badges, 'provider') || model.provider
    const existing = grouped.get(provider)
    if (existing === undefined) grouped.set(provider, [model])
    else existing.push(model)
  }
  return [...grouped.entries()].map(([provider, options]) => ({
    key: `${channel}:${provider}`,
    provider,
    options,
  }))
}

/** Theme menu for one thinking level; native select cannot follow dark chrome. */
function EffortField({ label, value, levels, disabled, t, onChange }: EffortFieldProps) {
  const [open, setOpen] = useState(false)
  const items = [
    { id: UNSET_EFFORT, label: t('workflow.unconfigured') },
    ...levels.map(level => ({ id: level, label: effortLabel(level, t) })),
  ]
  return (
    <div className={css.fieldMenu}>
      <Menu
        open={open && !disabled}
        onClose={() => { setOpen(false) }}
        items={items}
        selectedId={value ?? UNSET_EFFORT}
        onSelect={(id) => {
          setOpen(false)
          onChange(id === UNSET_EFFORT ? null : id)
        }}
        align="end"
        portal
        compact
        anchor={(
          <button
            type="button"
            className={css.field}
            aria-haspopup="menu"
            aria-expanded={open && !disabled}
            aria-label={label}
            disabled={disabled}
            onClick={() => { setOpen(current => !current) }}
          >
            <span className={css.laneCopy}>
              <span className={css.fieldLabel}>{label}</span>
              <span className={css.laneValue}>
                {value === null ? t('workflow.unconfigured') : effortLabel(value, t)}
              </span>
            </span>
            <span className={css.chevron} aria-hidden>
              <IconChevronDownOutline14 />
            </span>
          </button>
        )}
      />
    </div>
  )
}

/** Body-portaled catalog for one lane select. */
function ModelPicker({ anchorRef, value, options, disabled, t, onSelect }: ModelPickerProps) {
  const pickerRef = useRef<HTMLDivElement>(null)
  const position = useAnchoredPosition({
    open: true,
    anchorRef,
    panelRef: pickerRef,
    gap: 4,
    margin: 12,
    side: 'bottom',
  })
  const [channel, setChannel] = useState<PickerChannel>(() => channelOf(options.find(model => model.selector === value)))
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const groups = useMemo(
    () => groupWorkflowModels(options, channel, deferredQuery),
    [channel, deferredQuery, options],
  )
  const hasCursor = options.some(model => channelOf(model) === 'cursor')

  return createPortal((
    <div
      ref={pickerRef}
      className={css.picker}
      style={position ?? { visibility: 'hidden', left: 0, top: 0 }}
      role="dialog"
      aria-label={t('policy.modelPicker')}
      data-model-picker=""
    >
      <div className={css.pickerBar}>
        {hasCursor
          ? (
            <div className={css.channelSwitch} role="group" aria-label={t('policy.channel')}>
              <button
                type="button"
                className={css.channelButton}
                data-channel="default"
                data-active={channel === 'default'}
                aria-pressed={channel === 'default'}
                onClick={() => { setChannel('default') }}
              >
                {t('policy.channel.default')}
              </button>
              <button
                type="button"
                className={css.channelButton}
                data-channel="cursor"
                data-active={channel === 'cursor'}
                aria-pressed={channel === 'cursor'}
                onClick={() => { setChannel('cursor') }}
              >
                {t('policy.channel.cursor')}
              </button>
            </div>
          )
          : null}
        <label className={css.searchBox}>
          <IconSearchOutline16 size={14} />
          <input
            className={css.searchInput}
            value={query}
            disabled={disabled}
            aria-label={t('policy.modelSearch')}
            onChange={(event) => { setQuery(event.currentTarget.value) }}
            placeholder={t('policy.modelSearch')}
          />
        </label>
      </div>
      <div className={css.modelList} role="group" aria-label={t('policy.modelSearch')}>
        <button
          type="button"
          className={css.modelOption}
          aria-pressed={value === null}
          data-selected={value === null}
          disabled={disabled}
          onClick={() => { onSelect(null) }}
        >
          <span className={css.modelCopy}>
            <span className={css.modelTitle}>{t('workflow.unconfigured')}</span>
          </span>
        </button>
        {groups.length === 0
          ? <p className={css.modelEmpty}>{t('policy.modelEmpty')}</p>
          : groups.map(group => (
            <div key={group.key} className={css.modelGroup}>
              <div className={css.modelGroupHeader}>
                <span>{group.provider}</span>
                <span>{group.options.length}</span>
              </div>
              <div className={css.modelGroupBody}>
                {group.options.map(model => (
                  <button
                    key={model.selector}
                    type="button"
                    className={css.modelOption}
                    aria-pressed={model.selector === value}
                    data-model-id={model.selector}
                    data-selected={model.selector === value}
                    disabled={disabled}
                    onClick={() => { onSelect(model.selector) }}
                  >
                    <span className={css.modelCopy}>
                      <span className={css.modelTitle}>{model.label}</span>
                      <span className={css.modelSelector}>{model.selector}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
      </div>
    </div>
  ), document.body)
}

/** Theme select for one lane model; native select cannot follow dark chrome. */
function ModelField({
  lane, label, value, options, disabled, open, t, onToggle, onSelect,
}: ModelFieldProps) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  return (
    <div className={css.fieldMenu}>
      <button
        ref={triggerRef}
        type="button"
        className={css.field}
        data-lane={lane}
        data-picker-open={open}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
        disabled={disabled}
        onClick={onToggle}
      >
        <span className={css.laneCopy}>
          <span className={css.fieldLabel}>{label}</span>
          <span className={css.laneValue}>{modelDisplay(value, options, t)}</span>
        </span>
        <span className={open ? `${css.chevron} ${css.chevronOpen}` : css.chevron} aria-hidden>
          <IconChevronDownOutline14 />
        </span>
      </button>
      {open
        ? (
          <ModelPicker
            anchorRef={triggerRef}
            value={value}
            options={options}
            disabled={disabled}
            t={t}
            onSelect={onSelect}
          />
        )
        : null}
    </div>
  )
}

/** Compact workflow controls docked into the one-line composer region. */
export function WorkflowPolicyDock({
  usePolicy, readPolicy, loadPolicy, ensurePolicy, configure, sessionId, t,
}: WorkflowPolicyDockProps) {
  const workflow = usePolicy(snapshot => snapshot.sessions.get(sessionId))
  const state = workflow ?? {
    status: 'cold' as const,
    error: null,
    policy: {
      sessionId,
      revision: 0,
      enabled: false,
      implementationModel: null,
      implementationThinking: null,
      reviewModel: null,
      reviewThinking: null,
      updatedAt: 0,
      models: [],
    },
  }
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<DraftState>(() => normalizeDraft(state))
  const [openPicker, setOpenPicker] = useState<PickerLane | null>(null)
  const dockRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const panelPosition = useAnchoredPosition({
    open,
    anchorRef: triggerRef,
    panelRef,
    gap: 8,
    margin: 12,
    side: 'top',
  })
  const panelMaxHeight = useAnchoredMaxHeight(panelRef, 480, panelPosition?.top)
  const loading = state.status === 'loading'
  const saving = state.status === 'configuring'
  const models = state.policy.models

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Element)) return
      if (dockRef.current?.contains(target) || panelRef.current?.contains(target)) return
      if (target.closest('[role="menu"]') !== null) return
      if (target.closest('[data-model-picker]') !== null) return
      setOpen(false)
      setOpenPicker(null)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setOpen(false)
      setOpenPicker(null)
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  useEffect(() => {
    if (openPicker === null) return
    const closePicker = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Element)) return
      if (target.closest('[data-model-picker]') !== null) return
      if (target.closest('[data-lane]') !== null) return
      setOpenPicker(null)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpenPicker(null)
    }
    document.addEventListener('pointerdown', closePicker)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', closePicker)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [openPicker])

  useEffect(() => {
    void loadPolicy()
  }, [loadPolicy])

  useEffect(() => {
    setDraft(normalizeDraft(state))
  }, [
    state.policy.enabled,
    state.policy.implementationModel,
    state.policy.implementationThinking,
    state.policy.reviewModel,
    state.policy.reviewThinking,
  ])

  const implementationLevels = useMemo(
    () => thinkingLevels(models, draft.implementationModel),
    [draft.implementationModel, models],
  )
  const reviewLevels = useMemo(
    () => thinkingLevels(models, draft.reviewModel),
    [draft.reviewModel, models],
  )
  const dirty = !equalDraft(draft, normalizeDraft(state))

  const syncForToggle = async (enabled: boolean): Promise<void> => {
    const needsEnsure = models.length === 0
    const baseline = needsEnsure ? await ensurePolicy() : OK_RESULT
    if (!baseline.ok) return
    const next = needsEnsure ? readPolicy() : (workflow ?? state)
    const current = next.policy
    void configure({
      sessionId,
      enabled,
      implementationModel: current.implementationModel,
      implementationThinking: current.implementationThinking,
      reviewModel: current.reviewModel,
      reviewThinking: current.reviewThinking,
    })
  }

  const toggle = (): void => {
    void syncForToggle(!state.policy.enabled)
  }

  const openSettings = (): void => {
    setOpen(true)
    void ensurePolicy()
  }

  const save = (): void => {
    void configure({
      sessionId,
      enabled: draft.enabled,
      implementationModel: draft.implementationModel,
      implementationThinking: draft.implementationThinking,
      reviewModel: draft.reviewModel,
      reviewThinking: draft.reviewThinking,
    }).then((result) => {
      if (result.ok) {
        setOpen(false)
        setOpenPicker(null)
      }
    })
  }

  const selectLane = (lane: PickerLane, selector: string | null): void => {
    const levels = thinkingLevels(models, selector)
    if (lane === 'implementation') {
      setDraft(current => ({
        ...current,
        implementationModel: selector,
        implementationThinking: levels.includes(current.implementationThinking ?? '')
          ? current.implementationThinking
          : preferredEffort(levels, 'high'),
      }))
    } else {
      setDraft(current => ({
        ...current,
        reviewModel: selector,
        reviewThinking: levels.includes(current.reviewThinking ?? '')
          ? current.reviewThinking
          : preferredEffort(levels, 'xhigh'),
      }))
    }
    setOpenPicker(null)
  }

  const panel = open
    ? (
      <div
        className={css.panel}
        ref={panelRef}
        data-workflow-panel=""
        style={{
          ...(panelPosition ?? { visibility: 'hidden', left: 0, top: 0 }),
          maxHeight: panelMaxHeight,
        }}
        role="dialog"
        aria-label={t('policy.title')}
      >
        <div className={css.panelHeader}>
          <div>
            <h3 className={css.title}>{t('policy.title')}</h3>
            <p className={css.subtitle}>{t('policy.nextOnly')}</p>
          </div>
          <div className={css.panelTools}>
            <button
              type="button"
              className={css.toggle}
              data-enabled={state.policy.enabled}
              aria-pressed={state.policy.enabled}
              aria-label={t(state.policy.enabled ? 'workflow.disable' : 'workflow.enable')}
              disabled={loading || saving}
              onClick={toggle}
            >
              <span className={css.pill} aria-hidden="true" />
              <span>{state.policy.enabled ? t('workflow.on') : t('workflow.off')}</span>
            </button>
            <button
              type="button"
              className={css.close}
              aria-label={t('policy.close')}
              onClick={() => { setOpen(false); setOpenPicker(null) }}
            >
              <IconCloseOutline16 size={16} />
            </button>
          </div>
        </div>

        <div className={css.body}>
          <ModelField
            lane="implementation"
            label={t('policy.implementationModel')}
            value={draft.implementationModel}
            options={models}
            disabled={saving || models.length === 0}
            open={openPicker === 'implementation'}
            t={t}
            onToggle={() => { setOpenPicker(current => current === 'implementation' ? null : 'implementation') }}
            onSelect={(selector) => { selectLane('implementation', selector) }}
          />

          <EffortField
            label={t('policy.implementationThinking')}
            value={draft.implementationThinking}
            levels={implementationLevels}
            disabled={saving || implementationLevels.length === 0}
            t={t}
            onChange={(implementationThinking) => {
              setDraft(current => ({ ...current, implementationThinking }))
            }}
          />

          <ModelField
            lane="review"
            label={t('policy.reviewModel')}
            value={draft.reviewModel}
            options={models}
            disabled={saving || models.length === 0}
            open={openPicker === 'review'}
            t={t}
            onToggle={() => { setOpenPicker(current => current === 'review' ? null : 'review') }}
            onSelect={(selector) => { selectLane('review', selector) }}
          />

          <EffortField
            label={t('policy.reviewThinking')}
            value={draft.reviewThinking}
            levels={reviewLevels}
            disabled={saving || reviewLevels.length === 0}
            t={t}
            onChange={(reviewThinking) => {
              setDraft(current => ({ ...current, reviewThinking }))
            }}
          />
        </div>

        {state.error === null ? null : <div className={css.error} role="alert">{state.error}</div>}

        <div className={css.footer}>
          <span className={css.note}>{t('policy.note')}</span>
          <div className={css.actions}>
            <button
              type="button"
              className={css.apply}
              disabled={saving || loading || !dirty}
              onClick={save}
            >
              {saving ? t('policy.saving') : t('policy.save')}
            </button>
          </div>
        </div>
      </div>
    )
    : null

  return (
    <div className={css.dock} ref={dockRef} data-workflow-dock="">
      <button
        ref={triggerRef}
        type="button"
        className={css.trigger}
        data-enabled={state.policy.enabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t('workflow.settings')}
        disabled={saving}
        onClick={open ? () => { setOpen(false); setOpenPicker(null) } : openSettings}
      >
        <span className={css.triggerLabel}>{t('workflow.label')}</span>
        <span className={css.triggerStatus}>{state.policy.enabled ? t('workflow.on') : t('workflow.off')}</span>
        <span className={open ? `${css.chevron} ${css.chevronOpen}` : css.chevron} aria-hidden>
          <IconChevronDownOutline14 />
        </span>
      </button>
      {panel === null ? null : createPortal(panel, document.body)}
    </div>
  )
}

function modelDisplay(
  selector: string | null,
  models: readonly ReliabilityModelOption[],
  t: WorkflowPolicyDockProps['t'],
): string {
  if (selector === null) return t('workflow.unconfigured')
  return models.find(model => model.selector === selector)?.label ?? selector
}

export type { ReliabilityPolicyRemote }
