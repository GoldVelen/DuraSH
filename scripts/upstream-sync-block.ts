/**
 * Persistent merge-conflict block state for DuraSH upstream synchronization.
 * The scheduled workflow retries the merge every run; this module decides
 * whether that known text conflict is a first report, a silent known block,
 * or a new conflict, and refuses to treat non-conflict merge failures as
 * known blocks.
 */

import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** Dedicated issue title reused across runs so the body can carry machine state. */
export const CONFLICT_ISSUE_TITLE = 'Upstream sync blocked by merge conflicts'

const BLOCK_COMMENT_START = '<!-- durash-upstream-sync-block:v1'
const BLOCK_COMMENT_END = '-->'

/** Durable record stored in the dedicated conflict issue body. */
export interface UpstreamSyncBlockState {
  schema: 1
  kind: 'merge-conflict'
  status: 'blocked'
  upstreamSha: string
  conflictFingerprint: string
  conflictFiles: string[]
  reportedAt: string
  lastSeenAt: string
}

/** Classification of one `git merge` attempt. */
export type MergeClassification =
  | { readonly kind: 'clean' }
  | { readonly kind: 'text-conflict'; readonly files: string[]; readonly fingerprint: string }
  | { readonly kind: 'merge-error'; readonly detail: string }

/** Issue payload used by report/resolve so tests can replace `gh`. */
export interface GhIssue {
  readonly number: number
  readonly title: string
  readonly body: string
}

/** Issue store used by report/resolve so tests can replace `gh`. */
export interface GhClient {
  listOpenIssuesByTitle(title: string): Promise<GhIssue[]>
  createIssue(title: string, body: string): Promise<{ number: number }>
  comment(number: number, body: string): Promise<void>
  editBody(number: number, body: string): Promise<void>
  close(number: number, comment: string): Promise<void>
}

/** Outcome of a conflict-report attempt. */
export interface ReportDecision {
  readonly summary: 'blocked-new' | 'blocked-known' | 'blocked-changed'
  readonly failJob: boolean
  readonly comment: boolean
  readonly createIssue: boolean
  readonly issueNumber: number | null
  readonly state: UpstreamSyncBlockState
}

/** Outcome of a successful merge or in-sync run. */
export interface ResolveDecision {
  readonly summary: 'in-sync' | 'pr-prepared' | 'already-clear'
  readonly closedIssue: number | null
}

/**
 * Normalize conflict paths and hash them. Target-branch commits that do not
 * change the unmerged path set keep this fingerprint.
 * @param files - unmerged paths from `git diff --name-only --diff-filter=U`.
 * @returns hex fingerprint, or an empty string when no paths remain.
 */
export function conflictFingerprint(files: readonly string[]): string {
  const normalized = [...new Set(files.map(normalizeConflictPath).filter(path => path.length > 0))].sort()
  if (normalized.length === 0) return ''
  return createHash('sha256').update(normalized.join('\n')).digest('hex')
}

/**
 * Classify a merge exit. A non-zero merge is a text conflict only when git
 * recorded unmerged paths; any other failure stays visible.
 * @param input - merge exit code, unmerged paths, and optional stderr.
 * @returns clean, text-conflict, or merge-error.
 */
export function classifyMergeResult(input: {
  readonly exitCode: number
  readonly unmergedFiles: readonly string[]
  readonly stderr?: string
}): MergeClassification {
  if (input.exitCode === 0) return { kind: 'clean' }
  const files = [...new Set(input.unmergedFiles.map(normalizeConflictPath).filter(path => path.length > 0))].sort()
  if (files.length === 0) {
    const detail = input.stderr?.trim() || 'git merge failed without unmerged paths'
    return { kind: 'merge-error', detail }
  }
  return { kind: 'text-conflict', files, fingerprint: conflictFingerprint(files) }
}

/**
 * Read the machine-readable block record from an issue body.
 * @param body - issue markdown, possibly including the HTML comment.
 * @returns the parsed record, or `null` when absent or malformed.
 */
