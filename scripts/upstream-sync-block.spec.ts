import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import {
  applyConflictReport,
  classifyMergeResult,
  conflictFingerprint,
  CONFLICT_ISSUE_TITLE,
  decideConflictReport,
  main,
  parseBlockState,
  renderConflictIssueBody,
  resolveConflictIssue,
  writeJobSummary,
  type GhClient,
  type GhIssue,
  type UpstreamSyncBlockState,
} from './upstream-sync-block.ts'

const root = resolve(import.meta.dirname, '..')
const pairingDriver = 'scripts/merge-translation-pairing-driver.sh %O %A %B %P'
const fixtures: string[] = []

afterEach(() => {
  for (const dir of fixtures.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function gitEnv(dir: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_AUTHOR_EMAIL: 'sync@example.test',
    GIT_AUTHOR_NAME: 'Sync Test',
    GIT_COMMITTER_EMAIL: 'sync@example.test',
    GIT_COMMITTER_NAME: 'Sync Test',
    GIT_CONFIG_GLOBAL: join(dir, 'global.gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_DEFAULT_HASH: 'sha1',
  }
}

function git(dir: string, args: string[]): string {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: gitEnv(dir) })
}

function initRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'durash-upstream-sync-'))
  fixtures.push(dir)
  execFileSync('git', ['init', '--quiet', '--initial-branch=main', dir], { env: gitEnv(dir) })
  return dir
}

function commit(dir: string, relative: string, contents: string, message: string): void {
  writeFileSync(join(dir, relative), contents)
  git(dir, ['add', relative])
  git(dir, ['commit', '-m', message])
}

function unmerged(dir: string): string[] {
  const text = execFileSync('git', ['-C', dir, 'diff', '--name-only', '--diff-filter=U'], {
    encoding: 'utf8', env: gitEnv(dir),
  })
  return text.split('\n').map(line => line.trim()).filter(Boolean)
}

function sampleState(overrides: Partial<UpstreamSyncBlockState> = {}): UpstreamSyncBlockState {
  return {
    schema: 1,
    kind: 'merge-conflict',
    status: 'blocked',
    upstreamSha: 'aaa111',
    conflictFingerprint: conflictFingerprint(['overlay.ts']),
    conflictFiles: ['overlay.ts'],
    reportedAt: '2026-09-01T00:00:00.000Z',
    lastSeenAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  }
}

function memoryGh(initial: GhIssue[] = []): GhClient & { calls: string[][]; issues: GhIssue[] } {
  const issues = [...initial]
  const calls: string[][] = []
  return {
    issues,
    calls,
    async listOpenIssuesByTitle(title) {
      calls.push(['list', title])
      return issues.filter(issue => issue.title === title)
    },
    async createIssue(title, body) {
      calls.push(['create', title])
      const number = issues.length + 1
      issues.push({ number, title, body })
      return { number }
    },
    async comment(number, body) {
      calls.push(['comment', String(number), body])
    },
    async editBody(number, body) {
      calls.push(['edit', String(number)])
      const issue = issues.find(candidate => candidate.number === number)
      if (issue === undefined) throw new Error('missing issue')
      issues.splice(issues.indexOf(issue), 1, { ...issue, body })
    },
    async close(number, comment) {
      calls.push(['close', String(number), comment])
      const index = issues.findIndex(candidate => candidate.number === number)
      if (index >= 0) issues.splice(index, 1)
    },
  }
}

