/** MCP resource ownership in the shipped Desktop composition. */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { composeEntries, loadProfileDirectory } from '@deepseek-ai/dsh-app-boot'
import { createPluginProfile, desktopProfileBundles } from '../src/project-manager.ts'

it('loads the DuraSH product layer with one shared Desktop resource consumer', () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-desktop-profile-mcp-'))
  try {
    const profileDir = join(home, 'profiles', 'desktop')
    createPluginProfile(profileDir, desktopProfileBundles(['@durash/dsh-web-profile']))
    const installAnchor = fileURLToPath(new URL('../../cli/package.json', import.meta.url))
    const profile = loadProfileDirectory('dsh desktop', profileDir, installAnchor)
    expect(profile.layers.map(layer => layer.packageName)).toEqual([
      '@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@durash/dsh-web-profile',
    ])
    const warnings: string[] = []
    const rows = composeEntries([
      ...profile.layers.map(layer => layer.patches),
      profile.patches,
    ], message => warnings.push(message))

    expect(rows.filter(row => row.name === '@deepseek-ai/dsh-mcp-resources')).toEqual([
      { id: 'mcp-resources', name: '@deepseek-ai/dsh-mcp-resources' },
    ])
    expect(rows.filter(row => row.name === '@deepseek-ai/dsh-mcp-client')).toEqual([])
    expect(rows.find(row => row.id === 'webserver')).toMatchObject({ name: '@deepseek-ai/dsh-host-webserver' })
    expect(rows.find(row => row.id === 'webserver')?.disabled).not.toBe(true)
    expect(rows.find(row => row.id === 'reliability-loop')?.name).toBe('@durash/dsh-reliability-loop')
    expect(rows.find(row => row.id === 'reliability-policy')?.name).toBe('@durash/dsh-reliability-policy')
    expect(rows.find(row => row.id === 'tool-reliability')?.name).toBe('@durash/dsh-tool-reliability')
    expect(rows.find(row => row.id === 'ui-reliability')?.name).toBe('@durash/dsh-client-ui-reliability')
    expect(rows.find(row => row.id === 'ui-brand-durash')?.name).toBe('@durash/dsh-client-ui-brand')
    expect(rows.find(row => row.id === 'workflow-ptc')?.disabled).toBe(false)
    expect(warnings).toEqual([])
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
