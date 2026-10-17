/** Reject maintained references to repository commits and the disallowed organization URL. */

import { execFileSync } from 'node:child_process'
import { lstatSync, readFileSync, readlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { parseSourceManifest } from './check-upstream-sources.ts'
import { canonicalReferenceText } from './verify-public-repository-links.ts'

const root = resolve(import.meta.dirname, '..')
const organization = ['deepseek', 'harness'].join('-')
const organizationUrl = new RegExp(`\\bgithub\\.com/${organization}(?![a-z0-9-])`)
// The independent kit repository owns the engine source and documentation.
const kitRepositoryUrl = new RegExp(`\\bgithub\\.com/${organization}/libreoffice-kit(?:\\.git)?(?=/|[^a-zA-Z0-9_.-]|$)`, 'g')
const commitCandidate = /(?<![a-z0-9])[\da-f]{7,40}(?![a-z0-9])/gi
const excludedPrefixes = ['vendor/', '.agents/notes/archived/']
const gitOutputLimit = 64 * 1024 * 1024
// One 41-byte line per object; 1.2 million objects produce about 49 MiB.
const objectListingLimit = 1024 * 1024 * 1024

/** One prohibited reference in a maintained source file. */
export interface RepositoryReference {
  /** Repository-relative path, with forward slashes. */
  file: string
  /** One-based source line containing the reference. */
  line: number
  /** Whether the line names a repository commit or the disallowed organization URL. */
  kind: 'commit-hash' | 'organization-url'
}

function isMaintained(file: string): boolean {
  return !excludedPrefixes.some(prefix => file.startsWith(prefix))
}

/** Select one unambiguous JSON property without accepting similarly named nested fields. */
function jsonProperty(object: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  const properties = object.properties.filter((property): property is ts.PropertyAssignment =>
    ts.isPropertyAssignment(property) && ts.isStringLiteral(property.name) && property.name.text === name)
  return properties.length === 1 ? properties[0]?.initializer : undefined
}

/** Hide only validated machine-owned source revisions while preserving diagnostic line numbers. */
function commitReferenceSource(file: string, source: string): string {
  if (file !== 'UPSTREAM_SOURCES.json') return source
  try {
    parseSourceManifest(source)
  } catch {
    // An invalid source manifest has no machine-owned revision fields to exempt.
    return source
  }
  const parsed = ts.parseJsonText(file, source)
  const object = parsed.statements[0]?.expression
  if (object === undefined || !ts.isObjectLiteralExpression(object)) return source
  const sources = jsonProperty(object, 'sources')
  if (sources === undefined || !ts.isArrayLiteralExpression(sources)) return source
  const revisions: ts.StringLiteral[] = []
  for (const entry of sources.elements) {
    if (!ts.isObjectLiteralExpression(entry)) continue
    const kind = jsonProperty(entry, 'kind')
    const fields = kind !== undefined && ts.isStringLiteral(kind) && kind.text === 'github'
      ? ['baseline', 'snapshotBaseline']
      : ['snapshotBaseline']
    for (const field of fields) {
      const value = jsonProperty(entry, field)
      if (value !== undefined && ts.isStringLiteral(value) && /^[\da-f]{40}$/i.test(value.text)) revisions.push(value)
    }
  }
  for (const revision of revisions.reverse()) {
    const start = revision.getStart(parsed)
    source = source.slice(0, start) + ' '.repeat(revision.end - start) + source.slice(revision.end)
  }
  return source
}

/**
 * Inspect a maintained source file against known commit identifiers.
 * @param file - Repository-relative path used in diagnostics and exclusions.
 * @param source - File text or a symlink's stored target.
 * @param commits - Lowercase, unambiguous full or abbreviated commit identifiers.
 * @returns One finding per line and reference kind; digests, other Git object types, and validated upstream revision fields are accepted.
 */
export function findRepositoryReferences(
  file: string,
  source: string,
  commits: ReadonlySet<string>,
): RepositoryReference[] {
  if (!isMaintained(file)) return []
  const references: RepositoryReference[] = []
  const commitLines = commitReferenceSource(file, source).split('\n')
    .map(line => [...line.matchAll(commitCandidate)].some(match => commits.has(match[0].toLowerCase())))
  for (const [index, line] of source.split('\n').entries()) {
    if (organizationUrl.test(canonicalReferenceText(line).replace(kitRepositoryUrl, ''))) {
      references.push({ file, line: index + 1, kind: 'organization-url' })
    }
    if (commitLines[index]) {
      references.push({ file, line: index + 1, kind: 'commit-hash' })
    }
  }
  return references
}

function readMaintainedFiles(repoRoot: string): Map<string, string> {
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: gitOutputLimit,
  }).split('\0').filter(file => file !== '' && isMaintained(file))
  const sources = new Map<string, string>()
  for (const file of files) {
    const path = resolve(repoRoot, file)
    const stat = lstatSync(path, { throwIfNoEntry: false })
    if (stat?.isSymbolicLink() === true) sources.set(file, readlinkSync(path))
    else if (stat?.isFile() === true) sources.set(file, readFileSync(path, 'utf8'))
  }
  return sources
}

