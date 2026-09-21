import { afterEach, describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { AcceptanceStore } from '../src/acceptance-store.ts'
import type { TargetProbe } from '../src/acceptance-store.ts'
import { acceptanceDigest } from '../src/acceptance.ts'
import type { AcceptanceRecord, AcceptanceRequirement, AcceptanceTaskId } from '../src/acceptance-schema.ts'
import type { EvidenceIO } from '../src/evidence-adapter-types.ts'

const execute = promisify(execFile)
const signal = new AbortController().signal
const roots: string[] = []
const identity = { app: 'org.fixture.app', widget: 'org.fixture.app.widget', appGroup: 'group.org.fixture.shared' }
const humanRequest = 'Validate this App, Widget and App Group.'

type TargetRequirement = Omit<AcceptanceRequirement, 'target'> & {
  target: { adapter: string; expected: string; options: Record<string, string>; constraints: Record<string, string> }
}
interface TargetArtifact { identity?: Record<string, string>; build: string }

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

function table<K extends string, V>(): KvTable<K, V> {
  const values = new Map<K, V>()
  return {
    get: (key: K) => values.get(key),
    put: (key: K, value: V) => { values.set(key, structuredClone(value)); return Promise.resolve() },
  } as KvTable<K, V>
}

async function setup() {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), 'dsh-acceptance-target-')))
  roots.push(cwd)
  await mkdir(join(cwd, 'src'))
  await mkdir(join(cwd, 'artifacts'))
  await writeFile(join(cwd, 'src/app'), 'first source')
  await writeFile(join(cwd, '.gitignore'), 'artifacts/\n')
  await execute('git', ['init', '--quiet'], { cwd })
  await execute('git', ['add', '.'], { cwd })
  await execute('git', [
    '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false',
    'commit', '--quiet', '-m', 'fixture input',
  ], { cwd })
  const io: EvidenceIO = {
    async run(command, workdir, abort) {
      try {
        const result = await execute('/bin/sh', ['-c', command], { cwd: workdir, signal: abort })
        return { exitCode: 0, stdout: result.stdout, stderr: result.stderr, incomplete: false }
      } catch (error) {
        const result = error as { code: number | string; stdout: string; stderr: string }
        return {
          exitCode: typeof result.code === 'number' ? result.code : null,
          stdout: result.stdout, stderr: result.stderr, incomplete: abort.aborted,
        }
      }
    },
    read: async (path, abort) => {
      abort.throwIfAborted()
      return readFile(path)
    },
  }
  // Only the external target is controlled; source capture and commands use real Git and shell.
  const probe: TargetProbe = async (world, workdir, options, abort) => {
    if (!options.path) throw new Error('Target fixture requires its artifact path')
    const bytes = await world.read(resolve(workdir, options.path), abort)
    const artifact = JSON.parse(new TextDecoder().decode(bytes)) as TargetArtifact
    return {
      adapter: 'fixture-target', digest: acceptanceDigest(Array.from(bytes)),
      detail: JSON.stringify(artifact),
      ...artifact.identity === undefined ? {} : { identity: artifact.identity },
    }
  }
  const store = new AcceptanceStore(
    table<AcceptanceTaskId, AcceptanceRecord>(), table<string, AcceptanceTaskId>(), () => io,
    new Map([['fixture-target', probe]]),
    { maxAttempts: 12, maxRevisions: 12, maxRawChars: 16000, maxIndexChars: 8000 },
  )
  async function artifact(path: string, build: string, observed: Record<string, string> = identity) {
    await writeFile(join(cwd, path), JSON.stringify({ identity: observed, build }))
    return store.observeTarget('fixture-target', cwd, { path }, signal)
  }
  const first = await artifact('artifacts/first.json', 'first build')
  const check: TargetRequirement = {
    id: 'target', origin: 'user', userQuote: humanRequest, description: 'Validate the declared App, Widget and App Group',
    command: 'test -s src/app', scope: ['src'], required: true, kind: 'command', level: 'process',
    attachments: [], produces: [], allowSkipIf: [],
    target: { adapter: 'fixture-target', expected: first.digest, options: { path: 'artifacts/first.json' }, constraints: identity },
  }
  const plan = (requirement = check, reason = 'Declare the required target identity') => store.plan({
    sessionId: 'root', cwd, objective: humanRequest, requirements: [requirement], reason, humanTexts: [humanRequest],
  }, signal)
  return { cwd, store, io, check, plan, artifact }
}