describe('classifyMergeResult', () => {
  it('treats exit 0 as clean even if leftover names are supplied', () => {
    expect(classifyMergeResult({ exitCode: 0, unmergedFiles: ['stale.ts'] })).toEqual({ kind: 'clean' })
  })

  it('requires unmerged paths before calling a non-zero merge a text conflict', () => {
    expect(classifyMergeResult({ exitCode: 1, unmergedFiles: [], stderr: 'fatal: refusing to merge unrelated histories' })).toEqual({
      kind: 'merge-error',
      detail: 'fatal: refusing to merge unrelated histories',
    })
    expect(classifyMergeResult({ exitCode: 2, unmergedFiles: ['', '  '] })).toMatchObject({ kind: 'merge-error' })
  })

  it('fingerprints sorted unique posix paths and ignores target-only path separators', () => {
    const left = classifyMergeResult({ exitCode: 1, unmergedFiles: ['b.ts', 'a.ts', 'a.ts'] })
    const right = classifyMergeResult({ exitCode: 1, unmergedFiles: ['a.ts', 'b.ts'] })
    expect(left).toEqual(right)
    expect(left).toMatchObject({ kind: 'text-conflict', files: ['a.ts', 'b.ts'] })
    expect(conflictFingerprint(['packages\\overlay.ts'])).toBe(conflictFingerprint(['packages/overlay.ts']))
  })
})

describe('upstream sync text conflicts in a real git repository', () => {
  it('classifies a file conflict, keeps the fingerprint after the target branch moves, and changes it for a new file', () => {
    const dir = initRepo()
    commit(dir, 'shared.txt', 'base\n', 'base')
    git(dir, ['switch', '-c', 'overlay'])
    commit(dir, 'shared.txt', 'overlay\n', 'overlay edit')
    git(dir, ['switch', 'main'])
    commit(dir, 'shared.txt', 'upstream\n', 'upstream edit')
    const upstreamSha = git(dir, ['rev-parse', 'HEAD']).trim()
    git(dir, ['switch', 'overlay'])
    let mergeStatus = 0
    try {
      git(dir, ['merge', '--no-ff', '--no-commit', upstreamSha])
    } catch (error) {
      mergeStatus = typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number' ? error.status : 1
    }
    const first = classifyMergeResult({ exitCode: mergeStatus, unmergedFiles: unmerged(dir) })
    expect(first.kind).toBe('text-conflict')
    if (first.kind !== 'text-conflict') throw new Error('expected text conflict')
    expect(first.files).toEqual(['shared.txt'])
    git(dir, ['merge', '--abort'])

    commit(dir, 'unrelated.txt', 'target moved\n', 'target branch update')
    mergeStatus = 0
    try {
      git(dir, ['merge', '--no-ff', '--no-commit', upstreamSha])
    } catch (error) {
      mergeStatus = typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number' ? error.status : 1
    }
    const afterTarget = classifyMergeResult({ exitCode: mergeStatus, unmergedFiles: unmerged(dir) })
    expect(afterTarget).toEqual(first)
    git(dir, ['merge', '--abort'])

    git(dir, ['switch', 'main'])
    commit(dir, 'second.txt', 'upstream second\n', 'new upstream file')
    const newUpstream = git(dir, ['rev-parse', 'HEAD']).trim()
    git(dir, ['switch', 'overlay'])
    commit(dir, 'second.txt', 'overlay second\n', 'overlay second')
    mergeStatus = 0
    try {
      git(dir, ['merge', '--no-ff', '--no-commit', newUpstream])
    } catch (error) {
      mergeStatus = typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number' ? error.status : 1
    }
    const changed = classifyMergeResult({ exitCode: mergeStatus, unmergedFiles: unmerged(dir) })
    expect(changed.kind).toBe('text-conflict')
    if (changed.kind !== 'text-conflict') throw new Error('expected text conflict')
    expect(changed.files).toEqual(['second.txt', 'shared.txt'])
    expect(changed.fingerprint).not.toBe(first.fingerprint)
    git(dir, ['merge', '--abort'])
  })

  it('does not classify a corrupt merge object as a text conflict', () => {
    const dir = initRepo()
    commit(dir, 'ok.txt', 'ok\n', 'ok')
    let stderr = ''
    let status = 0
    try {
      git(dir, ['merge', '--no-ff', '--no-commit', 'ffffffffffffffffffffffffffffffffffffffff'])
    } catch (error) {
      status = typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number' ? error.status : 1
      stderr = typeof error === 'object' && error !== null && 'stderr' in error ? String(error.stderr) : ''
    }
    expect(classifyMergeResult({ exitCode: status, unmergedFiles: unmerged(dir), stderr })).toMatchObject({
      kind: 'merge-error',
    })
  })
})

