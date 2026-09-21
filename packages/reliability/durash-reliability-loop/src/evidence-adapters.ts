/** Fail-closed parsers and POSIX probes for system-observed implementation evidence. */
import { createHash } from 'node:crypto'
import { posix } from 'node:path'
import { XMLParser, XMLValidator } from 'fast-xml-parser'
import type { ContentIdentity, EvidenceIO, IOSBundleIdentity, IOSIdentity, SourceIdentity, TestChangeRisk, TestCounts } from './evidence-adapter-types.ts'

function quote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

async function run(io: EvidenceIO, command: string, cwd: string, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted()
  const result = await io.run(command, cwd, signal)
  signal.throwIfAborted()
  if (result.incomplete || result.exitCode !== 0) throw new Error(`Evidence probe failed or incomplete: ${command}`)
  return result.stdout
}

function hash(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function contentIdentity(files: Record<string, string>): ContentIdentity {
  return { files, digest: hash(JSON.stringify(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)))) }
}

function safeRelative(path: string): boolean {
  return path.length > 0 && !posix.isAbsolute(path) && !path.includes('\0') && !path.includes('\\') && !path.split('/').includes('..') && !/[:*?\[\]]/.test(path)
}

/** Observe file modes in one POSIX probe before reading each file's bytes. */
async function fileIdentities(io: EvidenceIO, cwd: string, paths: string[], signal: AbortSignal): Promise<Record<string, string>> {
  const absolutePaths = paths.map(path => posix.resolve(cwd, path))
  const ancestors = new Set<string>()
  for (const absolute of absolutePaths) {
    const segments = absolute.split('/').filter(Boolean)
    for (let index = 0; index < segments.length; index++) ancestors.add('/' + segments.slice(0, index + 1).join('/'))
  }
  const command = `for dsh_evidence_path in ${[...ancestors].map(quote).join(' ')}; do test ! -L "$dsh_evidence_path" || exit 1; done
for dsh_evidence_path in ${absolutePaths.map(quote).join(' ')}; do
  if test -f "$dsh_evidence_path"; then
    if test -x "$dsh_evidence_path"; then printf '100755\\n'; else printf '100644\\n'; fi
  elif test ! -e "$dsh_evidence_path"; then printf 'deleted\\n'; else exit 1; fi
done`
  const modes = (await run(io, command, cwd, signal)).trim().split('\n')
  if (modes.length !== paths.length) throw new Error('Incomplete file mode evidence')
  const files: Record<string, string> = {}
  for (const [index, path] of paths.entries()) {
    const mode = modes[index]
    if (mode === 'deleted') { files[path] = 'deleted'; continue }
    if (mode !== '100644' && mode !== '100755') throw new Error('Unrecognized file mode')
    const bytes = await io.read(posix.resolve(cwd, path), signal)
    signal.throwIfAborted()
    files[path] = hash(`${mode}\0${hash(bytes)}`)
  }
  return files
}

/**
 * Capture declared Git inputs at invocation time, including dirty/untracked contents and deletions.
 * @param io Agent-owned filesystem and command services.
 * @param cwd Repository root; subdirectory roots are refused to prevent ambiguous scopes.
 * @param scope Explicit relative files/directories without Git patterns. Ignored inputs must be listed as individual files.
 * @param signal Cancels all probes.
 * @returns Content identity with the HEAD label separately retained for diagnostics.
 */