export function parseBlockState(body: string): UpstreamSyncBlockState | null {
  const start = body.indexOf(BLOCK_COMMENT_START)
  if (start < 0) return null
  const jsonStart = start + BLOCK_COMMENT_START.length
  const end = body.indexOf(BLOCK_COMMENT_END, jsonStart)
  if (end < 0) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(body.slice(jsonStart, end).trim())
  } catch {
    // A truncated or hand-edited comment is not a known block.
    return null
  }
  if (!isBlockState(parsed)) return null
  return parsed
}

/**
 * Render the dedicated issue body, including the machine-readable record.
 * @param state - block record to persist.
 * @returns markdown plus the HTML comment.
 */
export function renderConflictIssueBody(state: UpstreamSyncBlockState): string {
  const files = state.conflictFiles.length > 0
    ? state.conflictFiles.map(file => '`' + file + '`').join(', ')
    : 'unknown'
  return [
    'DeepSeek Harness could not be merged automatically into DuraSH.',
    '',
    '- Upstream: `' + state.upstreamSha + '`',
    '- Conflict fingerprint: `' + state.conflictFingerprint + '`',
    '- Conflicted files: ' + files,
    '- Last seen: ' + state.lastSeenAt,
    '',
    'Resolve this against the product overlay without dropping DuraSH behavior.',
    'The scheduled check keeps retrying the merge. Identical text conflicts stay on this issue and do not fail the cron again.',
    '',
    BLOCK_COMMENT_START,
    JSON.stringify(state),
    BLOCK_COMMENT_END,
    '',
  ].join('\n')
}

/**
 * Decide GitHub writes and job failure for a classified text conflict.
 * @param input - current conflict, optional recorded issue, and clock.
 * @returns the report decision and the state to persist.
 */
export function decideConflictReport(input: {
  readonly upstreamSha: string
  readonly files: readonly string[]
  readonly fingerprint: string
  readonly recorded: UpstreamSyncBlockState | null
  readonly issueNumber: number | null
  readonly now?: string
}): ReportDecision {
  const now = input.now ?? new Date().toISOString()
  const state: UpstreamSyncBlockState = {
    schema: 1,
    kind: 'merge-conflict',
    status: 'blocked',
    upstreamSha: input.upstreamSha,
    conflictFingerprint: input.fingerprint,
    conflictFiles: [...input.files],
    reportedAt: input.recorded?.conflictFingerprint === input.fingerprint
      ? input.recorded.reportedAt
      : now,
    lastSeenAt: now,
  }
  if (input.recorded !== null && input.recorded.conflictFingerprint === input.fingerprint) {
    return {
      summary: 'blocked-known',
      failJob: false,
      comment: false,
      createIssue: false,
      issueNumber: input.issueNumber,
      state,
    }
  }
  if (input.issueNumber !== null) {
    return {
      summary: 'blocked-changed',
      failJob: true,
      comment: true,
      createIssue: false,
      issueNumber: input.issueNumber,
      state,
    }
  }
  return {
    summary: 'blocked-new',
    failJob: true,
    comment: false,
    createIssue: true,
    issueNumber: null,
    state,
  }
}

/**
 * Apply a report decision through the GitHub client.
 * @param gh - issue store.
 * @param decision - computed report decision.
 * @returns the decision with the created issue number filled in.
 */
export async function applyConflictReport(gh: GhClient, decision: ReportDecision): Promise<ReportDecision> {
  const body = renderConflictIssueBody(decision.state)
  if (decision.createIssue) {
    const created = await gh.createIssue(CONFLICT_ISSUE_TITLE, body)
    return { ...decision, issueNumber: created.number }
  }
  if (decision.issueNumber === null) {
    throw new Error('upstream-sync-block: report decision is missing an issue number')
  }
  await gh.editBody(decision.issueNumber, body)
  if (decision.comment) {
    await gh.comment(decision.issueNumber, commentFor(decision.state))
  }
  return decision
}

/**
 * Close the dedicated conflict issue after a merge that is no longer blocked.
 * Opening a synchronization PR is not a product-check pass; it only clears
 * the merge-conflict record because the text conflict itself is gone.
 * @param gh - issue store.
 * @param input - resolve reason and upstream SHA for the close comment.
 * @returns whether an issue was closed.
 */
