import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as domainPlugin from '@deepseek-ai/dsh-storage-domain'
import * as jsonPlugin from '@deepseek-ai/dsh-storage-json'
import { AcceptanceStore } from '../src/acceptance-store.ts'
import { acceptanceDigest } from '../src/acceptance.ts'
import { acceptanceDomain } from '../src/acceptance-schema.ts'
import type { AcceptanceRequirement } from '../src/acceptance-schema.ts'
import { captureSource } from '../src/evidence-adapters.ts'
import type { EvidenceIO } from '../src/evidence-adapter-types.ts'

const contexts: Context[] = []
const roots: string[] = []
const signal = new AbortController().signal
const limits = { maxAttempts: 10, maxRevisions: 5, maxRawChars: 8000, maxIndexChars: 8000 }
const check: AcceptanceRequirement = {
  id: 'check', origin: 'user', userQuote: 'validate the candidate', description: 'validate the candidate',
  command: 'controlled-check', scope: ['app.ts'], required: true, kind: 'command', level: 'process',
  allowSkipIf: [], attachments: [], produces: [],
}
const ok = (stdout = '') => ({ exitCode: 0, stdout, stderr: '', incomplete: false })
function fixtureIO(): EvidenceIO {
  return {
    async run(command) {
      if (command.includes('rev-parse --show-toplevel')) return ok('/repo\n')
      if (command.includes('rev-parse --verify HEAD')) return ok('a'.repeat(40))
      if (command.includes('ls-files --cached')) return ok('app.ts\0')
      if (command.startsWith('for dsh_evidence_path')) return ok('100644\n')
      return ok()
    },
    async read() { return new TextEncoder().encode('the same candidate') },
  }
}
async function open(root: string, io: EvidenceIO) {
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(Storage)
  await ctx.plugin(jsonPlugin, { root })
  await ctx.plugin(domainPlugin, { backend: 'json' })
  const domain = await ctx.storageDomain.open(acceptanceDomain)
  const store = new AcceptanceStore(domain.table('tasks'), domain.table('active'), () => io, new Map(), limits)
  return { store, domain, close: async () => { await store.drain(); await domain.close(); await ctx.fiber.dispose() } }
}
async function tempRoot() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-acceptance-persistence-')); roots.push(root)
  return root
}
async function plan(store: AcceptanceStore) {
  return store.plan({ sessionId: 'root', cwd: '/repo', objective: 'validate the candidate', requirements: [check],
    reason: 'human requested validation', humanTexts: ['validate the candidate'] }, signal)
}
afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('acceptance JSON persistence and cancellation', () => {
  it('reopens an interrupted started receipt without treating its partial observations as a pass', async () => {
    const root = await tempRoot(); const io = fixtureIO(); const first = await open(root, io)
    const task = await plan(first.store)
    const source = await captureSource(io, '/repo', check.scope, signal)
    await first.domain.table('tasks').put(task.taskId, {
      ...task,
      evidence: [{
        id: 'interrupted-run', checkId: check.id, checkSpecDigest: acceptanceDigest(check), revision: task.revision,
        command: check.command, cwd: task.cwd, source, afterDigest: source.digest,
        startedAt: '2026-09-21T00:00:00Z', endedAt: null, outcome: 'running', exitCode: 0,
        raw: 'partial output says passed', attachments: {}, problems: [],
      }],
    })
    await first.close()
    const reopened = await open(root, io)
    expect(reopened.store.activeTask('root')).toBe(task.taskId)
    expect(reopened.store.get(task.taskId).evidence[0]?.outcome).toBe('running')
    expect(await reopened.store.inspect(task.taskId)).toMatchObject({ status: 'pending', checksPassed: false, independentReview: 'not-reviewed' })
  })

  it('persists running before command entry and retains cancellation across domain close/reopen', async () => {
    const root = await tempRoot(); const io = fixtureIO()
    const entered = Promise.withResolvers<undefined>(); const command = Promise.withResolvers<Awaited<ReturnType<EvidenceIO['run']>>>()
    const probe = io.run.bind(io)
    io.run = async (text, cwd, abort) => {
      if (text !== check.command) return probe(text, cwd, abort)
      entered.resolve(undefined)
      abort.addEventListener('abort', () => { command.resolve({ ...ok('partial pass'), incomplete: true }) }, { once: true })
      return command.promise
    }
    const first = await open(root, io); const task = await plan(first.store)
    const controller = new AbortController()
    const operation = first.store.run(task.taskId, check.id, io, controller.signal)
    try {
      await entered.promise
      expect(first.domain.table('tasks').get(task.taskId)?.evidence[0]).toMatchObject({ outcome: 'running', endedAt: null, source: { head: 'a'.repeat(40) } })
      controller.abort()
      expect(await operation).toMatchObject({ outcome: 'cancelled' })
    } finally {
      controller.abort(); command.resolve({ ...ok(), incomplete: true }); await operation
    }
    await first.close()
    const reopened = await open(root, io)
    expect(reopened.store.get(task.taskId).evidence[0]?.outcome).toBe('cancelled')
    expect((await reopened.store.inspect(task.taskId)).checksPassed).toBe(false)
  })

  it('retains a settled check after reopening while preserving the missing-independent-review distinction', async () => {
    const root = await tempRoot(); const io = fixtureIO(); const first = await open(root, io)
    const task = await plan(first.store)
    expect((await first.store.run(task.taskId, check.id, io, signal)).outcome).toBe('passed')
    await first.close()
    const reopened = await open(root, io)
    expect(await reopened.store.inspect(task.taskId)).toMatchObject({ checksPassed: true, status: 'checks-passed', independentReview: 'not-reviewed' })
  })
})
