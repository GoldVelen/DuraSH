import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod, realpath, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { captureSource, capturePaths, parseJUnit, parseXcresult, scanTestChanges, captureIOSIdentity } from '../src/evidence-adapters.ts'
import type { EvidenceIO } from '../src/evidence-adapter-types.ts'

const signal = new AbortController().signal
const ok = (stdout: string) => ({ exitCode: 0, stdout, stderr: '', incomplete: false })

function sourceIO(content: Record<string, string>, head = 'a'.repeat(40)): EvidenceIO {
  return {
    async run(command) {
      if (command.includes('rev-parse --show-toplevel')) return ok('/repo\n')
      if (command.includes('rev-parse --verify HEAD')) return ok(`${head}\n`)
      if (command.includes('ls-files')) return ok(Object.keys(content).join('\0') + '\0')
      return ok(Object.keys(content).length ? '100644\n' : 'deleted\n')
    },
    async read(path) {
      const value = content[path.slice('/repo/'.length)]
      if (value === undefined) throw new Error('missing file')
      return new TextEncoder().encode(value)
    },
  }
}

describe('source evidence identity', () => {
  it('invalidates old results for an uncommitted source change', async () => {
    const before = await captureSource(sourceIO({ 'src/app.ts': 'broken' }), '/repo', ['src'], signal)
    const after = await captureSource(sourceIO({ 'src/app.ts': 'fixed' }), '/repo', ['src'], signal)
    expect(before.head).toBe(after.head)
    expect(before.digest).not.toBe(after.digest)
  })

  it('permits a HEAD change when declared source inputs are identical', async () => {
    const before = await captureSource(sourceIO({ 'src/app.ts': 'fixed' }), '/repo', ['src'], signal)
    const after = await captureSource(sourceIO({ 'src/app.ts': 'fixed' }, 'b'.repeat(40)), '/repo', ['src'], signal)
    expect(before.head).not.toBe(after.head)
    expect(before.digest).toBe(after.digest)
  })

  it.each([[], ['../outside'], ['/outside'], [':(glob)**'], ['src/*']].map(scope => ({ scope })))('rejects unsafe or empty scope $scope', async ({ scope }) => {
    await expect(captureSource(sourceIO({}), '/repo', scope, signal)).rejects.toThrow('Source scope must contain explicit relative paths')
  })

  it('does not turn a failed or interrupted Git probe into evidence', async () => {
    const io = sourceIO({})
    io.run = async () => ({ exitCode: 0, stdout: '', stderr: '', incomplete: true })
    await expect(captureSource(io, '/repo', ['src'], signal)).rejects.toThrow(/incomplete/)
  })

  it('refuses a scope that selects no tracked or untracked inputs', async () => {
    await expect(captureSource(sourceIO({}), '/repo', ['missing'], signal)).rejects.toThrow(/no files/)
  })
})