export async function resolveConflictIssue(gh: GhClient, input: {
  readonly reason: 'in-sync' | 'pr-prepared'
  readonly upstreamSha: string
}): Promise<ResolveDecision> {
  const issue = await findConflictIssue(gh)
  if (issue === null) return { summary: 'already-clear', closedIssue: null }
  const comment = input.reason === 'in-sync'
    ? 'Upstream `' + input.upstreamSha + '` is already on the default branch. Closing the merge-conflict block.'
    : 'Upstream `' + input.upstreamSha + '` merged onto the synchronization branch. A pull request is not a completed product sync; this only clears the text-conflict block.'
  await gh.close(issue.number, comment)
  return { summary: input.reason, closedIssue: issue.number }
}

/**
 * Write the job summary that distinguishes monitoring-healthy-but-blocked
 * from in-sync, without claiming product checks passed.
 * @param path - `$GITHUB_STEP_SUMMARY`, or omitted to skip.
 * @param text - markdown to append.
 */
export function writeJobSummary(path: string | undefined, text: string): void {
  if (path === undefined || path.length === 0) return
  appendFileSync(path, text.endsWith('\n') ? text : text + '\n')
}

/** Default `gh` CLI adapter. */
export function createGhCliClient(env: NodeJS.ProcessEnv = process.env): GhClient {
  const run = async (args: string[]): Promise<string> => {
    const { stdout } = await execFileAsync('gh', args, {
      env,
      encoding: 'utf8',
      maxBuffer: 2_000_000,
    })
    return stdout
  }
  return {
    async listOpenIssuesByTitle(title) {
      const stdout = await run([
        'issue', 'list', '--state', 'open', '--search', title + ' in:title',
        '--json', 'number,title,body',
      ])
      const parsed: unknown = JSON.parse(stdout || '[]')
      if (!Array.isArray(parsed)) return []
      return parsed.flatMap((row): GhIssue[] => {
        if (!isRecord(row) || typeof row.number !== 'number' || typeof row.title !== 'string') return []
        if (row.title !== title) return []
        return [{ number: row.number, title: row.title, body: typeof row.body === 'string' ? row.body : '' }]
      })
    },
    async createIssue(title, body) {
      const stdout = await run(['issue', 'create', '--title', title, '--body', body])
      const match = stdout.trim().match(/\/issues\/(\d+)\s*$/m)
      if (match?.[1] === undefined) throw new Error('upstream-sync-block: gh issue create did not print an issue URL')
      return { number: Number(match[1]) }
    },
    async comment(number, body) {
      await run(['issue', 'comment', String(number), '--body', body])
    },
    async editBody(number, body) {
      await run(['issue', 'edit', String(number), '--body', body])
    },
    async close(number, comment) {
      await run(['issue', 'close', String(number), '--comment', comment])
    },
  }
}

/**
 * Locate the open dedicated conflict issue.
 * @param gh - issue store.
 * @returns the first exact-title match, or `null`.
 */
export async function findConflictIssue(gh: GhClient): Promise<GhIssue | null> {
  const issues = await gh.listOpenIssuesByTitle(CONFLICT_ISSUE_TITLE)
  return issues[0] ?? null
}

function commentFor(state: UpstreamSyncBlockState): string {
  return 'DeepSeek Harness `' + state.upstreamSha + '` could not be merged automatically. Conflicted files: ' + (state.conflictFiles.join(', ') || 'unknown') + '. Resolve this against the product overlay without dropping DuraSH behavior.'
}

function normalizeConflictPath(path: string): string {
  return path.trim().replaceAll('\\', '/')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isBlockState(value: unknown): value is UpstreamSyncBlockState {
  if (!isRecord(value)) return false
  if (value.schema !== 1 || value.kind !== 'merge-conflict' || value.status !== 'blocked') return false
  if (typeof value.upstreamSha !== 'string' || typeof value.conflictFingerprint !== 'string') return false
  if (!Array.isArray(value.conflictFiles) || !value.conflictFiles.every(file => typeof file === 'string')) return false
  if (typeof value.reportedAt !== 'string' || typeof value.lastSeenAt !== 'string') return false
  return true
}

function argValue(argv: string[], name: string): string {
  const index = argv.indexOf(name)
  const value = argv[index + 1]
  if (index < 0 || value === undefined) throw new Error('upstream-sync-block: missing ' + name)
  return value
}

function optionalArg(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name)
  if (index < 0) return undefined
  return argv[index + 1]
}

