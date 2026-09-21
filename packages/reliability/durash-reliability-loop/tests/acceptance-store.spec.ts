import { afterEach, describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { AcceptanceStore } from '../src/acceptance-store.ts'
import type { AcceptanceRecord, AcceptanceRequirement, AcceptanceTaskId } from '../src/acceptance-schema.ts'
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
