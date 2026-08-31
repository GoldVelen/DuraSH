/**
 * One background reliability loop's single live writer.
 * @module @durash/dsh-reliability-loop/src/driver
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { WorkflowEngine, WorkflowResult, WorkflowRun } from '@deepseek-ai/dsh-workflow'
import { assertReliabilityLoopRecord } from './checks.ts'
import {
  IMPLEMENT_META_NAME,
  IMPLEMENT_SCRIPT,
  REVIEW_META_NAME,
  REVIEW_SCRIPT,
  implementPrompt,
  implementReworkPrompt,
  reworkReviewPrompt,
  reviewPrompt,
  validateImplementReport,
  validateReviewReport,
} from './scripts.ts'
import type { ImplementReport, ReviewReport } from './scripts.ts'
import { isTerminalStage } from './types.ts'
import type {
  ImplementAttempt,
  LoopRound,
  ReliabilityLoopId,
  ReliabilityLoopLane,
  ReliabilityLoopRecord,
  ReliabilityLoopRoundRecord,
  ReviewAttempt,
} from './types.ts'

/** Driver settlement after every current workflow resource is quiescent. */
export type LoopDriverOutcome =
  | { readonly kind: 'terminal'; readonly record: ReliabilityLoopRecord }
  | { readonly kind: 'suspended'; readonly record: ReliabilityLoopRecord }

type StopMode = 'cancel' | 'suspend'

/** Render a thrown value without trusting its coercion. */
function renderThrown(error: unknown): string {
  try {
    return String(error)
  } catch {
    /* v8 ignore next -- String() on the caught value itself is the unrenderable case. */
    return '[unrenderable thrown value]'
  }
}

const STAGE_DESCRIPTIONS: Record<'implement' | 'review', string> = {
  implement: 'DuraSH reliability loop implementation stage',
  review: 'DuraSH reliability loop review stage',
}

/** One loop's single writer from `accepted` to terminal or Host suspension. */
export class LoopDriver {
  /** Owned loop identity. */
  readonly loopId: ReliabilityLoopId

  /** Settles after terminal or suspended state and run disposal; rejects only when durable state cannot be maintained. */
  readonly result: Promise<LoopDriverOutcome>

  private resolveResult!: (outcome: LoopDriverOutcome) => void
  private rejectResult!: (error: unknown) => void
  private finished = false
  private stopMode: StopMode | undefined
  private stopReason: string | undefined
  private currentRun: WorkflowRun | undefined

  /**
   * @param engine - workflow capability used for each bounded stage.
   * @param table - sole durable loop table.
   * @param parent - root Agent that owns child composition.
   * @param maxHandoffChars - objective, report, and durable error bound.
   * @param loopId - exact record identity.
   * @param onCommit - best-effort derived-state publisher after each successful domain write.
   */
  constructor(
    private readonly engine: WorkflowEngine,
    private readonly table: KvTable<ReliabilityLoopId, ReliabilityLoopRecord>,
    private readonly parent: Agent,
    private readonly maxHandoffChars: number,
    loopId: ReliabilityLoopId,
    private readonly onCommit: (record: ReliabilityLoopRecord) => void | Promise<void> = () => {},
  ) {
    this.loopId = loopId
    this.result = new Promise<LoopDriverOutcome>((resolve, reject) => {
      this.resolveResult = resolve
      this.rejectResult = reject
    })
  }

  /**
   * Explicit user cancellation. It overrides a concurrent Host suspension,
   * cancels the current stage, and eventually writes one `cancelled` terminal.
   * @param reason - cancellation reason forwarded to the workflow run.
   */
  cancel(reason = 'reliability loop cancelled by user'): void {
    if (this.finished || this.stopMode === 'cancel') return
    this.stopMode = 'cancel'
    this.stopReason = reason
    this.currentRun?.cancel(reason)
  }

  /**
   * Stop process-local work without changing the durable non-terminal stage.
   * @param reason - shutdown reason forwarded to the workflow run.
   */
  suspend(reason = 'reliability loop host suspended'): void {
    if (this.finished || this.stopMode !== undefined) return
    this.stopMode = 'suspend'
    this.stopReason = reason
    this.currentRun?.cancel(reason)
  }

  /** Request suspension and wait for all current stage resources to quiesce. */
  async dispose(): Promise<void> {
    this.suspend()
    await this.result.catch(() => { /* the observing runtime reports the storage fault */ })
  }

  /** Drive until terminal or suspended; all failures are observed here. */
  async drive(): Promise<void> {
    try {
      await this.driveStages()
      this.finishFromRecord()
    } catch (error) {
      try {
        const record = this.requireRecord()
        if (!isTerminalStage(record.stage) && this.stopMode === undefined) {
          await this.fail(record, `reliability loop driver failed: ${renderThrown(error)}`)
        }
        if (this.stopMode !== undefined && !isTerminalStage(this.requireRecord().stage)) {
          await this.settleRequestedStop()
        }
        this.finishFromRecord()
      } catch (storageError) {
        this.finished = true
        this.rejectResult(storageError)
      }
    }
  }

