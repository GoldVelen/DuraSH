/**
 * One live loop's owner. The driver is the only writer of its loop's durable
 * record: it starts each stage's workflow run, derives the next stage from
 * the settled run, and writes exactly one record per transition. It owns no
 * timers and no global listeners — after `result` settles and the last run is
 * disposed, the loop writes nothing and owns nothing.
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
  ImplementAttempt, LoopRound, ReliabilityLoopId, ReliabilityLoopRecord, ReviewAttempt, RuntimeAcceptanceGate, RuntimeAcceptanceStatus,
} from './types.ts'

/** Render a thrown value without trusting it. */
function renderThrown(error: unknown): string {
  try {
    return String(error)
  } catch {
    /* v8 ignore next -- String() on the caught value itself is the unrenderable case */
    return '[unrenderable thrown value]'
  }
}

/** The fixed stage descriptions carried by each run's meta block. */
const STAGE_DESCRIPTIONS: Record<'implement' | 'review', string> = {
  implement: 'DuraSH reliability loop implementation stage',
  review: 'DuraSH reliability loop review stage',
}

/**
 * One loop's live owner: the only writer of its record, from the first stage
 * run through durable terminal settlement and run disposal.
 */
export class LoopDriver {
  /** The loop's id. */
  readonly loopId: ReliabilityLoopId

  /**
   * Settles once the record is terminal and the last run's resources are
   * released. Rejects only when the durable record cannot be maintained.
   */
  readonly result: Promise<ReliabilityLoopRecord>

  private settleResolve!: (record: ReliabilityLoopRecord) => void
  private settleReject!: (error: unknown) => void
  private settled = false
  private readonly acceptanceCancellation = new AbortController()
  private cancelRequested = false
  private cancelReason: string | undefined
  private currentRun: WorkflowRun | undefined
  private disposePromise: Promise<void> | undefined
  private acceptanceStatus: RuntimeAcceptanceStatus | undefined

  constructor(
    private readonly engine: WorkflowEngine,
    private readonly table: KvTable<ReliabilityLoopId, ReliabilityLoopRecord>,
    private readonly parent: Agent,
    private readonly maxHandoffChars: number,
    loopId: ReliabilityLoopId,
    private readonly acceptance?: RuntimeAcceptanceGate,
  ) {
    this.loopId = loopId
    this.result = new Promise<ReliabilityLoopRecord>((resolve, reject) => {
      this.settleResolve = resolve
      this.settleReject = reject
    })
  }

  /**
   * Request cancellation. Idempotent; the first reason wins. A stage that
   * already settled is kept; an in-flight one is cancelled through the run.
   * @param reason - human-readable cause (default `'reliability loop cancelled'`).
   */
  cancel(reason?: string): void {
    if (this.cancelRequested) return
    this.cancelRequested = true
    this.acceptanceCancellation.abort(reason)
    this.cancelReason = reason ?? 'reliability loop cancelled'
    this.currentRun?.cancel(this.cancelReason)
  }

  /**
   * Cancel if needed and await durable settlement plus resource quiescence.
   * Never rejects; idempotent.
   */
  async dispose(): Promise<void> {
    this.disposePromise ??= (async () => {
      if (!this.settled) this.cancel()
      await this.result.catch(() => { /* the storage fault already rejected `result`; disposal stays successful */ })
    })()
    return this.disposePromise
  }

  /** Drive the stage machine to terminal settlement; never throws. */
  async drive(): Promise<void> {
    try {
      await this.driveStages()
    } catch (error) {
      // A durable-seam or invariant fault: no terminal record can be
      // maintained, so the caller learns through `result` rejecting.
      this.settled = true
      this.settleReject(error)
      return
    }
    const record = this.requireRecord()
    /* v8 ignore start -- driveStages returns only after a terminal write or cancellation */
    if (!isTerminalStage(record.stage)) {
      this.settled = true
      this.settleReject(new Error(`loop '${this.loopId}' stopped in non-terminal stage '${record.stage}'`))
      return
    }
    /* v8 ignore stop */
    this.settled = true
    this.settleResolve(record)
  }

  /** Run stages until terminal or cancelled; a cancelled unsettled loop stops `cancelled`. */
  private async driveStages(): Promise<void> {
    for (;;) {
      const record = this.requireRecord()
      if (this.cancelRequested) {
        if (!isTerminalStage(record.stage)) await this.writeRecord({ ...record, stage: 'cancelled', settledAt: new Date().toISOString() })
        return
      }
      if (isTerminalStage(record.stage)) return
      switch (record.stage) {
        case 'implementing': await this.runStage('implement', 1); break
        case 'reviewing': await this.runStage('review', 1); break
        case 'rework-implementing': await this.runStage('implement', 2); break
        case 'rework-reviewing': await this.runStage('review', 2); break
        /* v8 ignore start -- terminal stages returned above; a future variant fails loudly */
        default: {
          const exhaustive: never = record.stage
          throw new Error(`loop '${this.loopId}': unknown stage '${String(exhaustive)}'`)
        }
        /* v8 ignore stop */
      }
    }
  }