describe('conflict issue state machine', () => {
  it('round-trips machine-readable state and ignores malformed comments', () => {
    const state = sampleState()
    const body = renderConflictIssueBody(state)
    expect(parseBlockState(body)).toEqual(state)
    expect(parseBlockState('no comment')).toBeNull()
    expect(parseBlockState('<!-- durash-upstream-sync-block:v1\nnot-json\n-->')).toBeNull()
  })

  it('reports the first conflict, then keeps a known block silent, then reports a new fingerprint', async () => {
    const gh = memoryGh()
    const files = ['overlay.ts']
    const fingerprint = conflictFingerprint(files)
    const first = decideConflictReport({
      upstreamSha: 'aaa111', files, fingerprint, recorded: null, issueNumber: null, now: '2026-09-01T00:00:00.000Z',
    })
    expect(first).toMatchObject({ summary: 'blocked-new', failJob: true, comment: false, createIssue: true })
    const created = await applyConflictReport(gh, first)
    expect(created.issueNumber).toBe(1)
    expect(gh.calls.map(call => call[0])).toEqual(['create'])

    const known = decideConflictReport({
      upstreamSha: 'bbb222',
      files,
      fingerprint,
      recorded: parseBlockState(gh.issues[0]!.body),
      issueNumber: 1,
      now: '2026-09-01T06:00:00.000Z',
    })
    expect(known).toMatchObject({ summary: 'blocked-known', failJob: false, comment: false, createIssue: false, issueNumber: 1 })
    expect(known.state.reportedAt).toBe(first.state.reportedAt)
    expect(known.state.upstreamSha).toBe('bbb222')
    await applyConflictReport(gh, known)
    expect(gh.calls.map(call => call[0])).toEqual(['create', 'edit'])

    const changedFiles = ['overlay.ts', 'other.ts']
    const changed = decideConflictReport({
      upstreamSha: 'ccc333',
      files: changedFiles,
      fingerprint: conflictFingerprint(changedFiles),
      recorded: parseBlockState(gh.issues[0]!.body),
      issueNumber: 1,
      now: '2026-09-01T12:00:00.000Z',
    })
    expect(changed).toMatchObject({ summary: 'blocked-changed', failJob: true, comment: true, createIssue: false })
    await applyConflictReport(gh, changed)
    expect(gh.calls.map(call => call[0])).toEqual(['create', 'edit', 'edit', 'comment'])
  })

  it('closes the conflict issue after a clean merge and after the default branch already contains upstream', async () => {
    const gh = memoryGh([{ number: 9, title: CONFLICT_ISSUE_TITLE, body: renderConflictIssueBody(sampleState()) }])
    const prepared = await resolveConflictIssue(gh, { reason: 'pr-prepared', upstreamSha: 'ddd444' })
    expect(prepared).toEqual({ summary: 'pr-prepared', closedIssue: 9 })
    expect(gh.calls.at(-1)?.[0]).toBe('close')
    expect(gh.calls.at(-1)?.[2]).toMatch(/not a completed product sync/)

    const empty = memoryGh()
    await expect(resolveConflictIssue(empty, { reason: 'in-sync', upstreamSha: 'ddd444' })).resolves.toEqual({
      summary: 'already-clear', closedIssue: null,
    })

    const open = memoryGh([{ number: 3, title: CONFLICT_ISSUE_TITLE, body: renderConflictIssueBody(sampleState()) }])
    await expect(resolveConflictIssue(open, { reason: 'in-sync', upstreamSha: 'ddd444' })).resolves.toEqual({
      summary: 'in-sync', closedIssue: 3,
    })
  })

  it('refuses to record a non-conflict merge failure as a known block', async () => {
    const gh = memoryGh([{ number: 4, title: CONFLICT_ISSUE_TITLE, body: renderConflictIssueBody(sampleState()) }])
    await expect(main(['report', '--upstream-sha', 'eee555', '--conflict-files', ''], gh)).rejects.toThrow(/refusing to record a known merge conflict/)
    expect(gh.calls.map(call => call[0])).toEqual([])
  })

  it('runs report and resolve through the CLI against the issue store', async () => {
    const summary = join(mkdtempSync(join(tmpdir(), 'durash-sync-summary-')), 'summary.md')
    fixtures.push(join(summary, '..'))
    const gh = memoryGh()
    const first = await main(['report', '--upstream-sha', 'fff666', '--conflict-files', 'a.ts,b.ts', '--summary-file', summary], gh)
    expect(first).toBe(1)
    expect(readFileSync(summary, 'utf8')).toMatch(/new text conflict/)
    const again = await main(['report', '--upstream-sha', 'fff666', '--conflict-files', 'b.ts,a.ts', '--summary-file', summary], gh)
    expect(again).toBe(0)
    expect(readFileSync(summary, 'utf8')).toMatch(/known/)
    expect(gh.calls.filter(call => call[0] === 'comment')).toHaveLength(0)
    const resolved = await main(['resolve', '--reason', 'pr-prepared', '--upstream-sha', 'fff666', '--summary-file', summary], gh)
    expect(resolved).toBe(0)
    expect(readFileSync(summary, 'utf8')).toMatch(/not a completed product sync/)
  })
})

