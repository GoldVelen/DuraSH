import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PROFILE_TEMPLATES } from '@deepseek-ai/dsh-app-boot'
import { profileTemplatesForSourceRoot } from '../src/source-build-profile.ts'

const repoRoot = resolve(import.meta.dirname, '../../..')
const repositoryManifestPath = resolve(repoRoot, 'package.json')
const clientBuildRecordPath = resolve(repoRoot, '.dsh-build/client-build-environment.json')
type SourceBuildProfileModule = typeof import('../src/source-build-profile.ts')

async function importSourceBuildProfile(record?: unknown): Promise<SourceBuildProfileModule> {
  vi.resetModules()
  vi.doMock('node:fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:fs')>()
    return {
      ...actual,
      existsSync(path: import('node:fs').PathLike) {
        if (String(path) === repositoryManifestPath) return true
        if (String(path) === clientBuildRecordPath) return record !== undefined
        return actual.existsSync(path)
      },
      readFileSync(path: import('node:fs').PathOrFileDescriptor, options?: Parameters<typeof actual.readFileSync>[1]) {
        if (String(path) === repositoryManifestPath) {
          return JSON.stringify({ name: '@deepseek-ai/dsh-root' })
        }
        if (String(path) === clientBuildRecordPath) {
          return JSON.stringify(record)
        }
        return actual.readFileSync(path, options as never)
      },
    }
  })
  const imported: unknown = await import(
    `${pathToFileURL(resolve(import.meta.dirname, '../src/source-build-profile.ts')).href}?test=${Date.now()}`,
  )
  return imported as SourceBuildProfileModule
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('source-owned profile templates', () => {
  it('adds DuraSH only when the CLI runs from the source checkout', () => {
    expect(profileTemplatesForSourceRoot(undefined)).toBe(PROFILE_TEMPLATES)
    expect(PROFILE_TEMPLATES.durash).toBeUndefined()
    expect(profileTemplatesForSourceRoot('/source').durash).toEqual({
      bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@durash/dsh-web-profile'],
      patchReload: 'live',
    })
  })
})

describe('source build profile guard', () => {
  it('refuses the durash source profile when the recorded build is official', async () => {
    const { assertSourceBuildProfile } = await importSourceBuildProfile({
      environment: { DSH_CLIENT_BUILD_PROFILE: 'official' },
    })
    expect(() => { assertSourceBuildProfile('durash') })
      .toThrow(/the durash profile refuses client build "official"/u)
  })

  it('refuses the upstream web source profile when the recorded build is durash', async () => {
    const { assertSourceBuildProfile } = await importSourceBuildProfile({
      environment: { DSH_CLIENT_BUILD_PROFILE: 'durash' },
    })
    expect(() => { assertSourceBuildProfile('web') })
      .toThrow(/the web profile refuses DuraSH client artifacts/u)
  })
})
