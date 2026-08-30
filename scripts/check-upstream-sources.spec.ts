import { describe, expect, it } from 'vitest'
import {
  inspectUpstreams,
  parseSourceManifest,
  upstreamStatus,
  withPrimaryBaseline,
  type SourceManifest,
} from './check-upstream-sources.ts'

const PRIMARY = 'a'.repeat(40)
const VENDORED = '1.0.0'

function manifest(): SourceManifest {
  return parseSourceManifest(JSON.stringify({
    formatVersion: 1,
    sources: [
      {
        id: 'primary',
        name: 'Primary',
        kind: 'github',
        repository: 'owner/primary',
        ref: 'master',
        baseline: PRIMARY,
        syncMode: 'primary-merge',
      },
      {
        id: 'vendor',
        name: 'Vendor',
        kind: 'npm',
        package: '@owner/vendor',
        sourceRepository: 'owner/vendor',
        baseline: VENDORED,
        recordedIn: 'vendor/README.md',
        syncMode: 'vendored-review',
      },
    ],
    registryDependencies: {
      sourceOfTruth: ['package.json'],
      updateOwner: '.github/dependabot.yml',
    },
  }))
}

describe('upstream source manifest', () => {
  it('requires one primary source, unique ids, and full commit hashes', () => {
    expect(manifest().sources).toHaveLength(2)
    expect(() => parseSourceManifest(JSON.stringify({
      formatVersion: 1,
      sources: [],
      registryDependencies: { sourceOfTruth: [], updateOwner: 'x' },
    }))).toThrow(/exactly one primary/)
    expect(() => upstreamStatus(manifest().sources[0]!, 'short')).toThrow(/full Git SHA/)
    expect(() => upstreamStatus(manifest().sources[1]!, 'latest')).toThrow(/exact version/)
  })

  it('updates only the primary baseline', () => {
    const next = 'c'.repeat(40)
    const updated = withPrimaryBaseline(manifest(), next)

    expect(updated.sources.find(source => source.id === 'primary')?.baseline).toBe(next)
    expect(updated.sources.find(source => source.id === 'vendor')?.baseline).toBe(VENDORED)
  })

  it('reports primary and vendored drift independently', async () => {
    const response = (payload: object): Response => new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
    const fetchImpl: typeof fetch = async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      return url.includes('owner/primary') ? response({ sha: PRIMARY }) : response({ version: '1.0.1' })
    }

    const rows = await inspectUpstreams(manifest(), fetchImpl)
    expect(rows.map(row => ({ id: row.id, inSync: row.inSync }))).toEqual([
      { id: 'primary', inSync: true },
      { id: 'vendor', inSync: false },
    ])
  })
})
