import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage, { storageBackendServiceKey } from '@deepseek-ai/dsh-storage'
import * as domainPlugin from '@deepseek-ai/dsh-storage-domain'
import { WorkflowEngine } from '@deepseek-ai/dsh-workflow'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { FsTargetKey } from '@deepseek-ai/dsh-fs'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import type { ShellExecRequest, ShellRunResult } from '@deepseek-ai/dsh-shell'
import { MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { unsupportedInbox } from '../../../test-support/agent-loop-testkit/src/inbox.ts'
import ReliabilityLoopRuntime from '../src/index.ts'
import type { AcceptanceRequirement } from '../src/acceptance-schema.ts'

const signal = new AbortController().signal
const check: AcceptanceRequirement = { id: 'check', origin: 'plan', description: 'Check the source', command: 'check',
  scope: ['app.ts'], kind: 'command', level: 'process', required: true, allowSkipIf: [], attachments: [], produces: [] }

class IdleWorkflowEngine extends WorkflowEngine {
  override start = vi.fn((): never => { throw new Error('controlled stage startup unavailable') })
}

function parent(ctx: Context, id = 'root'): Agent {
  const session = Session.create(SessionId(id))
  const unavailable = (): never => { throw new Error('Unused runtime fixture Agent operation') }
  return { id: session.id, session, ctx, status: 'running', options: {}, inbox: unsupportedInbox(),
    cancel: unavailable, whenIdle: unavailable, runMaintenance: unavailable,
    send: unavailable, followup: unavailable, steer: unavailable, inject: unavailable }
}

async function setup() {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(IdleWorkflowEngine)
  await ctx.plugin(Storage)
  const backend = new MemoryStorageBackend()
  ctx.storage.backend.register('memory', backend)
  ctx.provide(storageBackendServiceKey('memory'), backend)
  await ctx.plugin(domainPlugin, { backend: 'memory' })
  await ctx.plugin(ReliabilityLoopRuntime)
  let widgetBuild = '2'
  const resolve = vi.fn((request: ShellExecRequest) => request)
  const execute = vi.fn(async (request: ShellExecRequest) => {
    const command = request.command
    const widget = command.includes('Widget.appex')
    let stdout = ''
    if (command.includes('rev-parse --show-toplevel')) stdout = '/repo\n'
    else if (command.includes('rev-parse --verify HEAD')) stdout = 'a'.repeat(40)
    else if (command.includes('ls-files --cached')) stdout = 'app.ts\0'
    else if (command.startsWith('plutil')) stdout = JSON.stringify({ CFBundleIdentifier: widget ? 'test.app.widget' : 'test.app', CFBundleShortVersionString: '1.0', CFBundleVersion: widget ? widgetBuild : '2' })
    else if (command.startsWith('codesign')) stdout = `<plist><dict><key>application-identifier</key><string>TEAM.${widget ? 'test.app.widget' : 'test.app'}</string><key>com.apple.security.application-groups</key><array><string>group.shared</string></array></dict></plist>`
    else if (command.startsWith('find') && !command.includes('-type l')) stdout = `${widget ? '/Apps/App.app/PlugIns/Widget.appex' : '/Apps/App.app'}/Info.plist\0`
    else if (command.startsWith('for dsh_evidence_path')) stdout = '100644\n'
    const result: ShellRunResult = { exitCode: 0, signal: null, timedOut: false, aborted: false, timeoutMs: 37,
      stdout: { text: stdout, truncated: false }, stderr: { text: '', truncated: false } }
    return { result: () => Promise.resolve(result) }
  })
  ctx.provide('shell', { resolve, execute })
  const fsResolve = vi.fn(async (path: string, _options?: { signal?: AbortSignal }): Promise<FsTarget> => ({
    displayPath: path, targetKey: FsTargetKey(path),
  }))
  const readBytes = vi.fn(async (target: FsTarget, _abort?: AbortSignal, _limit?: number) => new TextEncoder().encode(target.displayPath))
  ctx.provide('fs', { resolve: fsResolve, readBytes })
  const runtime = ctx.reliabilityLoopRuntime
  const plan = (sessionId = 'root') => runtime.acceptance.plan({ sessionId, cwd: '/repo', objective: 'Check the source', requirements: [check], reason: 'Initial check', humanTexts: [] }, signal)
  const start = (ctx.workflowEngine as IdleWorkflowEngine).start
  return { ctx, runtime, resolve, execute, fsResolve, readBytes, plan, parent: parent(ctx), start,
    setWidgetBuild: (build: string) => { widgetBuild = build } }
}

describe('reliability runtime executor observations', () => {
  it('fails explicitly while acceptance storage or executor capabilities are unavailable', () => {
    const ctx = new Context(); onTestFinished(() => ctx.fiber.dispose())
    const runtime = new ReliabilityLoopRuntime(ctx, { maxHandoffChars: 100 })
    expect(() => runtime.acceptance).toThrow('Acceptance storage is not ready')
    expect(() => runtime.evidenceIO()).toThrow('shell and filesystem services')
    ctx.provide('shell', { sandboxMode: 'read-only' })
    expect(() => runtime.evidenceIO()).toThrow('shell and filesystem services')
    ctx.provide('fs', {})
    expect(() => runtime.evidenceIO()).toThrow('configured sandbox policy')
  })

  it('reads bounded exact bytes with caller cancellation combined with runtime lifetime', async () => {
    const { runtime, fsResolve, readBytes } = await setup()
    const caller = new AbortController()
    const bytes = await runtime.evidenceIO().read('/repo/app.ts', caller.signal)
    expect(new TextDecoder().decode(bytes)).toBe('/repo/app.ts')
    const combined = fsResolve.mock.calls[0]![1]!.signal!
    expect(readBytes).toHaveBeenCalledWith(await fsResolve.mock.results[0]!.value, combined, 16777216)
    caller.abort()
    expect(combined.aborted).toBe(true)
  })

  it('resolves read-only observer policy and the calling Session policy before commands', async () => {
    const { ctx, runtime, resolve, parent: caller } = await setup()
    const policy = { mode: 'read-only' as const, workspaceRoot: '/repo' }
    const resolvePolicy = vi.fn(() => policy)
    ctx.provide('sandboxPolicy', { resolve: resolvePolicy })
    await runtime.evidenceIO().run('check', '/repo', signal)
    expect(resolvePolicy).toHaveBeenLastCalledWith({ mode: 'read-only' })
    expect(resolve).toHaveBeenLastCalledWith(expect.objectContaining({ sandboxPolicy: policy, stdoutMaxBytes: 65536 }))
    await runtime.evidenceIO(caller.session).run('check', '/repo', signal)
    expect(resolvePolicy).toHaveBeenLastCalledWith({ session: caller.session })
  })

  it('reports absent tasks and preserves explicit pending diagnostics when inspection fails', async () => {
    const { runtime, plan, start } = await setup()
    expect(await runtime.acceptanceView('root')).toBeNull()
    const task = await plan()
    expect(await runtime.acceptanceView('root')).toMatchObject({ taskId: task.taskId, status: 'pending' })
    const inspect = vi.spyOn(runtime.acceptance, 'inspect').mockRejectedValue(new Error('source observer unavailable'))
    onTestFinished(() => { inspect.mockRestore() })
    expect(await runtime.acceptanceView('root')).toEqual({ taskId: task.taskId, status: 'pending', checksPassed: false,
      independentReview: 'not-reviewed', reasons: ['Error: source observer unavailable'], risks: [] })
    expect(start).not.toHaveBeenCalled()
  })

  it('keeps trusted target registrations unique and disposes them before replacement', async () => {
    const { runtime } = await setup()
    const probe = vi.fn(async () => ({ adapter: 'fixture', digest: 'target', detail: '{}' }))
    const dispose = runtime.registerTargetAdapter('fixture', probe)
    expect(() => runtime.registerTargetAdapter('fixture', probe)).toThrow('already registered')
    expect(await runtime.acceptance.observeTarget('fixture', '/repo', {}, signal)).toEqual({ adapter: 'fixture', digest: 'target', detail: '{}' })
    dispose()
    await expect(runtime.acceptance.observeTarget('fixture', '/repo', {}, signal)).rejects.toThrow('Target adapter fixture unavailable')
    const replace = runtime.registerTargetAdapter('fixture', probe); replace()
  })

  it('requires actual iOS bundle paths and returns only coherent observed artifact identity', async () => {
    const { runtime, setWidgetBuild } = await setup()
    await expect(runtime.acceptance.observeTarget('ios-local-bundle', '/repo', {}, signal)).rejects.toThrow('actual appPath and widgetPath')
    await expect(runtime.acceptance.observeTarget('ios-local-bundle', '/repo', { appPath: '/Apps/App.app' }, signal)).rejects.toThrow('actual appPath and widgetPath')
    const options = { appPath: '/Apps/App.app', widgetPath: '/Apps/App.app/PlugIns/Widget.appex' }
    const observed = await runtime.acceptance.observeTarget('ios-local-bundle', '/repo', options, signal)
    expect(observed.identity).toEqual({ appBundleId: 'test.app', widgetBundleId: 'test.app.widget', appGroups: '["group.shared"]' })
    expect(JSON.parse(observed.detail)).toMatchObject({ consistent: true, reasons: [] })
    setWidgetBuild('1')
    await expect(runtime.acceptance.observeTarget('ios-local-bundle', '/repo', options, signal)).rejects.toThrow('build/version differ')
  })

  it('binds a new loop to its current acceptance task and rejects another root before starting', async () => {
    const { runtime, plan, parent: caller } = await setup()
    const task = await plan()
    await expect(runtime.start({ parent: parent(caller.ctx, 'other-root'), objective: 'Check', acceptanceTaskId: task.taskId })).rejects.toThrow('another root session')
    expect(runtime.list()).toHaveLength(0)
    const handle = await runtime.start({ parent: caller, objective: 'Check' })
    const result = await handle.result
    expect(result.acceptanceTaskId).toBe(task.taskId)
    expect(result.stage).toBe('failed')
    expect(runtime.acceptance.get(task.taskId).sessionId).toBe(caller.id)
    await handle.dispose()
  })
})
