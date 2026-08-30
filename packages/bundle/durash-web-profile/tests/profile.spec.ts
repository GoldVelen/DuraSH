import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'

interface PatchInsert {
  insert?: Array<{ id?: string; name?: string }>
}

describe('DuraSH Web profile overlay', () => {
  it('adds only the product-owned brand row', () => {
    const path = resolve(import.meta.dirname, '../cordis.patch.yml')
    const document = yaml.load(readFileSync(path, 'utf8')) as PatchInsert[]

    expect(document).toEqual([{
      insert: [{
        id: 'ui-brand-durash',
        name: '@durash/dsh-client-ui-brand',
      }],
    }])
  })
})