function summaryForReport(decision: ReportDecision): string {
  const issue = decision.issueNumber === null ? 'unassigned' : '#' + String(decision.issueNumber)
  if (decision.summary === 'blocked-known') {
    return [
      '## Upstream synchronization',
      '',
      '- Status: monitoring healthy; sync blocked by a **known** text conflict',
      '- Upstream: `' + decision.state.upstreamSha + '`',
      '- Conflict fingerprint: `' + decision.state.conflictFingerprint + '`',
      '- Issue: ' + issue,
      '',
      'This is not a product-check pass. The same conflict remains; the cron did not fail again and did not add another comment.',
      '',
    ].join('\n')
  }
  const label = decision.summary === 'blocked-new' ? 'new text conflict' : 'changed text conflict'
  return [
    '## Upstream synchronization',
    '',
    '- Status: sync blocked by a **' + label + '**',
    '- Upstream: `' + decision.state.upstreamSha + '`',
    '- Conflict fingerprint: `' + decision.state.conflictFingerprint + '`',
    '- Issue: ' + issue,
    '',
    'This run failed because the block has not been reported with this conflict identity yet.',
    '',
  ].join('\n')
}

function summaryForResolve(decision: ResolveDecision, upstreamSha: string): string {
  if (decision.summary === 'in-sync') {
    return [
      '## Upstream synchronization',
      '',
      '- Status: in sync with `' + upstreamSha + '`',
      decision.closedIssue === null ? '' : '- Closed merge-conflict issue: #' + String(decision.closedIssue),
      '',
    ].filter(Boolean).join('\n')
  }
  if (decision.summary === 'pr-prepared') {
    return [
      '## Upstream synchronization',
      '',
      '- Status: synchronization pull request prepared for `' + upstreamSha + '`',
      '- A prepared PR is not a completed product sync and is not a product-check pass.',
      decision.closedIssue === null ? '' : '- Closed merge-conflict issue: #' + String(decision.closedIssue),
      '',
    ].filter(Boolean).join('\n')
  }
  return [
    '## Upstream synchronization',
    '',
    '- Status: no open merge-conflict issue (`' + upstreamSha + '`)',
    '',
  ].join('\n')
}

/** CLI entry used by the GitHub workflow. */
export async function main(argv: string[], gh: GhClient = createGhCliClient()): Promise<number> {
  const command = argv[0]
  const summaryPath = optionalArg(argv, '--summary-file') ?? process.env.GITHUB_STEP_SUMMARY
  if (command === 'report') {
    const upstreamSha = argValue(argv, '--upstream-sha')
    const files = argValue(argv, '--conflict-files').split(',').map(part => part.trim()).filter(part => part.length > 0)
    const classified = classifyMergeResult({ exitCode: 1, unmergedFiles: files })
    if (classified.kind !== 'text-conflict') {
      throw new Error('upstream-sync-block: refusing to record a known merge conflict (' + classified.kind + (classified.kind === 'merge-error' ? ': ' + classified.detail : '') + ')')
    }
    const issue = await findConflictIssue(gh)
    const recorded = issue === null ? null : parseBlockState(issue.body)
    const decision = await applyConflictReport(gh, decideConflictReport({
      upstreamSha,
      files: classified.files,
      fingerprint: classified.fingerprint,
      recorded,
      issueNumber: issue?.number ?? null,
    }))
    writeJobSummary(summaryPath, summaryForReport(decision))
    return decision.failJob ? 1 : 0
  }
  if (command === 'resolve') {
    const reason = argValue(argv, '--reason')
    if (reason !== 'in-sync' && reason !== 'pr-prepared') {
      throw new Error('upstream-sync-block: --reason must be in-sync or pr-prepared')
    }
    const upstreamSha = argValue(argv, '--upstream-sha')
    const decision = await resolveConflictIssue(gh, { reason, upstreamSha })
    writeJobSummary(summaryPath, summaryForResolve(decision, upstreamSha))
    return 0
  }
  throw new Error('upstream-sync-block: expected report or resolve')
}

if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) {
  try {
    process.exit(await main(process.argv.slice(2)))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(message)
    process.exit(1)
  }
}