export async function captureSource(io: EvidenceIO, cwd: string, scope: string[], signal: AbortSignal): Promise<SourceIdentity> {
  if (!scope.length || scope.some(path => !safeRelative(path))) throw new Error('Source scope must contain explicit relative paths')
  const root = (await run(io, 'git rev-parse --show-toplevel', cwd, signal)).trim()
  if (posix.normalize(root) !== posix.resolve(cwd)) throw new Error('Source cwd must be the Git repository root')
  const head = (await run(io, 'git rev-parse --verify HEAD', cwd, signal)).trim()
  if (!/^[a-f\d]{40,64}$/i.test(head)) throw new Error('Git HEAD is unavailable')
  const scopes = [...new Set(scope.map(path => posix.normalize(path)))]
  const listing = await run(io, `git ls-files --cached --others --exclude-standard -z -- ${scopes.map(quote).join(' ')}`, cwd, signal)
  const paths = [...new Set(listing.split('\0').filter(Boolean))].sort()
  const contains = (item: string, path: string) => item === '.' || path === item || path.startsWith(`${item}/`)
  for (const path of paths) {
    if (!safeRelative(path) || !scopes.some(item => contains(item, path))) throw new Error('Git returned a path outside source scope')
  }
  // Git omits ignored files: only individually declared regular files may supplement its listing.
  const uncovered = scopes.filter(item => !paths.some(path => contains(item, path)))
  const files = await fileIdentities(io, cwd, [...new Set([...paths, ...uncovered])].sort(), signal)
  for (const path of uncovered) {
    if (files[path] === 'deleted') throw new Error(`Source scope selects no files: ${path}`)
  }
  return { head, ...contentIdentity(files) }
}

/**
 * Hash explicit files or directories, including ignored build outputs, without following symlinks.
 * @param io Agent-owned filesystem and command services.
 * @param cwd Execution directory in the same POSIX world as paths.
 * @param paths Explicit absolute or relative file/directory paths.
 * @param signal Cancels all probes.
 * @returns Content identity; missing, empty, or unreadable artifacts reject.
 */
export async function capturePaths(io: EvidenceIO, cwd: string, paths: string[], signal: AbortSignal): Promise<ContentIdentity> {
  if (!paths.length || paths.some(path => !path || path.includes('\0'))) throw new Error('Artifact paths are required')
  const selected = new Set<string>()
  for (const path of [...new Set(paths)].sort()) {
    const absolute = posix.resolve(cwd, path)
    const links = await run(io, `find ${quote(absolute)} -type l -print -quit`, cwd, signal)
    if (links) throw new Error('Symbolic links are not supported in artifact evidence')
    const listing = await run(io, `find ${quote(absolute)} -type f -print0`, cwd, signal)
    const entries = listing.split('\0').filter(Boolean).sort()
    if (!entries.length) throw new Error('Artifact selects no files')
    for (const entry of entries) {
      if (entry !== absolute && !entry.startsWith(`${absolute}/`)) throw new Error('Artifact listing escaped its declared path')
      selected.add(entry)
    }
  }
  const files = await fileIdentities(io, cwd, [...selected].sort(), signal)
  if (Object.values(files).includes('deleted')) throw new Error('Artifact disappeared during capture')
  return contentIdentity(files)
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an evidence object')
  return value as Record<string, unknown>
}

function items(value: unknown): unknown[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value]
}

function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Invalid evidence count')
  return value
}

