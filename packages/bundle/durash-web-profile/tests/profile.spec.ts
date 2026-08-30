import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'

interface PatchInsert {
  insert?: Array<{ id?: string; name?: string }>
  id?: string
  disabled?: boolean
}

describe('DuraSH Web profile overlay', () => {
  it('adds the product-owned brand and reliability rows and re-enables the workflow engine', () => {
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
        ],
      },
      {
        id: 'workflow-worker-thread',
        disabled: false,
      },
    ])
  })
})
