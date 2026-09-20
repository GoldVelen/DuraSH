import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import yaml from 'js-yaml'
import { composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { describe, expect, it } from 'vitest'

interface PatchInsert {
  insert?: Array<{ id?: string; name?: string }>
  id?: string
  disabled?: boolean
}

describe('DuraSH Web profile overlay', () => {
  it('composes the shipped layers with a live PTC workflow engine and its runtime', () => {
    const layers = ['base', 'web-app', 'durash-web-profile'].map(name =>
      loadOverlayPatches('durash profile test', resolve(import.meta.dirname, '../../', name, 'cordis.patch.yml')))
    const entries = composeEntries(layers)
    const workflow = entries.find(entry => entry.id === 'workflow-ptc')
    const runtime = entries.find(entry => entry.id === 'ptc-runtime')
    expect(workflow).toMatchObject({ name: '@deepseek-ai/dsh-workflow-ptc', disabled: false })
    expect(runtime).toMatchObject({ name: '@deepseek-ai/dsh-ptc-runtime-node' })
    expect(runtime?.disabled).not.toBe(true)
    expect(entries.find(entry => entry.id === 'tool-workflow')?.disabled).toBe(true)
    expect(entries.find(entry => entry.id === 'tool-ralph')?.disabled).toBe(true)
  })

  it('adds the product-owned brand, reliability engine, workflow switch, and re-enables the workflow engine', () => {
    const path = resolve(import.meta.dirname, '../cordis.patch.yml')
    const document = yaml.load(readFileSync(path, 'utf8')) as PatchInsert[]

    expect(document).toEqual([
      {
        insert: [
          {
            id: 'ui-brand-durash',
            name: '@durash/dsh-client-ui-brand',
          },
          {
            id: 'reliability-loop',
            name: '@durash/dsh-reliability-loop',
          },
          {
            id: 'reliability-policy',
            name: '@durash/dsh-reliability-policy',
          },
          {
            id: 'tool-reliability',
            name: '@durash/dsh-tool-reliability',
          },
          {
            id: 'ui-reliability',
            name: '@durash/dsh-client-ui-reliability',
          },
        ],
      },
      {
        id: 'workflow-ptc',
        disabled: false,
      },
    ])
  })
})
