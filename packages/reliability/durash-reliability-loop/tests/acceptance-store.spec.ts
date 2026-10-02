import { afterEach, describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as domainPlugin from '@deepseek-ai/dsh-storage-domain'
import * as jsonPlugin from '@deepseek-ai/dsh-storage-json'
import { AcceptanceStore } from '../src/acceptance-store.ts'
import { acceptanceDomain } from '../src/acceptance-schema.ts'
import type { AcceptanceRecord, AcceptanceRequirement, AcceptanceTaskId } from '../src/acceptance-schema.ts'
import type { AcceptanceLimits, TargetObservation, TargetProbe } from '../src/acceptance-store.ts'
import type { EvidenceIO } from '../src/evidence-adapter-types.ts'

const exec = promisify(execFile)
const signal = new AbortController().signal
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
function table<K extends string, V>() {
  const values = new Map<K, V>()
  return { get: (key: K) => values.get(key), put: async (key: K, value: V) => { values.set(key, structuredClone(value)) } } as KvTable<K, V>
}
async function setup() {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), 'dsh-acceptance-'))); roots.push(cwd)
  await mkdir(join(cwd, 'src')); await mkdir(join(cwd, 'tests')); await mkdir(join(cwd, 'results'))
  await writeFile(join(cwd, 'src/app'), 'candidate')
  await writeFile(join(cwd, 'tests/test_app.py'), 'assert True\n')
  await writeFile(join(cwd, 'README.md'), 'docs')
  await writeFile(join(cwd, '.gitignore'), 'results/\nbuild/\n')
  for (const args of [['init'], ['add', '.'], ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'fixture']]) await exec('git', args, { cwd })
  const io: EvidenceIO = {
    async run(command, workdir, abort) {
      try { const result = await exec('/bin/sh', ['-c', command], { cwd: workdir, signal: abort }); return { exitCode: 0, stdout: result.stdout, stderr: result.stderr, incomplete: false } }
      catch (error) {
        const result = error as { code: number; stdout: string; stderr: string }
        return { exitCode: result.code, stdout: result.stdout, stderr: result.stderr, incomplete: abort.aborted }
      }
    },
    read: path => readFile(path),
  }
  const tasks = table<AcceptanceTaskId, AcceptanceRecord>(); const active = table<string, AcceptanceTaskId>()
  const create = () => new AcceptanceStore(tasks, active, () => io, new Map(), {
    maxAttempts: 20, maxRevisions: 10, maxRawChars: 16000, maxIndexChars: 8000,
  })
  const store = create()
  const check: AcceptanceRequirement = { id: 'suite', origin: 'user', userQuote: 'run full suite', description: 'full suite', command: 'printf \'<testsuite tests="1"><testcase name="visible"/></testsuite>\' > results/{run}.xml', scope: ['src', 'tests'], kind: 'pytest-junit', reportPath: 'results/{run}.xml', level: 'test', required: true, allowSkipIf: [], attachments: [], produces: [] }
  const plan = (requirements: AcceptanceRequirement[] = [check]) => store.plan({ sessionId: 'root', cwd, objective: 'run full suite', reason: 'initial requirements', requirements, humanTexts: ['run full suite'] }, signal)
  return { cwd, io, store, check, plan, create }
}