describe('writeJobSummary', () => {
  it('skips an empty path and appends a trailing newline', () => {
    expect(() => { writeJobSummary(undefined, 'x') }).not.toThrow()
    const file = join(mkdtempSync(join(tmpdir(), 'durash-sync-sum-')), 's.md')
    fixtures.push(join(file, '..'))
    writeJobSummary(file, 'hello')
    expect(readFileSync(file, 'utf8')).toBe('hello\n')
  })
})

describe('upstream synchronization workflow wiring', () => {
  it('keeps the six-hour cron, pairing driver, opt-in auto-merge, and block-state script', () => {
    const workflow: unknown = yaml.load(readFileSync(resolve(root, '.github/workflows/upstream-sync.yml'), 'utf8'))
    if (!isRecord(workflow) || !isRecord(workflow.jobs) || !isRecord(workflow.jobs.synchronize)) {
      throw new TypeError('upstream-sync.yml must define the synchronize job')
    }
    expect(workflow.on).toMatchObject({ schedule: [{ cron: '17 */6 * * *' }] })
    const steps = workflow.jobs.synchronize.steps
    if (!Array.isArray(steps)) throw new TypeError('the synchronize job must define steps')
    const prepare = namedRunStep(steps, 'Prepare the synchronization branch')
    expect(prepare.run).toContain("git -c 'merge.dsh-translation-pairing.driver=" + pairingDriver + "' merge --no-ff --no-commit \"$upstream_sha\"")
    expect(prepare.run).toContain('if [ -z "$conflicts" ]; then')
    const mergeLine = prepare.run.split('\n').map(line => line.trim()).find(line => line.includes('merge --no-ff --no-commit'))
    expect(mergeLine).toContain("git -c 'merge.dsh-translation-pairing.driver=" + pairingDriver + "' merge --no-ff --no-commit \"$upstream_sha\"")
    expect(mergeLine).not.toContain('|| true')
    const report = namedRunStep(steps, 'Report a merge conflict')
    expect(report.if).toBe("steps.prepare.outputs.conflict == 'true'")
    expect(report.run).toContain('scripts/upstream-sync-block.ts report')
    expect(report.run.split('\n').map(line => line.trim())).not.toContain('exit 1')
    const clearBlock = namedRunStep(steps, 'Clear a resolved merge-conflict block')
    expect(clearBlock.if).toBe("steps.prepare.outputs.conflict != 'true'")
    expect(clearBlock.run).toContain('scripts/upstream-sync-block.ts resolve')
    const automerge = namedRunStep(steps, 'Enable CI-gated auto-merge when explicitly configured')
    expect(String(automerge.if)).toContain("vars.DURASH_ENABLE_UPSTREAM_AUTOMERGE == 'true'")
  })
})

