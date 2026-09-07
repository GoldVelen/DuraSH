/**
 * Independent DuraSH tool-catalog expectations. Names are authored here, not
 * copied from the harvest result of the same run.
 */

import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import {
  assertManifestComplete,
} from '../../../../scripts/gen-tool-catalog.ts'
import {
  collectDurashToolCatalog,
  DURASH_TOOL_PACKAGE_GLOBS,
  DURASH_TOOL_PACKAGES,
} from '../../../../scripts/gen-durash-tool-catalog.ts'

const root = resolve(import.meta.dirname, '../../../..')

describe('DuraSH tool catalog', () => {
  it('harvests the authored DuraSH tool names', async () => {
    const catalog = await collectDurashToolCatalog()
    const names = catalog.flatMap(entry => entry.schemas.map(schema => schema.name)).sort()
    expect(names).toEqual(['dsh_reliability_handoff'])
    expect(catalog.map(entry => entry.pkg)).toEqual(['@durash/dsh-tool-reliability'])
  })

  it('fails when a DuraSH tool package is missing from the DuraSH boot list', () => {
    expect(() => {
      assertManifestComplete([], root, DURASH_TOOL_PACKAGE_GLOBS)
    }).toThrow(/durash-tool-reliability/)
    expect(() => {
      assertManifestComplete(DURASH_TOOL_PACKAGES, root, DURASH_TOOL_PACKAGE_GLOBS)
    }).not.toThrow()
  })
})