  /** Execute one stage: start its run, await settlement, dispose, apply the transition. */
  private async runStage(kind: 'implement' | 'review', round: LoopRound): Promise<void> {
    const record = this.requireRecord()
    let run: WorkflowRun
    try {
      const request = this.stageRequest(kind, round, record)
      if (record.acceptanceTaskId !== undefined) {
        if (this.acceptance === undefined) throw new Error('Acceptance evidence is unverified: acceptance service unavailable')
        if (kind === 'review') {
          this.acceptanceStatus = await this.acceptance.inspect(record.acceptanceTaskId, this.acceptanceCancellation.signal)
          request.prompt += `\n\nCandidate: ${this.acceptanceStatus.candidateKey}\n${this.acceptanceStatus.index}`
        }
        request.prompt += `\n\nAcceptance task: ${record.acceptanceTaskId}. Use dsh_acceptance status for this task to open the original diff, execution records, and attachments. Required checks cannot be replaced by summaries.`
        if (request.prompt.length > this.maxHandoffChars) {
          throw new Error(`complete ${kind} prompt exceeds the ${this.maxHandoffChars} handoff bound; use a smaller evidence index`)
        }
      }
      if (this.cancelRequested) return
      run = this.engine.start({
        script: request.script,
        meta: { name: request.metaName, description: STAGE_DESCRIPTIONS[kind] },
        args: {
          prompt: request.prompt,
          label: kind,
          ...request.provider === undefined ? {} : { provider: request.provider },
          ...request.model === undefined ? {} : { model: request.model },
        },
        parent: this.parent,
      })
    } catch (error) {
      if (this.cancelRequested) return
      await this.writeRecord({ ...this.requireRecord(), stage: 'failed', settledAt: new Date().toISOString(), error: `${kind} stage run could not start: ${renderThrown(error)}` })
      return
    }
    this.currentRun = run
    let result: WorkflowResult
    try {
      result = await run.result
    } finally {
      this.currentRun = undefined
      // The run is owned here on every path, including the ones below that
      // stop the loop: disposal awaits script and child quiescence.
      await run.dispose()
    }
    await this.applySettled(kind, round, result)
  }

  /** Map one settled run to its durable transition. */
  private async applySettled(kind: 'implement' | 'review', round: LoopRound, result: WorkflowResult): Promise<void> {
    if (this.cancelRequested) return
    switch (result.stopReason) {
      case 'completed': {
        const record = this.requireRecord()
        let report: ImplementReport | ReviewReport
        try {
          report = kind === 'implement'
            ? validateImplementReport(result.value, this.maxHandoffChars)
            : validateReviewReport(result.value, this.maxHandoffChars)
        } catch (error) {
          // Invalid or oversized reports fail the stage loud instead of being
          // truncated or handed to the next stage. A storage fault below is
          // NOT this case: it propagates and rejects `result`.
          await this.writeRecord({ ...record, stage: 'failed', settledAt: new Date().toISOString(), error: renderThrown(error) })
          return
        }
        await this.applyReport(record, kind, round, report, result.agentsStarted)
        return
      }
      case 'cancelled':
        await this.writeRecord({
          ...this.requireRecord(),
          stage: 'failed',
          settledAt: new Date().toISOString(),
          error: `${kind} stage run settled cancelled without a local cancel request${result.error === undefined ? '' : `: ${result.error}`}`,
        })
        return
      case 'error':
        await this.writeRecord({ ...this.requireRecord(), stage: 'failed', settledAt: new Date().toISOString(), error: result.error ?? `${kind} stage run failed` })
        return
      /* v8 ignore start -- WorkflowStopReason is a closed union; a future variant fails loudly */
      default: {
        const exhaustive: never = result.stopReason
        await this.writeRecord({ ...this.requireRecord(), stage: 'failed', settledAt: new Date().toISOString(), error: `${kind} stage run ended abnormally (${String(exhaustive)})` })
      }
      /* v8 ignore stop */
    }
  }

