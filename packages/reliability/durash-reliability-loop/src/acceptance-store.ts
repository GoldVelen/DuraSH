/** Durable acceptance operations using the existing execution world.
 * @module @durash/dsh-reliability-loop/acceptance-store
 */
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { acceptanceRecord, acceptanceRequirement } from './acceptance-schema.ts'
import type { AcceptanceTaskId, AcceptanceRecord, AcceptanceEvidence, AcceptanceRequirement } from './acceptance-schema.ts'
import { acceptanceDigest, evaluateAcceptance } from './acceptance.ts'
import type { AcceptanceView } from './acceptance.ts'
import { captureSource, capturePaths, parseJUnit, parseXcresult, scanTestChanges } from './evidence-adapters.ts'
import type { EvidenceIO } from './evidence-adapter-types.ts'

/** Trusted adapter observation; absent adapters and failed probes remain unverified. */
export interface TargetObservation { adapter: string; digest: string; detail: string; identity?: Record<string, string> }
/** Probe actual target state using executor capabilities, never model-supplied observations. */
export type TargetProbe = (io: EvidenceIO, cwd: string, options: Record<string, string>, signal: AbortSignal) => Promise<TargetObservation>
/** Deployment-owned retention and handoff bounds. */
export interface AcceptanceLimits { maxAttempts: number; maxRevisions: number; maxRawChars: number; maxIndexChars: number }
/** Store and execution owner shared by direct chat and the bounded workflow. */
export class AcceptanceStore {
  private readonly planTails = new Map<string, Promise<unknown>>()
  private readonly tails = new Map<AcceptanceTaskId, Promise<unknown>>()
  constructor(
    private readonly tasks: KvTable<AcceptanceTaskId, AcceptanceRecord>,
    private readonly active: KvTable<string, AcceptanceTaskId>,
    private readonly io: () => EvidenceIO,
    private readonly probes: ReadonlyMap<string, TargetProbe>,
    private readonly limits: AcceptanceLimits,
  ) {}

  /** Read the active task id without inferring requirements from prose.
   * @param sessionId - root session id.
   * @returns the task id, if requirements were declared.
   */
  activeTask(sessionId: string): AcceptanceTaskId | undefined { return this.active.get(sessionId) }

  /** Read the authoritative task including prior plans and command receipts.
   * @param id - runtime task identifier.
   * @returns the persisted task.
   */
  get(id: AcceptanceTaskId): AcceptanceRecord {
    const task = this.tasks.get(id)
    if (!task) throw new Error('Unknown acceptance task')
    return task
  }