describe('test result adapters', () => {
  it('retains each skipped JUnit testcase identity and its actual prerequisite reason', () => {
    const parsed = parseJUnit('<testsuite name="visible"><testcase classname="Widget" name="showsItem"><skipped message="device disconnected"/></testcase><testcase name="opensItem"><skipped>permission denied</skipped></testcase></testsuite>')
    expect(parsed).toMatchObject({ skipped: 2, passed: 0, skips: [
      { testId: '["Widget","showsItem"]', reason: 'device disconnected' },
      { testId: '["visible","opensItem"]', reason: 'permission denied' },
    ] })
  })

  it.each([
    '<testsuite><testcase name="one"><skipped/></testcase></testsuite>',
    '<testsuite><testcase><skipped message="device absent"/></testcase></testsuite>',
    '<testsuite><testcase name="one"><skipped message="device absent"/></testcase><testcase name="one"><skipped message="another reason"/></testcase></testsuite>',
    '<testsuite><testcase name="one"><skipped message="device absent"/></testcase><testcase name="one"/></testsuite>',
  ])('rejects skips with missing or duplicate identities and missing reasons', (xml) => {
    expect(() => parseJUnit(xml)).toThrow()
  })

  it('refuses xcresult skip totals without individual observed reasons', () => {
    const summary = { result: 'Skipped', totalTestCount: 1, passedTests: 0, failedTests: 0, skippedTests: 1, expectedFailures: 0 }
    expect(() => parseXcresult(summary)).toThrow()
    expect(() => parseXcresult(summary, { testNodes: [{ nodeType: 'Test Case', nodeIdentifier: 'WidgetTests/showsItem()', name: 'showsItem()', result: 'Skipped' }] })).toThrow()
    expect(parseXcresult(summary, { testNodes: [{ nodeType: 'Test Case', nodeIdentifier: 'WidgetTests/showsItem()', name: 'showsItem()', result: 'Skipped', children: [{ nodeType: 'Skip Message', name: 'camera permission was denied' }] }] })).toMatchObject({ skips: [{ testId: 'WidgetTests/showsItem()', reason: 'camera permission was denied' }] })
  })

  it('counts pytest testcase outcomes and keeps skip separate from pass', () => {
    expect(parseJUnit('<testsuites><testsuite tests="3" failures="1" errors="0" skipped="1"><testcase name="ok"/><testcase name="bad"><failure>bad</failure></testcase><testcase name="skip"><skipped message="no device"/></testcase></testsuite></testsuites>')).toEqual({ tests: 3, passed: 1, failed: 1, skipped: 1, skips: [{ testId: '["","skip"]', reason: 'no device' }] })
  })

  it.each([
    '<testsuite tests="1"><testcase></testsuite>',
    '<result tests="1" failures="0"/>',
    '<testsuite tests="2"><testcase name="one"/></testsuite>',
    '<testsuite tests="1" failures="0"><testcase><failure>broken</failure></testcase></testsuite>',
    '<testsuite tests="1"/>',
    '<!DOCTYPE x [<!ENTITY good "pass">]><testsuite><testcase/></testsuite>',
  ])('rejects malformed, missing, or contradictory JUnit evidence', (xml) => {
    expect(() => parseJUnit(xml)).toThrow()
  })

  it('does not mistake XCTest expected failures for passes', () => {
    expect(parseXcresult({ result: 'Passed', totalTestCount: 3, passedTests: 1, failedTests: 0, skippedTests: 1, expectedFailures: 1 }, { testNodes: [
      { nodeType: 'Test Case', nodeIdentifier: 'Widget/unavailable', result: 'Skipped', children: [{ nodeType: 'Skip Message', name: 'no device' }] },
      { nodeType: 'Test Case', nodeIdentifier: 'Widget/knownBug', result: 'Expected Failure', children: [{ nodeType: 'Expected Failure', name: 'tracked issue 12' }] },
    ] })).toEqual({ tests: 3, passed: 1, failed: 0, skipped: 2, skips: [
      { testId: 'Widget/unavailable', reason: 'no device' }, { testId: 'Widget/knownBug', reason: 'tracked issue 12' },
    ] })
  })

  it('rejects repeated XCTest skip identities even when aggregate counts agree', () => {
    const node = { nodeType: 'Test Case', nodeIdentifier: 'Widget/test', result: 'Skipped', children: [{ nodeType: 'Skip Message', name: 'no device' }] }
    expect(() => parseXcresult({ result: 'Skipped', totalTestCount: 2, passedTests: 0, failedTests: 0, skippedTests: 2, expectedFailures: 0 }, { testNodes: [node, node] })).toThrow(/identity|skip details disagree/)
  })

  it('rejects an XCTest identity shared between skipped and passed configurations', () => {
    const skipped = { nodeType: 'Test Case', nodeIdentifier: 'Widget/test', result: 'Skipped', children: [{ nodeType: 'Skip Message', name: 'no device' }] }
    const passed = { nodeType: 'Test Case', nodeIdentifier: 'Widget/test', result: 'Passed' }
    expect(() => parseXcresult({ result: 'Passed', totalTestCount: 2, passedTests: 1, failedTests: 0, skippedTests: 1, expectedFailures: 0 }, { testNodes: [skipped, passed] })).toThrow(/identity/)
  })

  it('emits an empty skip index when no test skipped', () => {
    expect(parseJUnit('<testsuite><testcase name="visible"/></testsuite>')).toEqual({ tests: 1, passed: 1, failed: 0, skipped: 0, skips: [] })
    expect(parseXcresult({ result: 'Passed', totalTestCount: 1, passedTests: 1, failedTests: 0, skippedTests: 0, expectedFailures: 0 })).toEqual({ tests: 1, passed: 1, failed: 0, skipped: 0, skips: [] })
  })

  it.each([
    { testNodes: [] },
    { testNodes: [{ nodeType: 'Test Case', result: 'Skipped', children: [{ nodeType: 'Skip Message', name: 'no device' }] }] },
    { testNodes: [{ nodeType: 'Test Case', nodeIdentifier: 'Widget/test', result: 'Skipped', children: [{ nodeType: 'Skip Message', name: 'Skipped' }] }] },
    { testNodes: [{ nodeType: 'Test Suite', nodeIdentifier: 'Widget/test', result: 'Skipped', children: [{ nodeType: 'Skip Message', name: 'no device' }] }] },
  ])('rejects missing XCTest test identity, absent reasons and container-only skips', (testTree) => {
    expect(() => parseXcresult({ result: 'Skipped', totalTestCount: 1, passedTests: 0, failedTests: 0, skippedTests: 1, expectedFailures: 0 }, testTree)).toThrow()
  })

  it.each([
    {},
    { result: 'unknown' , totalTestCount: 1, passedTests: 1, failedTests: 0, skippedTests: 0, expectedFailures: 0 },
    { result: 'Passed', totalTestCount: 1, passedTests: 1, failedTests: 1, skippedTests: 0, expectedFailures: 0 },
    { result: 'Failed', totalTestCount: 1, passedTests: 1, failedTests: 0, skippedTests: 0, expectedFailures: 0 },
  ])('rejects unknown or contradictory xcresult summaries', (json) => {
    expect(() => parseXcresult(json)).toThrow()
  })
})