  /** Write the transition one validated stage report implies. */
  private async applyReport(
    record: ReliabilityLoopRecord,
    kind: 'implement' | 'review',
    round: LoopRound,
    report: ImplementReport | ReviewReport,
    agentsStarted: number,
  ): Promise<void> {
    if (kind === 'implement') {
      const { summary } = report as ImplementReport
      const implement: ImplementAttempt = { round, summary, agentsStarted }
      await this.writeRecord({ ...record, implement, stage: round === 1 ? 'reviewing' : 'rework-reviewing' })
      return
    }
    const modelReport = report as ReviewReport
    let { verdict, feedback } = modelReport
    if (record.acceptanceTaskId !== undefined) {
      try {
        if (this.acceptance === undefined || this.acceptanceStatus === undefined) {
          throw new Error('Acceptance evidence is unverified: no reviewed candidate')
        }
        const reviewedCandidate = this.acceptanceStatus.candidateKey
        this.acceptanceStatus = await this.acceptance.review(
          record.acceptanceTaskId, verdict, feedback, reviewedCandidate, this.acceptanceCancellation.signal,
        )
        if (this.acceptanceStatus.candidateKey !== reviewedCandidate) {
          this.acceptanceStatus = {
            ...this.acceptanceStatus, checksPassed: false,
            reasons: [...this.acceptanceStatus.reasons, 'Candidate identity changed during independent review'],
          }
        }
      } catch (error) {
        if (this.cancelRequested) return
        await this.writeRecord({ ...record, stage: 'failed', settledAt: new Date().toISOString(), error: `Acceptance evidence is unverified: ${renderThrown(error)}` })
        return
      }
      if (this.cancelRequested) return
      if (!this.acceptanceStatus.checksPassed) {
        verdict = 'changes-requested'
        feedback = `Host required checks rejected acceptance: ${this.acceptanceStatus.reasons.join('; ')}\nModel review: ${feedback}`.slice(0, this.maxHandoffChars)
      }
    }
    const review: ReviewAttempt = {
      round, verdict, feedback, agentsStarted,
      ...record.acceptanceTaskId === undefined ? {} : { modelVerdict: modelReport.verdict },
    }
    if (verdict === 'approved') {
      await this.writeRecord({ ...record, review, stage: 'completed', settledAt: new Date().toISOString() })
      return
    }
    if (round === 1) {
      await this.writeRecord({ ...record, review, stage: 'rework-implementing' })
      return
    }
    // The single bounded rework still drew changes-requested: stop with the
    // reviewer's feedback as the durable blocker.
    await this.writeRecord({ ...record, review, stage: 'blocked', diagnostic: this.diagnostic(record, feedback), settledAt: new Date().toISOString() })
  }

  /** Bounded handoff after the single rework; model claims remain attributed. */
  private diagnostic(record: ReliabilityLoopRecord, feedback: string): string {
    const sections: [string, string][] = [
      ['Original requirement', record.objective],
      ['Candidate', this.acceptanceStatus?.candidateKey ?? 'Unknown: no acceptance identity recorded'],
      ['Confirmed facts', this.acceptanceStatus === undefined ? 'Two implementation and review rounds settled' : `Required checks passed: ${String(this.acceptanceStatus.checksPassed)}`],
      ['Unconfirmed hypotheses', 'Unknown: no environmental cause independently established'],
      ['Failure evidence', this.acceptanceStatus?.index ?? 'Unknown: no execution evidence index recorded'],
      ['Attempted actions (implementer report)', record.implement?.summary ?? 'Unknown'],
      ['Question for next reviewer', feedback],
    ]
    const overhead = sections.map(([label]) => `${label}: \n`).join('').length
    const share = Math.max(0, Math.floor((this.maxHandoffChars - overhead) / sections.length))
    return sections.map(([label, value]) => `${label}: ${value.slice(0, share)}`).join('\n').slice(0, this.maxHandoffChars)
  }

  /** Build one stage's fixed script, meta name, and prompt from the durable record alone. */
  private stageRequest(
    kind: 'implement' | 'review',
    round: LoopRound,
    record: ReliabilityLoopRecord,
  ): { script: string; metaName: string; prompt: string; provider?: string; model?: string } {
    const lane = kind === 'implement'
      ? { provider: record.implementationProvider, model: record.implementationModel }
      : { provider: record.reviewProvider, model: record.reviewModel }
    const route = {
      ...lane.provider === undefined ? {} : { provider: lane.provider },
      ...lane.model === undefined ? {} : { model: lane.model },
    }
    if (kind === 'implement') {
      if (round === 1) {
        return { script: IMPLEMENT_SCRIPT, metaName: IMPLEMENT_META_NAME, prompt: implementPrompt(record.objective), ...route }
      }
      /* v8 ignore next -- the record invariant guarantees a round-1 changes-requested review for a rework stage */
      const feedback = record.review?.feedback ?? ''
      return {
        script: IMPLEMENT_SCRIPT,
        metaName: IMPLEMENT_META_NAME,
        prompt: implementReworkPrompt(record.objective, feedback),
        ...route,
      }
    }
    /* v8 ignore next -- the record invariant guarantees a settled implementation for a review stage */
    const summary = record.implement?.summary ?? ''
    if (round === 1) {
      return { script: REVIEW_SCRIPT, metaName: REVIEW_META_NAME, prompt: reviewPrompt(record.objective, summary), ...route }
    }
    /* v8 ignore next -- the record invariant guarantees the round-1 changes-requested feedback */
    const priorFeedback = record.review?.feedback ?? ''
    return {
      script: REVIEW_SCRIPT,
      metaName: REVIEW_META_NAME,
      prompt: reworkReviewPrompt(record.objective, summary, priorFeedback),
      ...route,
    }
  }

  /** Read this loop's record, asserting the owned stage/slot relationships. */
  private requireRecord(): ReliabilityLoopRecord {
    const record = this.table.get(this.loopId)
    if (record === undefined) throw new Error(`loop '${this.loopId}' record is absent from the durable store`)
    assertReliabilityLoopRecord(record)
    return record
  }

  /** Write one record, asserting the same relationships at the write site. */
  private async writeRecord(record: ReliabilityLoopRecord): Promise<void> {
    assertReliabilityLoopRecord(record)
    await this.table.put(record.loopId, record)
  }
}
