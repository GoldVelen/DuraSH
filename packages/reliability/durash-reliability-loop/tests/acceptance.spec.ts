import { describe, expect, it } from 'vitest'
import { evaluateAcceptance, acceptanceDigest } from '../src/acceptance.ts'
import type { AcceptanceRecord } from '../src/acceptance-schema.ts'

function record(): AcceptanceRecord {
  return {
    taskId: 'task' as AcceptanceRecord['taskId'], sessionId: 'session', objective: 'Display the item', cwd: '/repo',
    revision: 1, requirements: [{ id: 'suite', origin: 'user', userQuote: 'Display the item', description: 'Full suite', command: 'pytest', scope: ['src', 'tests'], kind: 'pytest-junit', reportPath: 'report.xml', level: 'test', required: true, allowSkipIf: [], attachments: [], produces: [] }],
    plans: [], evidence: [], baseline: 'base', risks: [], review: null,
  }
}
function evidence() {
  return { id: 'run', checkId: 'suite', checkSpecDigest: acceptanceDigest(record().requirements[0]), revision: 1, startedAt: 'start', endedAt: 'end', command: 'pytest', cwd: '/repo', source: { head: 'head', digest: 'source', files: {} }, afterDigest: 'source', outcome: 'passed' as const, exitCode: 0, raw: 'tests pass', attachments: {}, report: { tests: 1, passed: 1, failed: 0, skipped: 0 }, problems: [] }
}

describe('acceptance requirements', () => {
  it('rejects evidence from an earlier source and uncommitted changed inputs', () => {
    const task = record(); task.evidence.push(evidence())
    expect(evaluateAcceptance(task, { suite: 'changed' }).checksPassed).toBe(false)
    expect(evaluateAcceptance(task, { suite: 'source' }).checksPassed).toBe(true)
  })
  it('does not replace failed full-suite evidence with a focused pass', () => {
    const task = record()
    task.evidence.push({ ...evidence(), outcome: 'failed', exitCode: 1 }, { ...evidence(), id: 'focused', checkId: 'focused' })
    expect(evaluateAcceptance(task, { suite: 'source' }).checksPassed).toBe(false)
  })
  it('requires independent evidence for declared skip preconditions', () => {
    const task = record(); task.evidence.push({ ...evidence(), report: { tests: 1, passed: 0, failed: 0, skipped: 1 } })
    expect(evaluateAcceptance(task, { suite: 'source' }).checksPassed).toBe(false)
  })
  it('does not promote logs into visible UI evidence', () => {
    const task = record(); task.requirements[0]!.level = 'ui'; task.evidence.push({ ...evidence(), checkSpecDigest: acceptanceDigest(task.requirements[0]) })
    expect(evaluateAcceptance(task, { suite: 'source' }).checksPassed).toBe(false)
  })
  it('reuses unchanged declared input content despite HEAD changing', () => {
    const task = record(); task.evidence.push({ ...evidence(), source: { head: 'old-head', digest: 'source', files: {} } })
    expect(evaluateAcceptance(task, { suite: 'source' })).toMatchObject({ checksPassed: true, independentReview: 'not-reviewed', status: 'checks-passed' })
  })
  it('never treats a started or cancelled record as passing after recovery', () => {
    const task = record(); task.evidence.push({ ...evidence(), outcome: 'running', endedAt: null, exitCode: null })
    expect(evaluateAcceptance(structuredClone(task), { suite: 'source' }).checksPassed).toBe(false)
  })
  it('requires a target observation matching the expected target', () => {
    const task = record(); task.requirements[0]!.target = { adapter: 'fixture', expected: 'current-app' }
    task.evidence.push({ ...evidence(), checkSpecDigest: acceptanceDigest(task.requirements[0]), target: { adapter: 'fixture', digest: 'old-widget', detail: '{}' } })
    expect(evaluateAcceptance(task, { suite: 'source' }).checksPassed).toBe(false)
  })
  it('binds every skipped test and its reason to its own observed prerequisite, even after approval', () => {
    const task = record()
    const suite = { ...task.requirements[0]!, allowSkipIf: ['simulator'],
      skipBindings: [{ testId: 'device', reason: 'hardware unavailable', prerequisite: 'simulator' }] }
    const prerequisite = { ...suite, id: 'simulator', allowSkipIf: [], skipBindings: [], kind: 'command' as const, level: 'process' as const }
    task.requirements = [suite, prerequisite]
    task.evidence = [
      { ...evidence(), id: 'simulator', checkId: 'simulator', checkSpecDigest: acceptanceDigest(prerequisite) },
      { ...evidence(), checkSpecDigest: acceptanceDigest(suite), report: { tests: 2, passed: 0, failed: 0, skipped: 2,
        skips: [{ testId: 'device', reason: 'hardware unavailable' }, { testId: 'widget', reason: 'unknown Widget failure' }] } },
    ]
    task.review = { verdict: 'approved', feedback: 'approved', candidateKey: 'candidate' }
    expect(evaluateAcceptance(task, { suite: 'source', simulator: 'source' }, 'candidate').status).toBe('pending')
    task.evidence[1]!.report = { tests: 1, passed: 0, failed: 0, skipped: 1, skips: [{ testId: 'device', reason: 'hardware unavailable' }] }
    expect(evaluateAcceptance(task, { suite: 'source', simulator: 'source' }, 'candidate').status).toBe('accepted')
    task.evidence[1]!.report.skips![0]!.reason = 'unknown Widget failure'
    expect(evaluateAcceptance(task, { suite: 'source', simulator: 'source' }, 'candidate').status).toBe('pending')
    delete task.evidence[1]!.report.skips
    expect(evaluateAcceptance(task, { suite: 'source', simulator: 'source' }, 'candidate').status).toBe('pending')
  })

})