function xmlDocument(xml: string, preserveOrder = false): unknown {
  if (/<!ENTITY/i.test(xml) || /<!DOCTYPE[^>]*\[/i.test(xml)) throw new Error('XML entity declarations are not supported')
  if (XMLValidator.validate(xml) !== true) throw new Error('Malformed evidence XML')
  const parser = new XMLParser({
    ignoreAttributes: false, parseAttributeValue: false, parseTagValue: false, preserveOrder, processEntities: false,
  })
  return parser.parse(xml) as unknown
}

function suiteCounts(value: unknown): TestCounts & {
  failures: number
  errors: number
  skips: Array<{ testId: string; reason: string }>
  testIds: string[]
} {
  const suite = object(value)
  const skips: Array<{ testId: string; reason: string }> = []
  const testIds: string[] = []
  const result = { tests: 0, passed: 0, failed: 0, skipped: 0, failures: 0, errors: 0, skips, testIds }
  for (const child of items(suite.testsuite)) {
    const nested = suiteCounts(child)
    for (const key of ['tests', 'passed', 'failed', 'skipped', 'failures', 'errors'] as const) result[key] += nested[key]
    result.skips.push(...nested.skips)
    result.testIds.push(...nested.testIds)
  }
  for (const testcase of items(suite.testcase)) {
    const node = testcase === '' ? {} : object(testcase)
    const failed = node.failure !== undefined || node.error !== undefined
    const skipped = node.skipped !== undefined
    const owner = node['@_classname'] || suite['@_name'] || ''
    if (typeof owner !== 'string') throw new Error('Invalid testcase owner')
    if (typeof node['@_name'] === 'string' && node['@_name'].trim()) result.testIds.push(JSON.stringify([owner, node['@_name']]))
    if ((failed && skipped) || (node.failure !== undefined && node.error !== undefined)) throw new Error('Conflicting testcase outcomes')
    if (node.failure !== undefined) result.failures++
    if (node.error !== undefined) result.errors++
    result.tests++
    if (failed) result.failed++
    else if (skipped) {
      const name = text(node['@_name'], 'skipped testcase name')
      const skip = typeof node.skipped === 'string' ? { '#text': node.skipped } : object(node.skipped)
      const reason = text(skip['@_message'] || skip['#text'], 'skipped testcase reason')
      result.skipped++
      result.skips.push({ testId: JSON.stringify([owner, name]), reason })
    }
    else result.passed++
  }
  for (const attribute of ['tests', 'skipped', 'failures', 'errors'] as const) {
    const declared = suite[`@_${attribute}`]
    if (declared !== undefined && (typeof declared !== 'string' || !/^\d+$/.test(declared) || Number(declared) !== result[attribute])) throw new Error(`JUnit ${attribute} disagrees with testcases`)
  }
  return result
}

/**
 * Parse pytest JUnit testcase outcomes and cross-check declared totals.
 * @param xml Complete XML artifact captured from execution.
 * @returns Counts with errors included in failed and skips separate from passed.
 */
export function parseJUnit(xml: string): TestCounts {
  const document = object(xmlDocument(xml))
  const roots = Object.keys(document).filter(key => !key.startsWith('?'))
  if (roots.length !== 1 || (roots[0] !== 'testsuites' && roots[0] !== 'testsuite')) throw new Error('Unknown JUnit root')
  const result = suiteCounts(document[roots[0]])
  if (!result.tests) throw new Error('JUnit has no testcase evidence')
  const identities = new Map<string, number>()
  for (const id of result.testIds) identities.set(id, (identities.get(id) ?? 0) + 1)
  if (result.skips.some(skip => identities.get(skip.testId) !== 1)) throw new Error('Duplicate skipped testcase identity')
  return { tests: result.tests, passed: result.passed, failed: result.failed, skipped: result.skipped, skips: result.skips }
}

/**
 * Parse xcresulttool test-results summary (schema 0.4); unknown/contradictory results reject.
 * @param json Decoded output from xcrun xcresulttool get test-results summary.
 * @param testTree Decoded test-results tests tree, required when the summary contains skips or expected failures.
 * @returns Counts and individually identified observed skips; absent reasons reject.
 */
export function parseXcresult(json: unknown, testTree?: unknown): TestCounts {
  const value = object(json)
  const tests = count(value.totalTestCount)
  const passed = count(value.passedTests)
  const failed = count(value.failedTests)
  const skipped = count(value.skippedTests) + count(value.expectedFailures)
  if (!tests || tests !== passed + failed + skipped) throw new Error('Inconsistent xcresult counts')
  if (!['Passed', 'Failed', 'Skipped', 'Expected Failure'].includes(String(value.result))) throw new Error('Unknown xcresult result')
  if ((value.result === 'Failed') !== (failed > 0) || (value.result === 'Skipped' && skipped !== tests) || (value.result === 'Expected Failure' && value.expectedFailures !== tests)) throw new Error('xcresult result disagrees with test counts')
  const skips = skipped ? xcresultSkips(testTree) : []
  if (skips.length !== skipped || new Set(skips.map(skip => skip.testId)).size !== skips.length) throw new Error('xcresult skip details disagree with summary')
  return { tests, passed, failed, skipped, skips }
}

/** Read only identified test cases and their actual skip-message nodes, never container totals. */
function xcresultSkips(value: unknown): Array<{ testId: string; reason: string }> {
  const tree = object(value)
  if (!Array.isArray(tree.testNodes)) throw new Error('xcresult skipped tests require the tests tree')
  const skipped: Array<{ testId: string; reason: string }> = []
  const identities = new Map<string, number>()
  const reasons = (value: unknown): string[] => {
    const node = object(value)
    const messages: string[] = []
    if (node.nodeType === 'Skip Message' || node.nodeType === 'Expected Failure') {
      const message = text(node.details || node.name, 'xcresult skip reason')
      if (/^(?:Skipped|Skip Message|Expected Failure)$/i.test(message.trim())) throw new Error('xcresult skip reason is unavailable')
      messages.push(message)
    }
    if (node.children !== undefined && !Array.isArray(node.children)) throw new Error('Invalid xcresult children')
    for (const child of items(node.children)) messages.push(...reasons(child))
    return messages
  }
  const visit = (value: unknown) => {
    const node = object(value)
    const identifier = node.nodeIdentifier || node.nodeIdentifierURL
    if (node.nodeType === 'Test Case' && typeof identifier === 'string') identities.set(identifier, (identities.get(identifier) ?? 0) + 1)
    if (node.nodeType === 'Test Case' && (node.result === 'Skipped' || node.result === 'Expected Failure')) {
      const testId = text(node.nodeIdentifier || node.nodeIdentifierURL, 'xcresult skipped test identity')
      const observed = [...new Set(reasons(node))]
      if (!observed.length) throw new Error('xcresult skipped test has no observed reason')
      skipped.push({ testId, reason: observed.join('\n') })
      return
    }
    if (node.children !== undefined && !Array.isArray(node.children)) throw new Error('Invalid xcresult children')
    for (const child of items(node.children)) visit(child)
  }
  for (const node of tree.testNodes) visit(node)
  if (skipped.some(skip => identities.get(skip.testId) !== 1)) throw new Error('Ambiguous xcresult skipped test identity')
  return skipped
}

/** Decode Git's C-style pathname quoting, including octal UTF-8 bytes. */
function diffPath(header: string): string {
  if (!header.startsWith('"')) return header
  if (!header.endsWith('"')) throw new Error('Incomplete quoted Git path')
  const chunks: Uint8Array[] = []
  const escapes: Record<string, string> = { a: '\x07', b: '\b', t: '\t', n: '\n', v: '\v', f: '\f', r: '\r', '"': '"', '\\': '\\' }
  const body = header.slice(1, -1)
  let offset = 0
  for (const match of body.matchAll(/\\([0-7]{1,3}|[abtnvfr"\\])|([^\\]+)/g)) {
    if (match.index !== offset) throw new Error('Unknown Git path escape')
    offset += match[0].length
    const escape = match[1]
    chunks.push(escape === undefined ? Buffer.from(match[0]) : /^[0-7]/.test(escape)
      ? Uint8Array.of(Number.parseInt(escape, 8)) : Buffer.from(escapes[escape] ?? ''))
  }
  if (offset !== body.length) throw new Error('Incomplete Git path escape')
  return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))
}

/**
 * Mark changed verification lines for independent semantic review; matches are not verdicts.
 * @param diff Complete unified diff against the task baseline.
 * @returns Changed lines with owning paths and review categories.
 */
export function scanTestChanges(diff: string): TestChangeRisk[] {
  let path = ''
  const risks: TestChangeRisk[] = []
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ') || line.startsWith('--- ')) {
      const name = diffPath(line.slice(4))
      if (name.startsWith('a/') || name.startsWith('b/')) path = name.slice(2)
      continue
    }
    if (!path || !/^[+-](?![+-])/.test(line)) continue
    if (!/(?:test|spec)/i.test(path) && !/\b(?:assert\w*|expect|XCT\w*|pytest)\b|\.skip\s*\(/.test(line)) continue
    const added = line.startsWith('+')
    const record = (kind: string) => risks.push({ path, kind, line })
    if (added && /\b(?:skip(?:ped|if)?|xfail|XCTSkip(?:If|Unless)?)\b|\.skip\s*\(/i.test(line)) record('skip-expanded')
    if (!added && /\b(?:assert\w*|expect|XCTAssert\w*|toBe\w*|toEqual|toMatch\w*)\b/.test(line)) record('assertion-removed')
    if (added && /\breturn\b/.test(line)) record('early-return')
    if (added && /\bfirstMatch\b|\.first\s*\(|\.contains\s*\(|toMatch\s*\(/.test(line)) record('ambiguous-match')
    if (added && /\b(?:log|logs|cache|UserDefaults|internalState)\b/i.test(line)) record('internal-state-evidence')
  }
  return risks
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing ${field}`)
  return value
}

function plistEntitlements(xml: string): Record<string, unknown> {
  const document = items(xmlDocument(xml, true)).map(object)
  const root = document.find(node => node.plist !== undefined)
  const dict = items(root?.plist).map(object).find(node => node.dict !== undefined)
  const nodes = items(dict?.dict).map(object)
  if (!nodes.length) throw new Error('Missing signed entitlement dictionary')
  const result: Record<string, unknown> = {}
  const nodeText = (node: unknown): string => text(items(node).map(object)[0]?.['#text'], 'entitlement value')
  for (let index = 0; index < nodes.length; index += 2) {
    const key = nodeText(nodes[index]?.key)
    const value = nodes[index + 1]
    if (!value) throw new Error('Missing entitlement value')
    if (Object.hasOwn(result, key)) throw new Error('Duplicate entitlement key')
    if (value.string !== undefined) result[key] = nodeText(value.string)
    else if (value.array !== undefined) result[key] = items(value.array).map(object).map(item => nodeText(item.string))
  }
  return result
}

async function bundleIdentity(io: EvidenceIO, cwd: string, path: string, signal: AbortSignal): Promise<IOSBundleIdentity> {
  const info = object(JSON.parse(await run(io, `plutil -convert json -o - ${quote(posix.join(path, 'Info.plist'))}`, cwd, signal)) as unknown)
  const entitlements = plistEntitlements(await run(io, `codesign -d --entitlements :- ${quote(path)}`, cwd, signal))
  const bundleId = text(info.CFBundleIdentifier, 'bundle identifier')
  const applicationId = text(entitlements['application-identifier'], 'signed application identifier')
  if (!applicationId.endsWith(`.${bundleId}`)) throw new Error('Signed application identifier differs from bundle identifier')
  const groups = entitlements['com.apple.security.application-groups']
  if (!Array.isArray(groups) || groups.some(group => typeof group !== 'string')) throw new Error('Missing signed App Groups')
  return { path, bundleId, applicationId, version: text(info.CFBundleShortVersionString, 'bundle version'), build: text(info.CFBundleVersion, 'bundle build'), groups: groups as string[], digest: (await capturePaths(io, cwd, [path], signal)).digest }
}

/**
 * Observe local App/embedded Widget metadata, entitlements, and bundle bytes without device access.
 * @param io Agent-owned filesystem and command services with macOS plutil and codesign.
 * @param options Explicit paths to the locally readable App and its embedded Widget.
 * @param signal Cancels all probes.
 * @returns Artifact coherence plus identities; callers still compare the expected installation/target.
 */
export async function captureIOSIdentity(
  io: EvidenceIO,
  options: { cwd: string; appPath: string; widgetPath: string },
  signal: AbortSignal,
): Promise<IOSIdentity> {
  const appPath = posix.resolve(options.cwd, options.appPath)
  const widgetPath = posix.resolve(options.cwd, options.widgetPath)
  if (posix.dirname(widgetPath) !== posix.join(appPath, 'PlugIns') || !widgetPath.endsWith('.appex')) throw new Error('Widget must be embedded in the selected App')
  const app = await bundleIdentity(io, options.cwd, appPath, signal)
  const widget = await bundleIdentity(io, options.cwd, widgetPath, signal)
  const sharedGroups = app.groups.filter(group => widget.groups.includes(group)).sort()
  const reasons: string[] = []
  if (app.version !== widget.version || app.build !== widget.build) reasons.push('App and Widget build/version differ')
  if (!sharedGroups.length) reasons.push('App and Widget have no shared App Group')
  if (app.applicationId.slice(0, -app.bundleId.length) !== widget.applicationId.slice(0, -widget.bundleId.length)) reasons.push('App and Widget signing teams differ')
  return { adapter: 'ios-local-bundle', app, widget, sharedGroups, consistent: reasons.length === 0, reasons }
}