describe.skipIf(process.platform === 'win32')('observed acceptance execution', () => {
  it('executes fresh reports, persists recovery, and invalidates changed source', async () => {
    const { cwd, io, store, plan, create } = await setup()
    const task = await plan()
    expect((await store.inspect(task.taskId)).checksPassed).toBe(false)
    const receipt = await store.run(task.taskId, 'suite', io, signal)
    expect(receipt.outcome).toBe('passed')
    expect(receipt.source?.files['src/app']).toBeDefined()
    expect(receipt.raw).toContain(receipt.id)
    expect((await create().inspect(task.taskId)).status).toBe('checks-passed')
    await writeFile(join(cwd, 'README.md'), 'only docs changed')
    expect((await store.inspect(task.taskId)).checksPassed).toBe(true)
    await writeFile(join(cwd, 'src/app'), 'new candidate')
    expect((await store.inspect(task.taskId)).checksPassed).toBe(false)
  })
  it('serializes simultaneous declarations without losing locked user requirements', async () => {
    const { store, plan, check } = await setup()
    const outcomes = await Promise.allSettled([plan(), plan([{ ...check, required: false }])])
    expect(outcomes.map(value => value.status)).toEqual(['fulfilled', 'rejected'])
    expect(store.get(store.activeTask('root')!).requirements[0]?.command).toBe(check.command)
  })
  it('does not reinterpret old JUnit evidence after a model-plan parser change', async () => {
    const { io, store, plan, check } = await setup()
    const task = await plan([{ ...check, origin: 'plan' }])
    await store.run(task.taskId, 'suite', io, signal)
    expect((await store.inspect(task.taskId)).checksPassed).toBe(true)
    await plan([{ ...check, origin: 'plan', kind: 'xcresult' }])
    expect((await store.inspect(task.taskId)).checksPassed).toBe(false)
    expect(store.get(task.taskId).plans).toHaveLength(2)
  })
  it('surfaces untracked test weakening in the reviewer index', async () => {
    const { cwd, store, plan } = await setup()
    const task = await plan()
    await writeFile(join(cwd, 'tests/new_test.py'), '@pytest.mark.skip\ndef test_visible():\n    return\n')
    const state = await store.inspect(task.taskId)
    expect(state.risks.join('\n')).toContain('skip')
    expect(state.index).toContain('tests/new_test.py')
  })
  it('rejects old build outputs even when a new test command exits zero', async () => {
    const { cwd, io, store, plan, check } = await setup()
    const build: AcceptanceRequirement = { ...check, id: 'build', origin: 'plan', command: 'mkdir -p build && cp src/app build/app', kind: 'command', level: 'process', produces: ['build/app'] }
    delete build.reportPath
    const task = await plan([build, { ...check, buildCheckId: 'build' }])
    expect((await store.run(task.taskId, 'build', io, signal)).outcome).toBe('passed')
    await writeFile(join(cwd, 'src/app'), 'changed after build')
    const result = await store.run(task.taskId, 'suite', io, signal)
    expect(result.outcome).toBe('unverified')
    expect(result.problems.join()).toContain('different source')
  })
  it('keeps cancellation incomplete after reopening the store', async () => {
    const { io, store, plan, create } = await setup()
    const task = await plan(); const abort = new AbortController(); abort.abort()
    expect((await store.run(task.taskId, 'suite', io, abort.signal)).outcome).toBe('cancelled')
    expect((await create().inspect(task.taskId)).checksPassed).toBe(false)
  })
  it('keeps unrelated skips unverified through storage, review, and reopen', async () => {
    const { io, store, plan, check, create } = await setup()
    const prerequisite: AcceptanceRequirement = { ...check, id: 'simulator', origin: 'plan', kind: 'command', level: 'process', command: 'test 1 = 1' }
    delete prerequisite.reportPath
    const command = (widget: string) => `printf '%s' '<testsuite tests="2"><testcase name="device"><skipped message="hardware unavailable"/></testcase><testcase name="widget">${widget}</testcase></testsuite>' > results/{run}.xml`
    const suite: AcceptanceRequirement = { ...check, command: command('<skipped message="unknown Widget failure"/>'), allowSkipIf: ['simulator'],
      skipBindings: [{ testId: JSON.stringify(['', 'device']), reason: 'hardware unavailable', prerequisite: 'simulator' }] }
    const task = await plan([suite, prerequisite])
    await store.run(task.taskId, 'simulator', io, signal)
    const receipt = await store.run(task.taskId, 'suite', io, signal)
    expect(receipt.report?.skips).toEqual([
      { testId: JSON.stringify(['', 'device']), reason: 'hardware unavailable' },
      { testId: JSON.stringify(['', 'widget']), reason: 'unknown Widget failure' },
    ])
    const failed = await store.inspect(task.taskId)
    expect(failed.checksPassed).toBe(false)
    await store.review(task.taskId, 'approved', 'summary looked fine', failed.candidateKey)
    expect((await create().inspect(task.taskId)).status).toBe('pending')
    await plan([{ ...suite, command: command('') }, prerequisite])
    await store.run(task.taskId, 'suite', io, signal)
    const corrected = await store.inspect(task.taskId)
    expect(corrected.status).toBe('checks-passed')
    await store.review(task.taskId, 'approved', 'all skips matched', corrected.candidateKey)
    expect((await create().inspect(task.taskId)).status).toBe('accepted')
  })

})