  /** Declare or revise a model plan; cited human requirements cannot be removed or changed.
   * @param request - task scope, requirements, reason and authoritative human texts.
   * @param signal - caller cancellation.
   * @returns the persisted task with the full prior plan retained.
   */
  async plan(
    request: { sessionId: string; cwd: string; objective: string; requirements: unknown; reason: string; humanTexts: string[] },
    signal: AbortSignal,
  ): Promise<AcceptanceRecord> {
    const requirements = acceptanceRequirement.array().min(1).max(32).parse(request.requirements)
    const ids = new Set(requirements.map(check => check.id))
    if (ids.size !== requirements.length) throw new Error('Check ids must be unique')
    for (const check of requirements) {
      if (check.origin === 'user') {
        const userQuote = check.userQuote
        if (!userQuote || !request.humanTexts.some(text => text.includes(userQuote))) {
          throw new Error('User requirement quote is absent from human messages')
        }
      }
      for (const dependency of [...check.allowSkipIf, ...check.buildCheckId ? [check.buildCheckId] : []]) {
        if (!ids.has(dependency) || dependency === check.id) throw new Error('Check dependencies must name another declared check')
      }
      const bindings = new Set<string>()
      for (const binding of check.skipBindings ?? []) {
        const key = JSON.stringify([binding.testId, binding.reason])
        if (!check.allowSkipIf.includes(binding.prerequisite) || bindings.has(key)) throw new Error('Skip bindings must uniquely name a declared prerequisite for each test and reason')
        bindings.add(key)
      }
    }
    const previousPlan = this.planTails.get(request.sessionId) ?? Promise.resolve()
    const operation = previousPlan.catch(() => undefined).then(async () => {
      const existing = this.activeTask(request.sessionId)
      const id = existing ?? randomUUID() as AcceptanceTaskId
      return this.queue(id, async () => {
        const previous = existing ? this.get(existing) : undefined
        if (previous && previous.plans.length >= this.limits.maxRevisions) throw new Error('Acceptance revision limit reached; retain evidence for diagnosis')
        if (previous && (previous.objective !== request.objective || previous.cwd !== request.cwd)) throw new Error('An active task cannot silently change its objective or working directory')
        if (!request.reason.trim()) throw new Error('Plan revisions require a factual reason')
        for (const locked of previous?.requirements.filter(check => check.origin === 'user') ?? []) {
          if (JSON.stringify(requirementPromise(locked)) !== JSON.stringify(requirementPromise(requirements.find(check => check.id === locked.id)))) throw new Error(`Cannot weaken or replace user requirement ${locked.id}`)
        }
        const io = this.io()
        const baselineResult = previous ? undefined : await io.run('git rev-parse --verify HEAD', request.cwd, signal)
        if (baselineResult && (baselineResult.exitCode !== 0 || baselineResult.incomplete)) throw new Error('Git baseline unverified')
        const baseline = previous?.baseline ?? baselineResult?.stdout.trim()
        if (baseline === undefined) throw new Error('Git baseline unverified')
        signal.throwIfAborted()
        const task = acceptanceRecord.parse({
          taskId: id, sessionId: request.sessionId, cwd: request.cwd, objective: request.objective,
          revision: (previous?.revision ?? 0) + 1, baseline, requirements,
          plans: [...previous?.plans ?? [], {
            reason: request.reason, revision: previous?.revision ?? 0, requirements: previous?.requirements ?? [],
          }],
          evidence: previous?.evidence ?? [], risks: previous?.risks ?? [], review: null,
        })
        await this.tasks.put(id, task)
        await this.active.put(request.sessionId, id)
        return task
      })
    })
    this.planTails.set(request.sessionId, operation)
    return operation
  }

