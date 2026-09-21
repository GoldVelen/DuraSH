/** Mechanical evaluation of executor receipts; independent review owns semantic sufficiency.
 * @module @durash/dsh-reliability-loop/acceptance
 */
import { createHash } from 'node:crypto'
import type { AcceptanceRecord } from './acceptance-schema.ts'

/** User-facing host status, independent of assistant prose. */
export interface AcceptanceView {
  taskId: string
  status: 'pending' | 'checks-passed' | 'accepted'
  checksPassed: boolean
  independentReview: 'not-reviewed' | 'approved' | 'changes-requested'
  reasons: string[]
  risks: string[]
}
/** Hash deterministic, host-collected candidate observations.
 * @param value - observations in stable check order.
 * @returns a SHA-256 content identifier.
 */
export function acceptanceDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}
/** Evaluate only the latest attempt for each declared check; unrelated focused passes cannot replace it.
 * @param task - persisted requirements and observations.
 * @param current - current content digest for each check's declared input scope.
 * @param candidateKey - current complete review identity, when independently observed.
 * @returns host status with every unmet required check.
 */
export function evaluateAcceptance(task: AcceptanceRecord, current: Record<string, string>, candidateKey?: string): AcceptanceView {
  const reasons: string[] = []
  const skipProblems = new Map<string, string>()
  const evaluating = new Set<string>()
  const passed = (id: string): boolean => {
    if (evaluating.has(id)) return false
    evaluating.add(id)
    const check = task.requirements.find(value => value.id === id)
    const receipt = task.evidence.findLast(value => value.checkId === id)
    let valid = check !== undefined && receipt !== undefined
      && receipt.outcome === 'passed' && receipt.endedAt !== null && receipt.exitCode === 0
      && receipt.checkSpecDigest === acceptanceDigest(check)
      && receipt.command === check.command && receipt.cwd === task.cwd
      && receipt.source !== null && receipt.source.digest === current[id]
      && receipt.afterDigest === receipt.source.digest && receipt.problems.length === 0
    if (valid && check && receipt) {
      if (check.kind !== 'command') valid = receipt.report !== undefined && receipt.report.tests > 0 && receipt.report.failed === 0
      if (check.level === 'ui') valid &&= check.attachments.length > 0 && check.attachments.every(path => !!receipt.attachments[path])
      if (check.target) valid &&= receipt.target?.adapter === check.target.adapter && receipt.target.digest === check.target.expected
        && Object.entries(check.target.constraints ?? {}).every(([key, expected]) => receipt.target?.identity?.[key] === expected)
      if (receipt.report && receipt.report.skipped > 0) {
        const skips = receipt.report.skips
        if (!skips || skips.length !== receipt.report.skipped) skipProblems.set(id, 'unverified skips: per-test identities and reasons are missing or incomplete')
        valid &&= skips !== undefined && skips.length === receipt.report.skipped && skips.every((skip) => {
          const bindings = check.skipBindings?.filter(binding => binding.testId === skip.testId && binding.reason === skip.reason) ?? []
          const binding = bindings[0]
          if (bindings.length !== 1 || !binding) {
            skipProblems.set(id, `unverified skip ${skip.testId}: ${skip.reason}; no unique declared prerequisite binding`)
            return false
          }
          const prerequisite = binding.prerequisite
          const proof = task.evidence.findLast(value => value.checkId === prerequisite)
          const verified = check.allowSkipIf.includes(prerequisite) && (proof?.report?.skipped ?? 0) === 0 && passed(prerequisite)
          if (!verified) skipProblems.set(id, `unverified skip ${skip.testId}: prerequisite ${prerequisite} lacks current non-skipped passing evidence`)
          return verified
        })
      }
      if (check.buildCheckId) {
        const build = task.evidence.findLast(value => value.checkId === check.buildCheckId)
        valid &&= !!build?.outputs && receipt.buildEvidenceId === build.id && passed(check.buildCheckId)
      }
    }
    evaluating.delete(id)
    return valid
  }
  for (const check of task.requirements.filter(value => value.required)) {
    if (!passed(check.id)) {
      const receipt = task.evidence.findLast(value => value.checkId === check.id)
      reasons.push(`${check.id}: ${skipProblems.get(check.id) ?? (receipt?.problems.join('; ') || 'missing, stale, failed, or unverified evidence')}`)
    }
  }
  const checksPassed = reasons.length === 0
  const independentReview = task.review && candidateKey !== undefined && task.review.candidateKey === candidateKey
    ? task.review.verdict : 'not-reviewed'
  return {
    taskId: task.taskId, checksPassed, independentReview,
    status: checksPassed ? independentReview === 'approved' ? 'accepted' : 'checks-passed' : 'pending',
    reasons, risks: task.risks,
  }
}