// The synchronization job runs under Bash on Linux; Windows has no native Bash.
describe.skipIf(process.platform === 'win32')('synchronization branch discovery', () => {
  function fixture(): { remote: string; local: string; sha: string } {
    const remote = initRepo()
    commit(remote, 'source.txt', 'upstream\n', 'seed upstream')
    const local = initRepo()
    git(local, ['remote', 'add', 'origin', remote])
    git(local, ['fetch', '--quiet', 'origin', 'main'])
    const sha = git(local, ['rev-parse', 'FETCH_HEAD']).trim()
    git(local, ['update-ref', 'refs/remotes/durash-upstream/main', sha])
    return { remote, local, sha }
  }

  function discover(local: string, prelude = ''): ReturnType<typeof spawnSync> {
    const workflow: unknown = yaml.load(readFileSync(resolve(root, '.github/workflows/upstream-sync.yml'), 'utf8'))
    if (!isRecord(workflow) || !isRecord(workflow.jobs) || !isRecord(workflow.jobs.synchronize)
      || !Array.isArray(workflow.jobs.synchronize.steps)) throw new TypeError('missing synchronization steps')
    const prepare = namedRunStep(workflow.jobs.synchronize.steps, 'Prepare the synchronization branch').run
    const end = prepare.indexOf('echo "upstream-sha=')
    if (end < 0) throw new Error('missing upstream-sha output')
    return spawnSync('bash', ['-c', `${prelude}\n${prepare.slice(0, end)}\nprintf 'SYNC_SHA=%s\\n' "$remote_sync_sha"`], {
      cwd: local,
      encoding: 'utf8',
      timeout: 30_000,
      env: { ...gitEnv(local), BASE_BRANCH: 'main', PRIMARY_REF: 'main', SYNC_BRANCH: 'automation/upstream-sync' },
    })
  }

  it('accepts an absent remote branch without reporting an error or reusing a stale tracking ref', () => {
    const { local, sha } = fixture()
    git(local, ['update-ref', 'refs/remotes/origin/automation/upstream-sync', sha])
    const result = discover(local)
    expect(result.error).toBeUndefined()
    expect(result.signal).toBeNull()
    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toBe('SYNC_SHA=\n')
  })

  it('fetches an existing remote branch and uses its fetched revision for the push lease', () => {
    const { remote, local, sha } = fixture()
    git(remote, ['branch', 'automation/upstream-sync', sha])
    const result = discover(local)
    expect(result.error).toBeUndefined()
    expect(result.signal).toBeNull()
    expect(result.status).toBe(0)
    expect(result.stdout).toBe(`SYNC_SHA=${sha}\n`)
    expect(git(local, ['rev-parse', 'refs/remotes/origin/automation/upstream-sync']).trim()).toBe(sha)
  })

  it('fails when the remote cannot be inspected', () => {
    const { local } = fixture()
    git(local, ['remote', 'set-url', 'origin', join(local, 'missing-remote')])
    const result = discover(local)
    expect(result.error).toBeUndefined()
    expect(result.signal).toBeNull()
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('does not appear to be a git repository')
    expect(result.stdout).not.toContain('SYNC_SHA=')
  })

  it('fails if fetching a discovered branch fails', () => {
    const { remote, local, sha } = fixture()
    git(remote, ['branch', 'automation/upstream-sync', sha])
    const result = discover(local, `git() {
      if [ "$1" = fetch ]; then
        echo 'fixture: fetch failed' >&2
        return 73
      fi
      command git "$@"
    }`)
    expect(result.error).toBeUndefined()
    expect(result.signal).toBeNull()
    expect(result.status).toBe(73)
    expect(result.stderr).toContain('fixture: fetch failed')
    expect(result.stdout).not.toContain('SYNC_SHA=')
  })
})

function namedRunStep(steps: unknown[], name: string): { if?: unknown; run: string } {
  const step = steps.find(candidate => isRecord(candidate) && candidate.name === name)
  if (!isRecord(step) || typeof step.run !== 'string') {
    throw new TypeError('upstream-sync.yml must define the ' + name + ' run step')
  }
  return step as { if?: unknown; run: string }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