  /** Execute one declared check and persist a started receipt before invoking its command.
   * @param id - task identifier.
   * @param checkId - exact check whose command is executed.
   * @param io - caller's policy-aware execution capability.
   * @param signal - cancellation of this operation.
   * @returns the settled receipt, including unverified and cancelled outcomes.
   */
  async run(id: AcceptanceTaskId, checkId: string, io: EvidenceIO, signal: AbortSignal): Promise<AcceptanceEvidence> {
    return this.queue(id, async () => {
      const task = this.get(id)
      const check = task.requirements.find(value => value.id === checkId)
      if (!check) throw new Error('Unknown acceptance check')
      if (task.evidence.length >= this.limits.maxAttempts) throw new Error('Evidence attempt limit reached; diagnose existing failures')
      const runId = randomUUID()
      const substitute = (value: string) => value.replaceAll('{run}', runId)
      const artifactPaths: Record<string, string> = {}
      const receipt: AcceptanceEvidence = {
        id: runId, checkId, checkSpecDigest: acceptanceDigest(check), revision: task.revision, command: check.command, cwd: task.cwd,
        startedAt: new Date().toISOString(), endedAt: null, source: null, outcome: 'running', exitCode: null,
        raw: '', artifactPaths, attachments: {}, problems: [],
      }
      const save = async () => {
        const current = this.get(id)
        await this.tasks.put(id, { ...current, review: null, evidence: [...current.evidence.filter(value => value.id !== runId), receipt] })
      }
      await save()
      try {
        receipt.source = await captureSource(io, task.cwd, check.scope, signal)
        if (check.reportPath) {
          if (!check.reportPath.includes('{run}') || !check.command.includes('{run}')) throw new Error('Test reports require a unique {run} path in both command and reportPath')
          const prior = await io.run(`test ! -e ${quote(resolve(task.cwd, substitute(check.reportPath)))}`, task.cwd, signal)
          if (prior.exitCode !== 0 || prior.incomplete) throw new Error('Result path already exists or freshness is unverified')
        }
        const build = check.buildCheckId ? task.evidence.findLast(value => value.checkId === check.buildCheckId) : undefined
        if (check.buildCheckId) {
          const requirement = task.requirements.find(value => value.id === check.buildCheckId)
          if (!requirement) throw new Error('Required build check is missing')
          const inputs = await captureSource(io, task.cwd, requirement.scope, signal)
          if (!build || build.outcome !== 'passed' || !build.outputs || inputs.digest !== build.source?.digest) throw new Error('Required build is missing, failed, or belongs to different source')
          const output = await capturePaths(io, task.cwd, requirement.produces, signal)
          if (output.digest !== build.outputs) throw new Error('Build outputs no longer match the recorded build')
          receipt.buildEvidenceId = build.id
        }
        const beforeTarget = check.target ? await this.probe(check, io, task.cwd, signal) : undefined
        if (beforeTarget) receipt.target = beforeTarget
        if (beforeTarget) {
          if (!check.target) throw new Error('Target observation has no declared requirement')
          if (beforeTarget.digest !== check.target.expected) throw new Error('Target identity differs from the declared target')
        }
        // This durable source identity predates the actual validation command.
        await save()
        const result = await io.run(substitute(check.command), task.cwd, signal)
        receipt.exitCode = result.exitCode
        const raw = JSON.stringify({ command: substitute(check.command), ...result })
        receipt.raw = raw.slice(0, this.limits.maxRawChars)
        if (raw.length > this.limits.maxRawChars || result.incomplete) receipt.problems.push('Raw command output incomplete; inspect executor spill attachments')
        receipt.afterDigest = (await captureSource(io, task.cwd, check.scope, signal)).digest
        if (receipt.afterDigest !== receipt.source.digest) receipt.problems.push('Source inputs changed during execution')
        if (check.reportPath) {
          const path = resolve(task.cwd, substitute(check.reportPath))
          artifactPaths[check.reportPath] = path
          if (check.kind === 'pytest-junit') {
            const bytes = await io.read(path, signal)
            receipt.report = parseJUnit(new TextDecoder().decode(bytes))
            receipt.attachments[check.reportPath] = acceptanceDigest(Array.from(bytes))
          } else {
            const summary = await io.run(`xcrun xcresulttool get test-results summary --path ${quote(path)} --compact`, task.cwd, signal)
            if (summary.exitCode !== 0 || summary.incomplete) throw new Error('xcresulttool unavailable or summary incomplete')
            const counts: unknown = JSON.parse(summary.stdout)
            const details = await io.run(`xcrun xcresulttool get test-results tests --path ${quote(path)} --compact`, task.cwd, signal)
            if (details.exitCode !== 0 || details.incomplete) throw new Error('xcresult test details unavailable or incomplete')
            receipt.report = parseXcresult(counts, JSON.parse(details.stdout))
            receipt.attachments[check.reportPath] = (await capturePaths(io, task.cwd, [substitute(check.reportPath)], signal)).digest
          }
        }
        for (const path of check.attachments) {
          artifactPaths[path] = resolve(task.cwd, substitute(path))
          receipt.attachments[path] = acceptanceDigest(Array.from(await io.read(resolve(task.cwd, substitute(path)), signal)))
        }
        if (check.produces.length) receipt.outputs = (await capturePaths(io, task.cwd, check.produces, signal)).digest
        if (check.target) {
          const afterTarget = await this.probe(check, io, task.cwd, signal)
          if (afterTarget.digest !== beforeTarget?.digest) receipt.problems.push('Target changed during execution')
        }
        receipt.outcome = result.exitCode !== 0 || (receipt.report?.failed ?? 0) > 0 ? 'failed' : receipt.problems.length ? 'unverified' : 'passed'
      } catch (error) {
        receipt.outcome = signal.aborted ? 'cancelled' : 'unverified'
        receipt.problems.push(String(error))
      }
      receipt.endedAt = new Date().toISOString()
      await save()
      return receipt
    })
  }