/** Instance-local executor responses place persistence and probe failures without host resources. */
function controlledExecution(limits: Partial<AcceptanceLimits> = {}, probes: ReadonlyMap<string, TargetProbe> = new Map()) {
  const tasks = table<AcceptanceTaskId, AcceptanceRecord>()
  const active = table<string, AcceptanceTaskId>()
  const success = (stdout = '') => ({ exitCode: 0, stdout, stderr: '', incomplete: false })
  const io: EvidenceIO = {
    async run(command) {
      if (command === 'git rev-parse --show-toplevel') return success('/repo')
      if (command === 'git rev-parse --verify HEAD') return success('a'.repeat(40))
      if (command.startsWith('git ls-files --cached')) return success('src/app\0')
      if (command.startsWith('for dsh_evidence_path')) return success('100644\n')
      if (command.startsWith('find') && command.includes('-type f')) {
        const path = /^find '([^']+)'/.exec(command)?.[1]
        if (path === undefined) throw new Error('Fixture artifact path missing')
        return success(`${path}/receipt.bin\0`)
      }
      if (command.includes('test-results summary')) return success(JSON.stringify({ result: 'Passed', totalTestCount: 1, passedTests: 1, failedTests: 0, skippedTests: 0, expectedFailures: 0 }))
      if (command.includes('test-results tests')) return success(JSON.stringify({ testNodes: [] }))
      return success()
    },
    read: async path => new TextEncoder().encode(path.endsWith('.xml') ? '<testsuite><testcase name="visible"/></testsuite>' : 'observed bytes'),
  }
  const store = new AcceptanceStore(tasks, active, () => io, probes, {
    maxAttempts: 20, maxRevisions: 10, maxRawChars: 16000, maxIndexChars: 8000, ...limits,
  })
  const check: AcceptanceRequirement = { id: 'suite', origin: 'plan', description: 'Validate source', command: 'verify candidate', scope: ['src'], required: true, kind: 'command', level: 'process', allowSkipIf: [], attachments: [], produces: [] }
  const request = (requirements: AcceptanceRequirement[] = [check]) => ({ sessionId: 'root', cwd: '/repo', objective: 'Validate source', reason: 'Declare checks', requirements, humanTexts: ['Validate source'] })
  const plan = (requirements?: AcceptanceRequirement[]) => store.plan(request(requirements), signal)
  return { store, io, tasks, active, check, plan, request, success }
}