describe('test standard review hints', () => {
  it('retains path and changed lines for semantic review', () => {
    const risks = scanTestChanges('diff --git a/tests/widget.swift b/tests/widget.swift\n--- a/tests/widget.swift\n+++ b/tests/widget.swift\n@@ -1,2 +1,5 @@\n-XCTAssertTrue(widget.isHittable)\n+try XCTSkipIf(true)\n+return\n+let widget = app.buttons.firstMatch\n+XCTAssert(log.contains("loaded"))')
    expect(risks.map(item => item.kind)).toEqual(expect.arrayContaining(['assertion-removed', 'skip-expanded', 'early-return', 'ambiguous-match', 'internal-state-evidence']))
    expect(risks.every(item => item.path === 'tests/widget.swift')).toBe(true)
  })
})

function iosIO(widgetBuild: string, widgetGroups: string[]): EvidenceIO {
  return {
    async run(command) {
      const widget = command.includes('Widget.appex')
      if (command.startsWith('plutil')) return ok(JSON.stringify({ CFBundleIdentifier: widget ? 'test.app.widget' : 'test.app', CFBundleShortVersionString: '1.0', CFBundleVersion: widget ? widgetBuild : '2' }))
      if (command.startsWith('codesign')) return ok(`<?xml version="1.0"?><plist version="1.0"><dict><key>application-identifier</key><string>TEAM.${widget ? 'test.app.widget' : 'test.app'}</string><key>com.apple.security.application-groups</key><array>${(widget ? widgetGroups : ['group.shared']).map(group => `<string>${group}</string>`).join('')}</array></dict></plist>`)
      if (command.includes('-type l')) return ok('')
      if (command.startsWith('find')) return ok(`${widget ? '/Apps/App.app/PlugIns/Widget.appex' : '/Apps/App.app'}/Info.plist\0`)
      return ok('100644\n')
    },
    async read(path) { return new TextEncoder().encode(path) },
  }
}