  /** Recompute current candidate and target identities; no model is called.
   * @param id - task identifier.
   * @param signal - cancels source, artifact, and target inspection.
   * @returns the mechanical status and bounded review index.
   */
  async inspect(
    id: AcceptanceTaskId, signal: AbortSignal = new AbortController().signal,
  ): Promise<AcceptanceView & { candidateKey: string; index: string }> {
    const task = this.get(id)
    const io = this.io()
    const current: Record<string, string> = {}
    const observations: string[] = []
    const problems: string[] = []
    for (const check of task.requirements) {
      try {
        current[check.id] = (await captureSource(io, task.cwd, check.scope, signal)).digest
        const receipt = task.evidence.findLast(value => value.checkId === check.id)
        if (receipt) {
          for (const [path, expected] of Object.entries(receipt.attachments)) {
            const actualPath = path.replaceAll('{run}', receipt.id)
            const actual = check.kind === 'xcresult' && path === check.reportPath
              ? (await capturePaths(io, task.cwd, [actualPath], signal)).digest
              : acceptanceDigest(Array.from(await io.read(resolve(task.cwd, actualPath), signal)))
            if (actual !== expected) throw new Error(`Evidence attachment changed: ${path}`)
          }
        }
        if (check.target) {
          const observed = await this.probe(check, io, task.cwd, signal)
          observations.push(observed.digest)
          if (observed.digest !== check.target.expected) throw new Error('current target mismatch')
        }
        if (check.produces.length) {
          const output = await capturePaths(io, task.cwd, check.produces, signal)
          observations.push(output.digest)
          if (task.evidence.findLast(value => value.checkId === check.id)?.outputs !== output.digest) throw new Error('current build outputs mismatch')
        }
      } catch (error) {
        current[check.id] = 'unverified'
        if (check.required) problems.push(`${check.id}: ${String(error)}`)
      }
    }
    const diff = await io.run(`git diff --no-ext-diff --no-textconv ${quote(task.baseline)} -- .`, task.cwd, signal)
    if (diff.exitCode !== 0 || diff.incomplete) problems.push('Candidate diff is unverified')
    const untracked = await io.run('git ls-files --others --exclude-standard -z', task.cwd, signal)
    if (untracked.exitCode !== 0 || untracked.incomplete) problems.push('Untracked candidate paths are unverified')
    const newFiles: string[] = []
    for (const path of untracked.stdout.split('\0').filter(Boolean)) {
      const patch = await io.run(`git diff --no-index --no-ext-diff --no-textconv -- /dev/null ${quote(path)}`, task.cwd, signal)
      if (![0, 1].includes(patch.exitCode ?? -1) || patch.incomplete) problems.push(`Untracked diff unverified: ${path}`)
      else newFiles.push(patch.stdout)
    }
    const completeDiff = diff.stdout + newFiles.join('\n')
    const risks = scanTestChanges(completeDiff).map(value => `${value.path}: ${value.kind}: ${value.line}`)
    for (const plan of task.plans.filter(value => value.revision > 0)) risks.push(`Validation plan revised after revision ${plan.revision}: ${plan.reason}. Review preserved outcomes and original-failure negative control.`)
    const candidateKey = acceptanceDigest({
      revision: task.revision, current, observations, diff: completeDiff, evidence: task.evidence.map(value => value.id),
    })
    const view = evaluateAcceptance({ ...task, risks }, current, candidateKey)
    view.reasons.push(...problems)
    view.checksPassed &&= problems.length === 0
    if (!view.checksPassed) view.status = 'pending'
    const index = JSON.stringify({ taskId: id, objective: task.objective, cwd: task.cwd, baseline: task.baseline, diffCommand: `git diff --no-ext-diff --no-textconv ${task.baseline} -- .`, untrackedFiles: untracked.stdout.split('\0').filter(Boolean), candidateKey, status: view, requirements: task.requirements, receipts: task.evidence.map(value => ({ id: value.id, check: value.checkId, outcome: value.outcome, problems: value.problems, attachments: Object.keys(value.attachments) })), access: 'Use dsh_acceptance action=status taskId for details. Read original diff and result files; receipts are executor observations, summaries are model claims.' })
    return { ...view, candidateKey, index: index.length <= this.limits.maxIndexChars ? index : JSON.stringify({ taskId: id, candidateKey, reasons: view.reasons, risks: risks.slice(0, 8), access: 'Handoff index exceeds bound. Open dsh_acceptance action=status taskId, select checkId to inspect each requirement and raw receipt before approving.' }).slice(0, this.limits.maxIndexChars) }
  }