describe('acceptance persistence and executor refusals', () => {
  it('rejects unknown tasks and checks without starting execution', async () => {
    const { store, plan } = controlledExecution()
    const task = await plan()
    expect(() => store.get(`${task.taskId}-missing` as AcceptanceTaskId)).toThrow('Unknown acceptance task')
    await expect(store.run(task.taskId, 'missing', controlledExecution().io, signal)).rejects.toThrow('Unknown acceptance check')
    expect(store.get(task.taskId).evidence).toEqual([])
  })

  it('recovers serialized plan and task queues after a refused declaration', async () => {
    const { store, request, plan } = controlledExecution()
    await expect(store.plan({ ...request(), reason: '   ' }, signal)).rejects.toThrow('factual reason')
    const task = await plan()
    await expect(store.plan({ ...request(), objective: 'Another task' }, signal)).rejects.toThrow('cannot silently change')
    expect((await plan()).taskId).toBe(task.taskId)
    await store.drain()
    expect(store.get(task.taskId).revision).toBe(2)
  })

  it.each([
    { mutation: 'duplicate ids', checks: (check: AcceptanceRequirement) => [check, check], message: 'unique' },
    { mutation: 'absent human quote', checks: (check: AcceptanceRequirement) => [{ ...check, origin: 'user' as const, userQuote: 'not requested' }], message: 'absent from human' },
    { mutation: 'unknown dependency', checks: (check: AcceptanceRequirement) => [{ ...check, allowSkipIf: ['missing'] }], message: 'another declared check' },
    { mutation: 'self dependency', checks: (check: AcceptanceRequirement) => [{ ...check, buildCheckId: check.id }], message: 'another declared check' },
    { mutation: 'undeclared skip prerequisite', checks: (check: AcceptanceRequirement) => [{ ...check, skipBindings: [{ testId: 'Widget/test', reason: 'offline', prerequisite: 'missing' }] }], message: 'Skip bindings' },
    { mutation: 'duplicate skip binding', checks: (check: AcceptanceRequirement) => [{ ...check, id: 'prerequisite' }, { ...check, allowSkipIf: ['prerequisite'], skipBindings: Array.from({ length: 2 }, () => ({ testId: 'Widget/test', reason: 'offline', prerequisite: 'prerequisite' })) }], message: 'Skip bindings' },
  ])('refuses $mutation before persisting a plan', async ({ checks, message }) => {
    const { store, check, plan } = controlledExecution()
    await expect(plan(checks(check))).rejects.toThrow(message)
    expect(store.activeTask('root')).toBeUndefined()
  })

  it('retains a locked user requirement when a later plan removes it', async () => {
    const { store, check, plan } = controlledExecution()
    const user = { ...check, origin: 'user' as const, userQuote: 'Validate source' }
    const task = await plan([user])
    await expect(plan([{ ...check, id: 'replacement' }])).rejects.toThrow('Cannot weaken or replace')
    expect(store.get(task.taskId).requirements).toEqual([user])
  })

  it('enforces revision and attempt bounds while retaining previous evidence', async () => {
    const { store, io, plan } = controlledExecution({ maxRevisions: 1, maxAttempts: 1 })
    const task = await plan()
    await expect(plan()).rejects.toThrow('revision limit')
    const receipt = await store.run(task.taskId, 'suite', io, signal)
    await expect(store.run(task.taskId, 'suite', io, signal)).rejects.toThrow('attempt limit')
    expect(store.get(task.taskId).evidence.map(value => value.id)).toEqual([receipt.id])
  })

  it.each([{ exitCode: 1, incomplete: false }, { exitCode: 0, incomplete: true }])('refuses an unverified Git baseline %j', async (outcome) => {
    const { io, store, plan } = controlledExecution()
    io.run = async () => ({ exitCode: outcome.exitCode, incomplete: outcome.incomplete, stdout: 'a'.repeat(40), stderr: '' })
    await expect(plan()).rejects.toThrow('Git baseline unverified')
    expect(store.activeTask('root')).toBeUndefined()
  })

  it('refuses cancellation before a plan is persisted', async () => {
    const { store, request } = controlledExecution()
    const abort = new AbortController()
    abort.abort(new Error('request cancelled'))
    await expect(store.plan(request(), abort.signal)).rejects.toThrow('request cancelled')
    expect(store.activeTask('root')).toBeUndefined()
  })

  it.each([
    { kind: 'pytest-junit' as const, command: 'pytest', reportPath: 'results/{run}.xml' },
    { kind: 'pytest-junit' as const, command: 'pytest results/{run}.xml', reportPath: 'results/stale.xml' },
  ])('refuses a report path without invocation identity %j', async (report) => {
    const { store, io, check, plan } = controlledExecution()
    const task = await plan([{ ...check, ...report, level: 'test' }])
    const receipt = await store.run(task.taskId, 'suite', io, signal)
    expect(receipt.outcome).toBe('unverified')
    expect(receipt.problems.join()).toContain('unique {run}')
  })

  it.each([{ exitCode: 1, incomplete: false }, { exitCode: 0, incomplete: true }])('refuses an existing or unverified fresh report %j', async (outcome) => {
    const { store, io, check, plan } = controlledExecution()
    const original = io.run.bind(io)
    io.run = async (command, cwd, abort) => command.startsWith('test ! -e') ? { ...outcome, stdout: '', stderr: '' } : original(command, cwd, abort)
    const task = await plan([{ ...check, command: 'pytest results/{run}.xml', reportPath: 'results/{run}.xml', kind: 'pytest-junit', level: 'test' }])
    const receipt = await store.run(task.taskId, 'suite', io, signal)
    expect(receipt.outcome).toBe('unverified')
    expect(receipt.problems.join()).toContain('freshness is unverified')
  })

  it.each([{ exitCode: 1, incomplete: false, outcome: 'failed' }, { exitCode: 0, incomplete: true, outcome: 'unverified' }])('retains the executor outcome $outcome', async ({ exitCode, incomplete, outcome }) => {
    const { store, io, plan } = controlledExecution()
    const original = io.run.bind(io)
    io.run = async (command, cwd, abort) => command === 'verify candidate' ? { exitCode, incomplete, stdout: 'actual output', stderr: '' } : original(command, cwd, abort)
    const task = await plan()
    const receipt = await store.run(task.taskId, 'suite', io, signal)
    expect(receipt.outcome).toBe(outcome)
    expect(receipt.raw).toContain('actual output')
    expect(receipt.endedAt).not.toBeNull()
    expect((await store.inspect(task.taskId)).checksPassed).toBe(false)
  })

  it('marks truncated raw executor evidence unverified', async () => {
    const { store, io, plan } = controlledExecution({ maxRawChars: 8 })
    const task = await plan()
    const receipt = await store.run(task.taskId, 'suite', io, signal)
    expect(receipt.outcome).toBe('unverified')
    expect(receipt.raw).toHaveLength(8)
    expect(receipt.problems.join()).toContain('Raw command output incomplete')
  })

  it('detects input changes during execution instead of accepting the exit code', async () => {
    const { store, io, plan } = controlledExecution()
    const run = io.run.bind(io)
    let changed = false
    io.run = async (command, cwd, abort) => {
      if (command === 'verify candidate') changed = true
      return run(command, cwd, abort)
    }
    io.read = async () => new TextEncoder().encode(changed ? 'modified source' : 'original source')
    const task = await plan()
    const receipt = await store.run(task.taskId, 'suite', io, signal)
    expect(receipt.outcome).toBe('unverified')
    expect(receipt.problems).toContain('Source inputs changed during execution')
  })

  it('keeps failing report tests separate from a successful process exit', async () => {
    const { store, io, check, plan } = controlledExecution()
    io.read = async path => new TextEncoder().encode(path.endsWith('.xml') ? '<testsuite><testcase name="visible"><failure>not visible</failure></testcase></testsuite>' : 'source')
    const task = await plan([{ ...check, command: 'pytest results/{run}.xml', kind: 'pytest-junit', level: 'test', reportPath: 'results/{run}.xml' }])
    const receipt = await store.run(task.taskId, 'suite', io, signal)
    expect(receipt.exitCode).toBe(0)
    expect(receipt.outcome).toBe('failed')
    expect(receipt.report?.failed).toBe(1)
  })
})

