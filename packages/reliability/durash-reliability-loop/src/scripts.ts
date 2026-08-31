/**
 * The fixed stage scripts, prompt builders, and report validation. The scripts
 * are deployment-owned policy (the caller supplies data only, as in the
 * workflow tool contract); every artifact crossing a stage boundary is bounded
 * and an invalid or oversized report fails the stage loud instead of being
 * truncated or accumulated into the next stage.
 * @module @durash/dsh-reliability-loop/src/scripts
 */

import type { ReviewVerdict } from './types.ts'

/**
 * The implementation stage body: one fresh child produces a structured work
 * summary. A failed child (null) kills the run loud — the loop cannot review
 * work that never happened.
 */
export const IMPLEMENT_SCRIPT = `
const report = await agent(args.prompt, {
  label: args.label,
  schema: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] },
  ...(typeof args.provider === 'string' ? { provider: args.provider } : {}),
  ...(typeof args.model === 'string' ? { model: args.model } : {}),
})
if (report === null) throw new Error('implementation child failed')
return report
`

/**
 * The review stage body: one fresh child reviews the implementation summary
 * and returns a structured verdict. The child receives only the bounded
 * handoff below, never the parent conversation or prior stage transcripts.
 */
export const REVIEW_SCRIPT = `
const report = await agent(args.prompt, {
  label: args.label,
  schema: {
    type: 'object',
    properties: {
      verdict: { type: 'string', enum: ['approved', 'changes-requested'] },
      feedback: { type: 'string' },
    },
    required: ['verdict', 'feedback'],
  },
  ...(typeof args.provider === 'string' ? { provider: args.provider } : {}),
  ...(typeof args.model === 'string' ? { model: args.model } : {}),
})
if (report === null) throw new Error('review child failed')
return report
`

/** The implement stage's fixed meta name. */
export const IMPLEMENT_META_NAME = 'durash-reliability-implement'
/** The review stage's fixed meta name. */
export const REVIEW_META_NAME = 'durash-reliability-review'

/** The implementation stage's report (the run's validated return value). */
export interface ImplementReport {
  /** The work summary the child reported. */
  summary: string
}

/** The review stage's report (the run's validated return value). */
export interface ReviewReport {
  /** The reviewer's decision. */
  verdict: ReviewVerdict
  /** The reviewer's evidence. */
  feedback: string
}

/** A stage report that violates the loop's own semantics (distinct from the engine's schema validation). */
export class StageReportError extends Error {
  /**
   * @param stage - the stage whose report was rejected.
   * @param problem - what the report violated.
   */
  constructor(stage: 'implement' | 'review', problem: string) {
    super(`${stage} stage report rejected: ${problem}`)
    this.name = 'StageReportError'
  }
}

/**
 * Compose the round-1 implementation prompt: the objective alone.
 * @param objective - the caller's objective, verbatim.
 * @returns the implementation prompt.
 */
export function implementPrompt(objective: string): string {
  return [
    'Implement the following objective. Work in the shared workspace and finish with a concise summary of what you changed and how it was verified.',
    '',
    `Objective: ${objective}`,
  ].join('\n')
}

/**
 * Compose the rework implementation prompt: the objective plus the reviewer's
 * required modifications.
 * @param objective - the caller's objective, verbatim.
 * @param feedback - the round-1 reviewer feedback the rework must address.
 * @returns the rework implementation prompt.
 */
export function implementReworkPrompt(objective: string, feedback: string): string {
  return [
    'A previous implementation of the objective below was reviewed and needs modifications. Apply exactly the requested modifications in the shared workspace, keeping the rest of the work intact, and finish with a concise summary of what you changed and how it was verified.',
    '',
    `Objective: ${objective}`,
    '',
    `Reviewer feedback to address: ${feedback}`,
  ].join('\n')
}

/**
 * Compose the round-1 review prompt: review the implementation summary against
 * the objective.
 * @param objective - the caller's objective, verbatim.
 * @param summary - the settled implementation summary.
 * @returns the review prompt.
 */
export function reviewPrompt(objective: string, summary: string): string {
  return [
    'Review the implementation summary below against the objective. Inspect the shared workspace yourself to verify the claims. Reply with a verdict: approved when the objective is met, otherwise changes-requested with the specific modifications still required.',
    '',
    `Objective: ${objective}`,
    '',
    `Implementation summary: ${summary}`,
  ].join('\n')
}

/**
 * Compose the round-2 review prompt: verify the rework addressed exactly the
 * prior feedback.
 * @param objective - the caller's objective, verbatim.
 * @param summary - the settled round-2 implementation summary.
 * @param priorFeedback - the round-1 feedback the rework had to address.
 * @returns the rework review prompt.
 */
export function reworkReviewPrompt(objective: string, summary: string, priorFeedback: string): string {
  return [
    'A rework of the objective below was applied to address specific reviewer feedback. Verify the shared workspace yourself, then reply with a verdict: approved only when the requested modifications are correctly applied and the objective is met, otherwise changes-requested with what still fails.',
    '',
    `Objective: ${objective}`,
    '',
    `Prior reviewer feedback that the rework had to address: ${priorFeedback}`,
    '',
    `Rework summary: ${summary}`,
  ].join('\n')
}

/**
 * Validate the implement stage's return value beyond the engine's schema
 * check: non-empty and within the handoff bound.
 * @param value - the run's returned value.
 * @param maxHandoffChars - the configured cross-stage artifact bound.
 * @returns the validated report.
 * @throws StageReportError on an empty or oversized summary.
 */
export function validateImplementReport(value: unknown, maxHandoffChars: number): ImplementReport {
  const report = value as Partial<ImplementReport> | null
  if (report === null || typeof report.summary !== 'string' || report.summary.length === 0) {
    throw new StageReportError('implement', 'the summary was empty or missing')
  }
  if (report.summary.length > maxHandoffChars) {
    throw new StageReportError('implement', `the summary is ${report.summary.length} characters, over the ${maxHandoffChars} handoff bound`)
  }
  return { summary: report.summary }
}

/**
 * Validate the review stage's return value beyond the engine's schema check:
 * non-empty feedback within the handoff bound.
 * @param value - the run's returned value.
 * @param maxHandoffChars - the configured cross-stage artifact bound.
 * @returns the validated report.
 * @throws StageReportError on an empty or oversized feedback.
 */
export function validateReviewReport(value: unknown, maxHandoffChars: number): ReviewReport {
  const report = value as Partial<ReviewReport> | null
  if (report === null || typeof report.feedback !== 'string' || report.feedback.length === 0) {
    throw new StageReportError('review', 'the feedback was empty or missing')
  }
  if (report.feedback.length > maxHandoffChars) {
    throw new StageReportError('review', `the feedback is ${report.feedback.length} characters, over the ${maxHandoffChars} handoff bound`)
  }
  return { verdict: report.verdict as ReviewVerdict, feedback: report.feedback }
}