function gitLines(repoRoot: string, args: readonly string[], maxBuffer: number, input?: string): string[] {
  const output = execFileSync('git', args, {
    cwd: repoRoot,
    env: { ...process.env, GIT_NO_LAZY_FETCH: '1' },
    encoding: 'utf8',
    input,
    maxBuffer,
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trimEnd()
  return output === '' ? [] : output.split('\n')
}

/**
 * Find the one object whose name starts with a prefix.
 * @param objects - Every object name in the local object database, sorted.
 * @param prefix - Lowercase hexadecimal prefix.
 * @returns The matching object name, or `undefined` when none or several match.
 */
export function uniquePrefixMatch(objects: readonly string[], prefix: string): string | undefined {
  let low = 0
  let high = objects.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if ((objects[middle] ?? prefix) < prefix) low = middle + 1
    else high = middle
  }
  const match = objects[low]
  if (match?.startsWith(prefix) !== true || objects[low + 1]?.startsWith(prefix) === true) return undefined
  return match
}

/**
 * Resolve commit-identifier candidates in maintained sources against the local object database.
 * @param repoRoot - Working tree whose Git objects are inspected.
 * @param sources - File texts or symlink targets to extract candidates from.
 * @returns Lowercase candidates that name exactly one available object, which is a commit.
 */
export function repositoryCommits(repoRoot: string, sources: Iterable<string>): Set<string> {
  const candidates = [...new Set([...sources].flatMap(source =>
    [...source.matchAll(commitCandidate)].map(match => match[0].toLowerCase())))]
  if (candidates.length === 0) return new Set()
  // Git resolves prefixes across all available objects, including unreachable and alternate ones;
  // one listing of those objects replaces one Git prefix lookup per candidate.
  // Ambiguous prefixes do not identify one object and cannot establish a commit reference.
  const objects = gitLines(repoRoot, ['cat-file', '--batch-all-objects', '--batch-check=%(objectname)'], objectListingLimit).sort()
  const matches = new Map<string, string>()
  for (const candidate of candidates) {
    // A bare decimal run is a measurement — a file size, a version, a wheel length —
    // far more often than a Git object name, and its short prefixes collide often.
    if (/^[0-9]+$/.test(candidate)) continue
    const object = uniquePrefixMatch(objects, candidate)
    if (object !== undefined) matches.set(candidate, object)
  }
  if (matches.size === 0) return new Set()
  const matched = [...new Set(matches.values())]
  const commits = new Set(gitLines(repoRoot, ['cat-file', '--batch-check=%(objectname) %(objecttype)'], gitOutputLimit, `${matched.join('\n')}\n`)
    .map(line => line.split(' '))
    .filter(([, type]) => type === 'commit')
    .map(([object]) => object))
  return new Set([...matches].filter(([, object]) => commits.has(object)).map(([candidate]) => candidate))
}

/**
 * Scan tracked and nonignored new files using only the local Git object database.
 * @param repoRoot - Working tree whose files and Git objects are inspected.
 * @returns Prohibited references outside vendor and frozen Agent Notes; absent shallow-history objects cannot match.
 */
export function scanRepositoryReferences(repoRoot: string): RepositoryReference[] {
  const sources = readMaintainedFiles(repoRoot)
  const commits = repositoryCommits(repoRoot, sources.values())
  return [...sources].flatMap(([file, source]) => findRepositoryReferences(file, source, commits))
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && import.meta.url === pathToFileURL(resolve(invokedPath)).href) {
  const references = scanRepositoryReferences(root)
  if (references.length === 0) {
    console.log('verify-repository-references: maintained files contain no repository commit identifiers or disallowed organization URLs.')
  } else {
    console.error('verify-repository-references: use release tags or maintained repository links:')
    for (const { file, line, kind } of references) console.error(`  ${file}:${String(line)} ${kind}`)
    process.exitCode = 1
  }
}