describe('local iOS artifact identity', () => {
  const options = { cwd: '/repo', appPath: '/Apps/App.app', widgetPath: '/Apps/App.app/PlugIns/Widget.appex' }
  it('flags an old embedded Widget and a different App Group', async () => {
    const result = await captureIOSIdentity(iosIO('1', ['group.other']), options, signal)
    expect(result.consistent).toBe(false)
    expect(result.reasons).toEqual(expect.arrayContaining(['App and Widget build/version differ', 'App and Widget have no shared App Group']))
  })

  it('accepts coherent artifact metadata without claiming device installation', async () => {
    const result = await captureIOSIdentity(iosIO('2', ['group.shared']), options, signal)
    expect(result.adapter).toBe('ios-local-bundle')
    expect(result.consistent).toBe(true)
    expect(result.app.digest).not.toBe(result.widget.digest)
  })

  it('rejects a Widget from a different installation', async () => {
    await expect(captureIOSIdentity(iosIO('2', ['group.shared']), { ...options, widgetPath: '/Old/App.app/PlugIns/Widget.appex' }, signal)).rejects.toThrow(/embedded/)
  })
})

// These probes use POSIX test/find syntax; unsupported hosts must report unverified.
describe.skipIf(process.platform === 'win32')('observed Git and build artifact bytes', () => {
  it('tracks dirty, untracked, deleted and executable inputs while reusing documentation-only changes', async () => {
    const exec = promisify(execFile)
    const cwd = await realpath(await mkdtemp(join(tmpdir(), 'dsh-evidence-')))
    const io: EvidenceIO = {
      async run(command, directory, abort) {
        const result = await exec('/bin/sh', ['-c', command], { cwd: directory, signal: abort })
        return ok(result.stdout)
      },
      async read(path) { return readFile(path) },
    }
    try {
      await mkdir(join(cwd, 'src'))
      await writeFile(join(cwd, 'src/app.ts'), 'broken')
      await writeFile(join(cwd, 'README.md'), 'first')
      for (const args of [['init'], ['add', '.'], ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture']]) await exec('git', args, { cwd })
      const before = await captureSource(io, cwd, ['src'], signal)
      await writeFile(join(cwd, 'README.md'), 'updated')
      await exec('git', ['add', 'README.md'], { cwd })
      await exec('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'docs'], { cwd })
      const docs = await captureSource(io, cwd, ['src'], signal)
      expect(docs.head).not.toBe(before.head)
      expect(docs.digest).toBe(before.digest)
      await writeFile(join(cwd, 'src/app.ts'), 'fixed')
      const dirty = await captureSource(io, cwd, ['src'], signal)
      expect(dirty.head).toBe(docs.head)
      expect(dirty.digest).not.toBe(docs.digest)
      await chmod(join(cwd, 'src/app.ts'), 0o755)
      const mode = await captureSource(io, cwd, ['src'], signal)
      expect(mode.digest).not.toBe(dirty.digest)
      await writeFile(join(cwd, 'src/new.ts'), 'new')
      const untracked = await captureSource(io, cwd, ['src'], signal)
      expect(untracked.files['src/new.ts']).toBeDefined()
      expect(untracked.digest).not.toBe(mode.digest)
      await rm(join(cwd, 'src/app.ts'))
      const deleted = await captureSource(io, cwd, ['src'], signal)
      expect(deleted.files['src/app.ts']).toBe('deleted')
      expect(deleted.digest).not.toBe(untracked.digest)
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('captures explicitly declared ignored files and refuses uncovered scopes beside valid source directories', async () => {
    const exec = promisify(execFile)
    const cwd = await realpath(await mkdtemp(join(tmpdir(), 'dsh-ignored-input-')))
    const io: EvidenceIO = {
      async run(command, directory, abort) {
        const result = await exec('/bin/sh', ['-c', command], { cwd: directory, signal: abort })
        return ok(result.stdout)
      },
      async read(path) { return readFile(path) },
    }
    try {
      await mkdir(join(cwd, 'src'))
      await mkdir(join(cwd, 'private-config'))
      await writeFile(join(cwd, 'src/app.ts'), 'candidate')
      await writeFile(join(cwd, '.gitignore'), '.env\nprivate-config/\n')
      await writeFile(join(cwd, '.env'), 'MODE=before')
      await writeFile(join(cwd, 'private-config/runtime.json'), '{"mode":"test"}')
      for (const args of [['init'], ['add', '.'], ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture']]) await exec('git', args, { cwd })
      const before = await captureSource(io, cwd, ['src', '.env'], signal)
      expect(before.files['.env']).toBeDefined()
      await writeFile(join(cwd, '.env'), 'MODE=after')
      const after = await captureSource(io, cwd, ['src', '.env'], signal)
      expect(after.head).toBe(before.head)
      expect(after.digest).not.toBe(before.digest)
      await expect(captureSource(io, cwd, ['src', 'missing'], signal)).rejects.toThrow(/no files/)
      await expect(captureSource(io, cwd, ['src', 'private-config'], signal)).rejects.toThrow()
      const explicit = await captureSource(io, cwd, ['src', 'private-config/runtime.json'], signal)
      expect(explicit.files['private-config/runtime.json']).toBeDefined()
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('finds changed assertions and skips in Git-quoted Chinese test paths', async () => {
    const exec = promisify(execFile)
    const cwd = await realpath(await mkdtemp(join(tmpdir(), 'dsh-quoted-diff-')))
    try {
      await mkdir(join(cwd, 'tests'))
      const path = 'tests/界面.spec.ts'
      await writeFile(join(cwd, path), 'expect(widget.visible).toBe(true)\n')
      for (const args of [['init'], ['add', '.'], ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture']]) await exec('git', args, { cwd })
      await writeFile(join(cwd, path), 'test.skip("visible", () => {})\n')
      const result = await exec('git', ['-c', 'core.quotePath=true', 'diff'], { cwd })
      expect(result.stdout).toContain('+++ "b/')
      const risks = scanTestChanges(result.stdout)
      expect(risks.map(risk => risk.kind)).toEqual(expect.arrayContaining(['assertion-removed', 'skip-expanded']))
      expect(risks.every(risk => risk.path === path)).toBe(true)
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('hashes ignored build output changes and rejects symlink substitution', async () => {
    const exec = promisify(execFile)
    const cwd = await realpath(await mkdtemp(join(tmpdir(), 'dsh-artifact-')))
    const io: EvidenceIO = {
      async run(command, directory, abort) {
        const result = await exec('/bin/sh', ['-c', command], { cwd: directory, signal: abort })
        return ok(result.stdout)
      },
      async read(path) { return readFile(path) },
    }
    try {
      await mkdir(join(cwd, 'build'))
      await writeFile(join(cwd, '.gitignore'), 'build/')
      await writeFile(join(cwd, 'build/app'), 'old binary')
      const before = await capturePaths(io, cwd, ['build'], signal)
      await writeFile(join(cwd, 'build/app'), 'new binary')
      expect((await capturePaths(io, cwd, ['build'], signal)).digest).not.toBe(before.digest)
      await symlink(join(cwd, '.gitignore'), join(cwd, 'build/link'))
      await expect(capturePaths(io, cwd, ['build'], signal)).rejects.toThrow(/Symbolic links/)
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })
})
