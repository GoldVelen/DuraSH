import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export type UpstreamSyncMode = 'primary-merge' | 'vendored-review'

interface SourceEntryBase {
  id: string
  name: string
  baseline: string
  release?: string
  recordedIn?: string
  snapshotBaseline?: string
  syncMode: UpstreamSyncMode
}

export interface GitHubSourceEntry extends SourceEntryBase {
  kind: 'github'
  repository: string
  ref: string
}

export interface NpmSourceEntry extends SourceEntryBase {
  kind: 'npm'
  package: string
  sourceRepository: string
}

export type SourceEntry = GitHubSourceEntry | NpmSourceEntry

export interface SourceManifest {
  formatVersion: 1
  sources: SourceEntry[]
  registryDependencies: {
    sourceOfTruth: string[]
    updateOwner: string
  }
}

export type UpstreamStatus = SourceEntry & {
  latest: string
  inSync: boolean
}

interface GitHubCommitResponse {
  sha?: unknown
}

interface NpmPackageResponse {
  version?: unknown
}

const ROOT = resolve(import.meta.dirname, '..')
export const MANIFEST_PATH = resolve(ROOT, 'UPSTREAM_SOURCES.json')
const SHA_PATTERN = /^[0-9a-f]{40}$/u
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value === '') throw new Error(`${label} must be a non-empty string`)
  return value
}

/** Parse and validate the committed source manifest. */
export function parseSourceManifest(text: string): SourceManifest {
  const raw: unknown = JSON.parse(text)
  if (!isRecord(raw) || raw.formatVersion !== 1 || !Array.isArray(raw.sources)) {
    throw new Error('UPSTREAM_SOURCES.json must use formatVersion 1 and contain a sources array')
  }
  const ids = new Set<string>()
  const sources = raw.sources.map((value, index): SourceEntry => {
    if (!isRecord(value)) throw new Error(`sources[${String(index)}] must be an object`)
    const id = requireString(value.id, `sources[${String(index)}].id`)
    if (ids.has(id)) throw new Error(`duplicate upstream source id ${JSON.stringify(id)}`)
    ids.add(id)
    const kind = value.kind
    const baselineValue = requireString(value.baseline, `${id}.baseline`)
    if (value.syncMode !== 'primary-merge' && value.syncMode !== 'vendored-review') {
      throw new Error(`${id}.syncMode must be primary-merge or vendored-review`)
    }
    const syncMode: UpstreamSyncMode = value.syncMode
    const common = {
      id,
      name: requireString(value.name, `${id}.name`),
      baseline: baselineValue,
      ...(typeof value.release === 'string' ? { release: value.release } : {}),
      ...(typeof value.recordedIn === 'string' ? { recordedIn: value.recordedIn } : {}),
      ...(typeof value.snapshotBaseline === 'string' ? { snapshotBaseline: value.snapshotBaseline.toLowerCase() } : {}),
      syncMode,
    }
    if (common.snapshotBaseline !== undefined && !SHA_PATTERN.test(common.snapshotBaseline)) {
      throw new Error(`${id}.snapshotBaseline must be a full Git commit SHA`)
    }
    if (kind === 'github') {
      const repository = requireString(value.repository, `${id}.repository`)
      const baseline = baselineValue.toLowerCase()
      if (!REPOSITORY_PATTERN.test(repository)) throw new Error(`${id}.repository must be owner/repo`)
      if (!SHA_PATTERN.test(baseline)) throw new Error(`${id}.baseline must be a full Git commit SHA`)
      return { ...common, kind, repository, ref: requireString(value.ref, `${id}.ref`), baseline }
    }
    if (kind === 'npm') {
      const sourceRepository = requireString(value.sourceRepository, `${id}.sourceRepository`)
      if (!REPOSITORY_PATTERN.test(sourceRepository)) throw new Error(`${id}.sourceRepository must be owner/repo`)
      if (!VERSION_PATTERN.test(baselineValue)) throw new Error(`${id}.baseline must be an exact npm version`)
      return { ...common, kind, package: requireString(value.package, `${id}.package`), sourceRepository }
    }
    throw new Error(`${id}.kind must be github or npm`)
  })
  const primary = sources.filter(source => source.syncMode === 'primary-merge')
  if (primary.length !== 1 || primary[0]?.kind !== 'github') {
    throw new Error('UPSTREAM_SOURCES.json must contain exactly one primary-merge source')
  }
  if (!isRecord(raw.registryDependencies)
    || !Array.isArray(raw.registryDependencies.sourceOfTruth)
    || !raw.registryDependencies.sourceOfTruth.every(value => typeof value === 'string')
    || typeof raw.registryDependencies.updateOwner !== 'string') {
    throw new Error('registryDependencies must declare sourceOfTruth and updateOwner')
  }
  return {
    formatVersion: 1,
    sources,
    registryDependencies: {
      sourceOfTruth: [...raw.registryDependencies.sourceOfTruth] as string[],
      updateOwner: raw.registryDependencies.updateOwner,
    },
  }
}