describe('current artifacts and independent review', () => {
  it('refuses a missing build requirement restored from the real JSON persistence domain', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-dangling-build-'))
    roots.push(root)
    const contexts: Context[] = []
    const { io, request, check } = controlledExecution()
    const commands: string[] = []
    const run = io.run.bind(io)
    io.run = async (command, cwd, abort) => {
      commands.push(command)
      return run(command, cwd, abort)
    }
    const open = async () => {
      const ctx = new Context()
      contexts.push(ctx)
      await ctx.plugin(Storage)
      await ctx.plugin(jsonPlugin, { root })
      await ctx.plugin(domainPlugin, { backend: 'json' })
      const domain = await ctx.storageDomain.open(acceptanceDomain)
      const store = new AcceptanceStore(domain.table('tasks'), domain.table('active'), () => io, new Map(), {
        maxAttempts: 10, maxRevisions: 5, maxRawChars: 8000, maxIndexChars: 8000,
      })
      return { ctx, domain, store }
    }
    try {
      const first = await open()
      const task = await first.store.plan(request(), signal)
      // Record schemas validate fields, while restored records may contain dangling cross-check references.
      await first.domain.table('tasks').put(task.taskId, {
        ...task, requirements: [{ ...check, buildCheckId: 'removed-build' }],
      })
      await first.domain.close()
      await first.ctx.fiber.dispose()
      const reopened = await open()
      expect(reopened.store.get(task.taskId).requirements[0]?.buildCheckId).toBe('removed-build')
      commands.length = 0
      const receipt = await reopened.store.run(task.taskId, check.id, io, signal)
      expect(receipt.outcome).toBe('unverified')
      expect(receipt.problems.join()).toContain('Required build check is missing')
      expect(commands).not.toContain(check.command)
    } finally {
      for (const ctx of contexts.reverse()) await ctx.fiber.dispose()
    }
  })

  it('records xcresult directories and observable attachments and rehashes both at inspection', async () => {
    const { store, io, check, plan } = controlledExecution()
    const task = await plan([{ ...check, command: 'xcodebuild results/{run}.xcresult', kind: 'xcresult', level: 'ui', reportPath: 'results/{run}.xcresult', attachments: ['results/{run}.png'] }])
    const receipt = await store.run(task.taskId, 'suite', io, signal)
    expect(receipt.outcome).toBe('passed')
    expect(receipt.report).toEqual({ tests: 1, passed: 1, failed: 0, skipped: 0, skips: [] })
    expect(receipt.artifactPaths).toEqual({ 'results/{run}.xcresult': resolve('/repo', `results/${receipt.id}.xcresult`), 'results/{run}.png': resolve('/repo', `results/${receipt.id}.png`) })
    expect((await store.inspect(task.taskId)).checksPassed).toBe(true)
    io.read = async () => new TextEncoder().encode('attachment overwritten')
    expect((await store.inspect(task.taskId)).reasons.join()).toContain('Evidence attachment changed')
  })

  it.each([
    { stage: 'summary', exitCode: 1, incomplete: false },
    { stage: 'summary', exitCode: 0, incomplete: true },
    { stage: 'tests', exitCode: 1, incomplete: false },
    { stage: 'tests', exitCode: 0, incomplete: true },
  ])('refuses incomplete xcresult $stage observations %j', async ({ stage, exitCode, incomplete }) => {
    const { store, io, check, plan } = controlledExecution()
    const run = io.run.bind(io)
    io.run = async (command, cwd, abort) => command.includes(`test-results ${stage}`) ? { exitCode, incomplete, stdout: '{}', stderr: '' } : run(command, cwd, abort)
    const task = await plan([{ ...check, command: 'xcodebuild results/{run}.xcresult', kind: 'xcresult', level: 'test', reportPath: 'results/{run}.xcresult' }])
    expect((await store.run(task.taskId, 'suite', io, signal)).outcome).toBe('unverified')
  })

  it('requires a successful current build and records its receipt on the dependent check', async () => {
    const { store, io, check, plan } = controlledExecution()
    const build = { ...check, id: 'build', produces: ['build'] }
    const task = await plan([build, { ...check, buildCheckId: 'build' }])
    expect((await store.run(task.taskId, 'suite', io, signal)).outcome).toBe('unverified')
    const built = await store.run(task.taskId, 'build', io, signal)
    const receipt = await store.run(task.taskId, 'suite', io, signal)
    expect(receipt.outcome).toBe('passed')
    expect(receipt.buildEvidenceId).toBe(built.id)
    expect((await store.inspect(task.taskId)).checksPassed).toBe(true)
    io.read = async path => new TextEncoder().encode(path.startsWith('/repo/build') ? 'replaced binary' : 'observed bytes')
    expect((await store.run(task.taskId, 'suite', io, signal)).problems.join()).toContain('Build outputs no longer match')
    expect((await store.inspect(task.taskId)).reasons.join()).toContain('current build outputs mismatch')
  })

  it.each([
    { command: 'git diff --no-ext-diff', exitCode: 1, incomplete: false, message: 'Candidate diff' },
    { command: 'git diff --no-ext-diff', exitCode: 0, incomplete: true, message: 'Candidate diff' },
    { command: 'git ls-files --others', exitCode: 1, incomplete: false, message: 'Untracked candidate paths' },
    { command: 'git ls-files --others', exitCode: 0, incomplete: true, message: 'Untracked candidate paths' },
    { command: 'git diff --no-index', exitCode: 2, incomplete: false, message: 'Untracked diff' },
    { command: 'git diff --no-index', exitCode: 0, incomplete: true, message: 'Untracked diff' },
    { command: 'git diff --no-index', exitCode: null, incomplete: false, message: 'Untracked diff' },
  ])('refuses incomplete candidate review evidence: $message', async ({ command, exitCode, incomplete, message }) => {
    const { store, io, plan, success } = controlledExecution()
    const run = io.run.bind(io)
    io.run = async (text, cwd, abort) => text.startsWith(command) ? { exitCode, incomplete, stdout: '', stderr: '' }
      : text.startsWith('git ls-files --others') ? success('tests/new.spec.ts\0') : run(text, cwd, abort)
    const task = await plan()
    const state = await store.inspect(task.taskId)
    expect(state.checksPassed).toBe(false)
    expect(state.reasons.join()).toContain(message)
  })

  it('keeps optional unreadable checks out of blocking reasons and bounds the handoff index', async () => {
    const { store, io, plan, check } = controlledExecution({ maxIndexChars: 256 })
    const task = await plan([{ ...check, required: false }])
    const run = io.run.bind(io)
    io.run = async (command, cwd, abort) => command === 'git rev-parse --show-toplevel' ? { exitCode: 1, incomplete: false, stdout: '', stderr: '' } : run(command, cwd, abort)
    const state = await store.inspect(task.taskId)
    expect(state.reasons.join()).not.toContain('suite:')
    expect(state.index.length).toBeLessThanOrEqual(256)
    expect(state.index).toContain('taskId')
  })

  it('rejects approval when the candidate moves during independent review', async () => {
    const { store, io, plan } = controlledExecution()
    const task = await plan()
    await store.run(task.taskId, 'suite', io, signal)
    const old = await store.inspect(task.taskId)
    io.read = async () => new TextEncoder().encode('new candidate')
    const result = await store.review(task.taskId, 'approved', 'Reviewed the old source', old.candidateKey, signal)
    expect(result.checksPassed).toBe(false)
    expect(result.reasons).toContain('Candidate changed during independent review')
    expect(store.get(task.taskId).review?.verdict).toBe('changes-requested')
  })

  it('refuses unavailable and mismatched trusted target adapters', async () => {
    const probes = new Map<string, TargetProbe>([['other', async () => ({ adapter: 'unexpected', digest: 'target', detail: 'actual target' })]])
    const { store, io, check, plan } = controlledExecution({}, probes)
    await expect(store.observeTarget('missing', '/repo', {}, signal)).rejects.toThrow('unavailable')
    const task = await plan([{ ...check, target: { adapter: 'missing', expected: 'target' } }])
    expect((await store.run(task.taskId, 'suite', io, signal)).problems.join()).toContain('unavailable')
    await plan([{ ...check, target: { adapter: 'other', expected: 'target' } }])
    expect((await store.run(task.taskId, 'suite', io, signal)).problems.join()).toContain('observation differs')
  })

  it('rejects a target that differs before or changes during the command', async () => {
    let digest = 'wrong-target'
    const probes = new Map<string, TargetProbe>([['fixture', async () => ({ adapter: 'fixture', digest, detail: 'observed target' })]])
    const { store, io, check, plan } = controlledExecution({}, probes)
    const task = await plan([{ ...check, target: { adapter: 'fixture', expected: 'target' } }])
    expect((await store.run(task.taskId, 'suite', io, signal)).problems.join()).toContain('differs from the declared target')
    digest = 'target'
    const run = io.run.bind(io)
    io.run = async (command, cwd, abort) => {
      if (command === 'verify candidate') digest = 'new-target'
      return run(command, cwd, abort)
    }
    expect((await store.run(task.taskId, 'suite', io, signal)).problems).toContain('Target changed during execution')
  })

  it('refuses a target declaration removed through a held task reference while its probe is pending', async () => {
    const entered = Promise.withResolvers<undefined>()
    const observed = Promise.withResolvers<TargetObservation>()
    const observation = { adapter: 'fixture', digest: 'target', detail: 'observed target' }
    const probes = new Map<string, TargetProbe>([['fixture', async () => {
      entered.resolve(undefined)
      return observed.promise
    }]])
    const { store, io, check, plan } = controlledExecution({}, probes)
    const task = await plan([{ ...check, target: { adapter: 'fixture', expected: 'target' } }])
    const held = store.get(task.taskId).requirements[0]
    if (held === undefined) throw new Error('Declared check missing')
    const operation = store.run(task.taskId, 'suite', io, signal)
    try {
      await entered.promise
      delete held.target
      observed.resolve(observation)
      const receipt = await operation
      expect(receipt.outcome).toBe('unverified')
      expect(receipt.problems.join()).toContain('Target observation has no declared requirement')
    } finally {
      observed.resolve(observation)
      await operation
      await store.drain()
    }
  })
})