  /** Advance the durable stage machine until it reaches a process stop. */
  private async driveStages(): Promise<void> {
    for (;;) {
      const record = this.requireRecord()
      if (isTerminalStage(record.stage)) return
      if (this.stopMode !== undefined) {
        await this.settleRequestedStop()
        return
      }
      switch (record.stage) {
        case 'accepted':
          await this.transition(record, { stage: 'implementing' })
          break
        case 'implementing':
          await this.runStage('implement', 1)
          break
        case 'reviewing':
          await this.runStage('review', 1)
          break
        case 'rework-implementing':
          await this.runStage('implement', 2)
          break
        case 'rework-reviewing':
          await this.runStage('review', 2)
          break
        /* v8 ignore start -- terminal variants returned above; future variants fail loudly. */
        default:
          throw new Error(`loop '${this.loopId}': unknown stage '${String(record.stage satisfies never)}'`)
        /* v8 ignore stop */
      }
    }
  }

  /** Materialize the requested process stop after the current run is gone. */
  private async settleRequestedStop(): Promise<void> {
    const record = this.requireRecord()
    if (isTerminalStage(record.stage) || this.stopMode === 'suspend') return
    await this.transition(record, { stage: 'cancelled', settledAt: this.nextInstant(record) })
  }

  /** Execute one workflow stage and map its settlement into the durable record. */
  private async runStage(kind: 'implement' | 'review', round: LoopRound): Promise<void> {
    const record = this.requireRecord()
    const request = this.stageRequest(kind, round, record)
    let run: WorkflowRun
    try {
      run = this.engine.start({
        script: request.script,
        meta: { name: request.metaName, description: STAGE_DESCRIPTIONS[kind] },
        args: {
          prompt: request.prompt,
          label: kind,
          provider: request.lane.provider,
          model: request.lane.model,
          ...request.lane.reasoningEffort === undefined
            ? {}
            : { reasoningEffort: request.lane.reasoningEffort },
        },
        parent: this.parent,
      })
    } catch (error) {
      if (this.stopMode === undefined) {
        await this.fail(this.requireRecord(), `${kind} stage run could not start: ${renderThrown(error)}`)
      }
      return
    }
    this.currentRun = run
    if (this.stopMode !== undefined) run.cancel(this.stopReason)
    let result: WorkflowResult | undefined
    let rejected: unknown
    try {
      result = await run.result
    } catch (error) {
      rejected = error
    } finally {
      this.currentRun = undefined
      try {
        await run.dispose()
      } catch (error) {
        rejected ??= error
      }
    }
    if (rejected !== undefined) {
      if (this.stopMode === undefined) {
        await this.fail(this.requireRecord(), `${kind} stage run rejected: ${renderThrown(rejected)}`)
      }
      return
    }
    /* v8 ignore next -- the run either resolved a result or recorded a rejection above. */
    await this.applySettled(kind, round, result as WorkflowResult)
  }

  /** Map one settled workflow result to a durable transition. */
  private async applySettled(kind: 'implement' | 'review', round: LoopRound, result: WorkflowResult): Promise<void> {
    if (result.stopReason === 'completed') {
      let report: ImplementReport | ReviewReport
      try {
        report = kind === 'implement'
          ? validateImplementReport(result.value, this.maxHandoffChars)
          : validateReviewReport(result.value, this.maxHandoffChars)
      } catch (error) {
        await this.fail(this.requireRecord(), renderThrown(error))
        return
      }
      await this.applyReport(this.requireRecord(), kind, round, report, result.agentsStarted)
      return
    }
    if (this.stopMode !== undefined) return
    switch (result.stopReason) {
      case 'cancelled':
        await this.fail(
          this.requireRecord(),
          `${kind} stage run settled cancelled without a local stop request${result.error === undefined ? '' : `: ${result.error}`}`,
        )
        return
      case 'error':
        await this.fail(this.requireRecord(), result.error ?? `${kind} stage run failed`)
        return
      /* v8 ignore start -- WorkflowStopReason is closed; future variants become a durable failure. */
      default:
        await this.fail(this.requireRecord(), `${kind} stage run ended abnormally (${String(result.stopReason satisfies never)})`)
      /* v8 ignore stop */
    }
  }

