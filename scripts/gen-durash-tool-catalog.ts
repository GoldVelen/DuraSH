/**
 * Generate `docs/durash-tool-catalog.md` from DuraSH product tool plugins.
 * Reuses the upstream harvest/render helpers; the boot list, completeness
 * glob, and committed page are DuraSH-owned.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as ToolReliability from '@durash/dsh-tool-reliability'
import {
  assertManifestComplete,
  collectToolCatalog,
  render,
  type ToolPackage,
} from './gen-tool-catalog.ts'

const root = resolve(import.meta.dirname, '..')
const OUT = 'docs/durash-tool-catalog.md'

export const DURASH_TOOL_PACKAGE_GLOBS = ['packages/*/durash-tool-*'] as const

/** DuraSH product tool boot list. Independent of the upstream `tool-*` manifest. */
export const DURASH_TOOL_PACKAGES: ToolPackage[] = [
  {
    pkg: '@durash/dsh-tool-reliability',
    dir: 'durash-tool-reliability',
    source: 'packages/reliability/durash-tool-reliability/src/index.ts',
    requires: [
      'ctx.tools',
      'ctx.systemPrompt',
      'ctx.agents',
      'ctx.reliabilityPolicy',
      'ctx.reliabilityLoopRuntime',
      'a live enabled root Agent at execution time',
    ],
    writes: ['tool/call', 'reliability-loop durable state and child Session events', 'tool/result'],
    async mount(ctx) {
      // Registration only needs the service identities. Execution is
      // unreachable while harvesting schemas, so inert doubles keep the
      // generator independent of storage and workflow backends.
      ctx.provide('agents', {} as never)
      ctx.provide('reliabilityPolicy', {
        workflowEnabled: () => false,
        enabledRoutes: () => undefined,
      } as never)
      ctx.provide('reliabilityLoopRuntime', {
        start: () => Promise.reject(new Error('tool-catalog reliability execution is unreachable')),
      } as never)
      await ctx.plugin(ToolReliability)
    },
    note:
      'Shipped only by the `durash` profile. Its schema is process-wide; execution fails closed unless the current Session policy is enabled with both implementation and review routes.',
  },
]

/** Harvest DuraSH product tools against the DuraSH completeness glob. */
export async function collectDurashToolCatalog() {
  return await collectToolCatalog(DURASH_TOOL_PACKAGES, root, DURASH_TOOL_PACKAGE_GLOBS)
}

/**
 * Render the harvested product tools with DuraSH-owned generator and package references.
 * @param catalog - harvested DuraSH tool packages and schemas.
 * @returns the generated DuraSH Markdown catalog.
 */
export function renderDurash(catalog: Awaited<ReturnType<typeof collectDurashToolCatalog>>): string {
  const generated = render(catalog)
  return generated
    .replaceAll('scripts/gen-tool-catalog.ts', 'scripts/gen-durash-tool-catalog.ts')
    .replaceAll('pnpm run gen-tool-catalog', 'pnpm run gen-durash-tool-catalog')
    .replaceAll('pnpm run verify-tool-catalog', 'pnpm run verify-durash-tool-catalog')
    .replaceAll('# Tool Schema Catalog', '# DuraSH Tool Schema Catalog')
    .replaceAll('`packages/*/tool-*`', '`packages/*/durash-tool-*`')
}

async function main(): Promise<void> {
  assertManifestComplete(DURASH_TOOL_PACKAGES, root, DURASH_TOOL_PACKAGE_GLOBS)
  const content = renderDurash(await collectDurashToolCatalog())
  if (process.argv.includes('--check')) {
    let committed: string | null = null
    try {
      committed = readFileSync(resolve(root, OUT), 'utf8')
    } catch {
      committed = null
    }
    if (committed === content) {
      console.log(`gen-durash-tool-catalog: ${OUT} is up to date.`)
      process.exit(0)
    }
    console.error(`gen-durash-tool-catalog: ${OUT} is stale. Run pnpm run gen-durash-tool-catalog and commit ${OUT}.`)
    process.exit(1)
  }
  writeFileSync(resolve(root, OUT), content)
  console.log(`gen-durash-tool-catalog: wrote ${OUT}.`)
}

if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) {
  await main()
}