describe.skipIf(process.platform === 'win32')('target constraints and replaceable build observations', () => {
  it('requires fresh evidence and independent review after rebuilding the same logical target', async () => {
    const { cwd, store, io, check, plan, artifact } = await setup()
    const task = await plan()
    expect((await store.run(task.taskId, 'target', io, signal)).outcome).toBe('passed')
    expect((await store.inspect(task.taskId)).status).toBe('checks-passed')
    await writeFile(join(cwd, 'src/app'), 'second source')
    const next = await artifact('artifacts/second.json', 'second build')
    expect((await store.inspect(task.taskId)).checksPassed).toBe(false)

    const reason = 'Source was repaired and rebuilt; the same target now resides in second.json'
    const revised = await plan({
      ...check, target: { ...check.target, expected: next.digest, options: { path: 'artifacts/second.json' } },
    }, reason)
    expect(revised.taskId).toBe(task.taskId)
    expect(revised.plans).toContainEqual(expect.objectContaining({
      reason, revision: 1, requirements: [check],
    }))
    expect((await store.inspect(task.taskId)).checksPassed).toBe(false)
    expect((await store.run(task.taskId, 'target', io, signal)).outcome).toBe('passed')
    const beforeReview = await store.inspect(task.taskId)
    expect(beforeReview.status).toBe('checks-passed')
    expect(beforeReview.independentReview).toBe('not-reviewed')
    await store.review(task.taskId, 'approved', 'The updated artifact retains the required target identity', beforeReview.candidateKey, signal)
    expect((await store.inspect(task.taskId)).status).toBe('accepted')
  })

  it.each(['app', 'widget', 'appGroup'] as const)('refuses to change the required %s identity', async (field) => {
    const { store, check, plan } = await setup()
    const original = await plan()
    await expect(plan({
      ...check, target: { ...check.target, constraints: { ...identity, [field]: 'another target' } },
    }, 'Try a different installation')).rejects.toThrow(/Cannot weaken or replace user requirement/)
    expect(store.get(original.taskId).revision).toBe(1)
  })

  it('refuses to replace the trusted adapter for a user requirement', async () => {
    const { check, plan } = await setup()
    await plan()
    await expect(plan({
      ...check, target: { ...check.target, adapter: 'unrelated-target' },
    }, 'Try an unrelated observer')).rejects.toThrow(/Cannot weaken or replace user requirement/)
  })

  it('does not revive old evidence by updating only the expected artifact digest', async () => {
    const { store, io, check, plan, artifact } = await setup()
    const task = await plan()
    const oldReceipt = await store.run(task.taskId, 'target', io, signal)
    expect((await store.inspect(task.taskId)).checksPassed).toBe(true)
    const rebuilt = await artifact('artifacts/first.json', 'rebuilt without source changes')
    expect((await store.inspect(task.taskId)).checksPassed).toBe(false)
    await plan({ ...check, target: { ...check.target, expected: rebuilt.digest } }, 'Rebuilt the target at its existing path')
    const state = await store.inspect(task.taskId)
    expect(state.status).toBe('pending')
    expect(store.get(task.taskId).evidence).toHaveLength(1)
    expect(store.get(task.taskId).evidence[0]?.id).toBe(oldReceipt.id)
  })

  it('leaves a target unverified when its observation omits required identity fields', async () => {
    const { cwd, store, io, check, plan } = await setup()
    await writeFile(join(cwd, 'artifacts/unknown.json'), JSON.stringify({ build: 'unknown target identity' }))
    const unknown = await store.observeTarget('fixture-target', cwd, { path: 'artifacts/unknown.json' }, signal)
    const task = await plan({
      ...check, target: { ...check.target, expected: unknown.digest, options: { path: 'artifacts/unknown.json' } },
    })
    const receipt = await store.run(task.taskId, 'target', io, signal)
    expect(receipt.outcome).toBe('unverified')
    expect(receipt.problems.join(' ')).toMatch(/constraint|identity/i)
    expect((await store.inspect(task.taskId)).checksPassed).toBe(false)
  })

  it('rejects a matching artifact digest when the observed logical identity violates the requirement', async () => {
    const { store, io, check, plan, artifact } = await setup()
    const wrong = await artifact('artifacts/wrong.json', 'another installed target', { ...identity, widget: 'org.other.widget' })
    const task = await plan({
      ...check, target: { ...check.target, expected: wrong.digest, options: { path: 'artifacts/wrong.json' } },
    })
    const receipt = await store.run(task.taskId, 'target', io, signal)
    expect(receipt.outcome).toBe('unverified')
    expect(receipt.problems.join(' ')).toMatch(/constraint|identity/i)
    const state = await store.inspect(task.taskId)
    expect(state.checksPassed).toBe(false)
    await store.review(task.taskId, 'approved', 'Digest matches', state.candidateKey, signal)
    expect((await store.inspect(task.taskId)).status).toBe('pending')
  })
})