  /** Record only a workflow-owned independent review, bound to unchanged observed inputs.
   * @param id - task identifier.
   * @param verdict - review model's decision.
   * @param feedback - bounded review explanation.
   * @param candidateKey - identity observed before review began.
   * @param signal - cancels verification before review is persisted.
   * @returns current mechanical result; changed candidates fail closed.
   */
  async review(
    id: AcceptanceTaskId, verdict: 'approved' | 'changes-requested', feedback: string, candidateKey: string, signal?: AbortSignal,
  ): Promise<AcceptanceView & { candidateKey: string; index: string }> {
    return this.queue(id, async () => {
      const state = await this.inspect(id, signal)
      signal?.throwIfAborted()
      if (state.candidateKey !== candidateKey) {
        state.checksPassed = false
        state.reasons.push('Candidate changed during independent review')
      }
      await this.tasks.put(id, { ...this.get(id), risks: state.risks, review: { verdict: state.checksPassed ? verdict : 'changes-requested', feedback, candidateKey } })
      return state
    })
  }

  /** Observe a target before pinning its expected identity in requirements.
   * @param adapter - trusted registered adapter name.
   * @param cwd - caller's workspace.
   * @param options - adapter-specific paths or selectors, never observations.
   * @param signal - caller cancellation.
   * @returns the probe's system observation; this is not a passing check.
   */
  async observeTarget(adapter: string, cwd: string, options: Record<string, string>, signal: AbortSignal): Promise<TargetObservation> {
    const probe = this.probes.get(adapter)
    if (!probe) throw new Error(`Target adapter ${adapter} unavailable; unverified`)
    return probe(this.io(), cwd, options, signal)
  }

  /** Wait for every started write/command before the persistence domain closes. */
  async drain(): Promise<void> { await Promise.allSettled([...this.planTails.values(), ...this.tails.values()]) }

  private async probe(check: AcceptanceRequirement, io: EvidenceIO, cwd: string, signal: AbortSignal): Promise<TargetObservation> {
    const target = check.target
    if (!target) throw new Error('Target probe requires a declared target')
    const probe = this.probes.get(target.adapter)
    if (!probe) throw new Error(`Target adapter ${target.adapter} unavailable; unverified`)
    const observed = await probe(io, cwd, target.options ?? {}, signal)
    if (observed.adapter !== target.adapter) throw new Error('Target adapter observation differs from the declared adapter')
    for (const [key, expected] of Object.entries(target.constraints ?? {})) {
      if (observed.identity?.[key] !== expected) throw new Error(`Target constraint ${key} differs from the declared user target`)
    }
    return observed
  }

  private queue<T>(id: AcceptanceTaskId, work: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(id) ?? Promise.resolve()
    const result = previous.catch(() => undefined).then(work)
    this.tails.set(id, result)
    return result
  }
}
function quote(value: string): string { return `'${value.replaceAll("'", "'\\''")}'` }

/** User promises remain fixed; executable plans may change with an audited reason. */
function requirementPromise(check: AcceptanceRequirement | undefined): unknown {
  if (!check) return null
  return {
    id: check.id, origin: check.origin, userQuote: check.userQuote, description: check.description,
    required: check.required, level: check.level, allowSkipIf: check.allowSkipIf,
    externalBoundary: check.externalBoundary,
    target: check.target ? { adapter: check.target.adapter, constraints: check.target.constraints } : undefined,
  }
}