  /** Persist one validated report without replacing a prior round. */
  private async applyReport(
    record: ReliabilityLoopRecord,
    kind: 'implement' | 'review',
    round: LoopRound,
    report: ImplementReport | ReviewReport,
    agentsStarted: number,
  ): Promise<void> {
    if (kind === 'implement') {
      const implementation: ImplementAttempt = {
        round,
        summary: (report as ImplementReport).summary,
        agentsStarted,
      }
      await this.transition(record, {
        rounds: replaceRound(record.rounds, round, { implementation }),
        stage: round === 1 ? 'reviewing' : 'rework-reviewing',
      })
      return
    }
    const { verdict, feedback } = report as ReviewReport
    const review: ReviewAttempt = { round, verdict, feedback, agentsStarted }
    const rounds = replaceRound(record.rounds, round, { review })
    if (verdict === 'approved') {
      await this.transition(record, { rounds, stage: 'completed', settledAt: this.nextInstant(record) })
      return
    }
    if (round === 1) {
      await this.transition(record, { rounds, stage: 'rework-implementing' })
      return
    }
    await this.transition(record, { rounds, stage: 'blocked', settledAt: this.nextInstant(record) })
  }

  /** Build a workflow request exclusively from the durable record. */
  private stageRequest(
    kind: 'implement' | 'review',
    round: LoopRound,
    record: ReliabilityLoopRecord,
  ): { script: string; metaName: string; prompt: string; lane: ReliabilityLoopLane } {
    if (kind === 'implement') {
      const prompt = round === 1
        ? implementPrompt(record.objective)
        : implementReworkPrompt(record.objective, record.rounds[0]?.review?.feedback ?? '')
      return { script: IMPLEMENT_SCRIPT, metaName: IMPLEMENT_META_NAME, prompt, lane: record.implementation }
    }
    const current = record.rounds[round - 1]?.implementation?.summary ?? ''
    const prompt = round === 1
      ? reviewPrompt(record.objective, current)
      : reworkReviewPrompt(record.objective, current, record.rounds[0]?.review?.feedback ?? '')
    return { script: REVIEW_SCRIPT, metaName: REVIEW_META_NAME, prompt, lane: record.review }
  }

  /** Persist a bounded `failed` terminal. */
  private async fail(record: ReliabilityLoopRecord, error: string): Promise<void> {
    if (isTerminalStage(record.stage)) return
    await this.transition(record, {
      stage: 'failed',
      settledAt: this.nextInstant(record),
      error: bound(error, this.maxHandoffChars),
    })
  }

  /** Create and persist the next revision. */
  private async transition(
    record: ReliabilityLoopRecord,
    patch: Partial<Omit<ReliabilityLoopRecord, 'loopId' | 'sessionId' | 'objective' | 'implementation' | 'review' | 'createdAt'>>,
  ): Promise<ReliabilityLoopRecord> {
    const next: ReliabilityLoopRecord = {
      ...record,
      ...patch,
      revision: record.revision + 1,
      updatedAt: this.nextInstant(record),
    }
    await this.writeRecord(next)
    return next
  }

  /** Read and validate the current durable record. */
  private requireRecord(): ReliabilityLoopRecord {
    const record = this.table.get(this.loopId)
    if (record === undefined) throw new Error(`loop '${this.loopId}' record is absent from the durable store`)
    assertReliabilityLoopRecord(record)
    return record
  }

  /** Commit the authoritative record, then best-effort publish its derived view. */
  private async writeRecord(record: ReliabilityLoopRecord): Promise<void> {
    assertReliabilityLoopRecord(record)
    await this.table.put(record.loopId, record)
    await Promise.resolve(this.onCommit(record)).catch(() => {
      // The domain commit already succeeded. Agent recreation reconciles a
      // missing Session projection; a derived-publish failure cannot roll back
      // or stop the authoritative workflow.
    })
  }

  /** Monotonic ISO instant for the next mutation. */
  private nextInstant(record: ReliabilityLoopRecord): string {
    return new Date(Math.max(Date.now(), Date.parse(record.updatedAt))).toISOString()
  }

  /** Resolve the public result exactly once from the current record. */
  private finishFromRecord(): void {
    if (this.finished) return
    const record = this.requireRecord()
    if (!isTerminalStage(record.stage) && this.stopMode !== 'suspend') {
      throw new Error(`loop '${this.loopId}' stopped in non-terminal stage '${record.stage}'`)
    }
    this.finished = true
    this.resolveResult(isTerminalStage(record.stage)
      ? { kind: 'terminal', record }
      : { kind: 'suspended', record })
  }
}

/** Replace one round slot while retaining the other pass. */
function replaceRound(
  rounds: readonly ReliabilityLoopRoundRecord[],
  round: LoopRound,
  patch: Pick<ReliabilityLoopRoundRecord, 'implementation' | 'review'>,
): readonly ReliabilityLoopRoundRecord[] {
  const next = rounds.map(item => ({ ...item }))
  const index = round - 1
  const current = next[index] ?? { round }
  next[index] = { ...current, ...patch }
  return next
}

/** Bound a durable error while leaving the raw workflow/session evidence intact. */
function bound(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max)
}