/** Compare one recorded source with the latest resolved commit. */
export function upstreamStatus(source: SourceEntry, latest: string): UpstreamStatus {
  const normalized = source.kind === 'github' ? latest.toLowerCase() : latest
  if (source.kind === 'github' && !SHA_PATTERN.test(normalized)) {
    throw new Error(`${source.id}: latest commit must be a full Git SHA`)
  }
  if (source.kind === 'npm' && !VERSION_PATTERN.test(normalized)) {
    throw new Error(`${source.id}: latest npm release must be an exact version`)
  }
  return { ...source, latest: normalized, inSync: normalized === source.baseline }
}

async function fetchLatestRevision(source: SourceEntry, fetchImpl: typeof fetch = fetch): Promise<string> {
  const headers: Record<string, string> = {
    'User-Agent': 'durash-upstream-check',
  }
  let url: string
  if (source.kind === 'github') {
    headers.Accept = 'application/vnd.github+json'
    headers['X-GitHub-Api-Version'] = '2022-11-28'
    const token = process.env.GITHUB_TOKEN
    if (token !== undefined && token !== '') headers.Authorization = `Bearer ${token}`
    url = `https://api.github.com/repos/${source.repository}/commits/${encodeURIComponent(source.ref)}`
  } else {
    headers.Accept = 'application/json'
    url = `https://registry.npmjs.org/${encodeURIComponent(source.package)}/latest`
  }
  const response = await fetchImpl(url, { headers })
  if (!response.ok) {
    const target = source.kind === 'github' ? `${source.repository}@${source.ref}` : source.package
    throw new Error(`${source.kind} request failed for ${target}: ${String(response.status)} ${response.statusText}`)
  }
  const payload = await response.json() as GitHubCommitResponse & NpmPackageResponse
  return source.kind === 'github'
    ? requireString(payload.sha, `${source.id} GitHub response sha`)
    : requireString(payload.version, `${source.id} npm response version`)
}

/** Resolve every source concurrently without changing the committed baselines. */
export async function inspectUpstreams(
  manifest: SourceManifest,
  fetchImpl: typeof fetch = fetch,
): Promise<UpstreamStatus[]> {
  return Promise.all(manifest.sources.map(async source =>
    upstreamStatus(source, await fetchLatestRevision(source, fetchImpl))))
}

/** Replace only the primary source baseline in a validated manifest. */
export function withPrimaryBaseline(manifest: SourceManifest, baseline: string): SourceManifest {
  const normalized = baseline.toLowerCase()
  if (!SHA_PATTERN.test(normalized)) throw new Error('primary baseline must be a full Git commit SHA')
  return {
    ...manifest,
    sources: manifest.sources.map(source => source.syncMode === 'primary-merge'
      ? { ...source, baseline: normalized }
      : source),
  }
}

function renderTable(rows: readonly UpstreamStatus[]): string {
  const lines = [
    '| Source | Kind | Policy | Target | Recorded | Latest | Status |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ]
  for (const row of rows) {
    const target = row.kind === 'github' ? `${row.repository}@${row.ref}` : row.package
    const recorded = row.kind === 'github' ? row.baseline.slice(0, 12) : row.baseline
    const latest = row.kind === 'github' ? row.latest.slice(0, 12) : row.latest
    lines.push(`| ${row.name} | ${row.kind} | ${row.syncMode} | ${target} | \`${recorded}\` | \`${latest}\` | ${row.inSync ? 'up-to-date' : 'drift'} |`)
  }
  return lines.join('\n')
}

async function main(): Promise<void> {
  const manifest = parseSourceManifest(readFileSync(MANIFEST_PATH, 'utf8'))
  const writeAt = process.argv.indexOf('--write-primary-baseline')
  if (writeAt !== -1) {
    const baseline = process.argv[writeAt + 1]
    if (baseline === undefined) throw new Error('--write-primary-baseline requires a full SHA')
    writeFileSync(MANIFEST_PATH, `${JSON.stringify(withPrimaryBaseline(manifest, baseline), null, 2)}\n`)
    console.log(`updated primary upstream baseline to ${baseline.toLowerCase()}`)
    return
  }

  const rows = await inspectUpstreams(manifest)
  console.log(process.argv.includes('--json') ? JSON.stringify(rows, null, 2) : renderTable(rows))
  if (process.argv.includes('--fail-on-primary-drift')
    && rows.some(row => row.syncMode === 'primary-merge' && !row.inSync)) {
    process.exitCode = 1
  }
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) await main()
