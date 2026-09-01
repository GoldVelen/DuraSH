import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { readVerifiedClientBuildEnvironment } from './client-build-record.ts'
import { REPO_ROOT } from './support.ts'

const DIST_ROOT = fileURLToPath(new URL('../dist', import.meta.url))
const DURASH_BUILD = readVerifiedClientBuildEnvironment(REPO_ROOT).DSH_CLIENT_BUILD_PROFILE === 'durash'

it('ships install metadata with the built web application', async () => {
  const index = await readFile(join(DIST_ROOT, 'index.html'), 'utf8')
  expect(index).toContain('<link rel="manifest" href="./manifest.webmanifest" />')

  const manifest: unknown = JSON.parse(await readFile(join(DIST_ROOT, 'manifest.webmanifest'), 'utf8'))
  expect(manifest).toEqual({
    id: '/',
    name: DURASH_BUILD ? 'DuraSH' : 'DeepSeek Harness',
    short_name: DURASH_BUILD ? 'DuraSH' : 'DSH',
    start_url: '/',
    scope: '/',
    display: 'fullscreen',
    icons: [{
      src: '/favicon.svg',
      sizes: 'any',
      type: 'image/svg+xml',
      purpose: 'any',
    }],
  })
})

it('ships the favicon selected by the complete client build', async () => {
  const favicon = await readFile(join(DIST_ROOT, 'favicon.svg'), 'utf8')
  if (DURASH_BUILD) {
    expect(favicon).toContain('<title>DuraSH</title>')
    expect(favicon).toContain('fill="#0F172A"')
    expect(favicon).toContain('fill="#E2E8F0"')
    expect(favicon).toContain('fill="#F59E0B"')
    return
  }
  // The light fill must live inside the dark-scheme media query, so the icon
  // stays black in light mode and only turns white under a dark scheme.
  expect(favicon).toMatch(/@media \(prefers-color-scheme: dark\)\s*{\s*path\s*{[^}]*fill:\s*#fff/i)
  expect(favicon).toContain('fill="#000"')
})
