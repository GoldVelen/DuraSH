/** Controlled Host saves and request assertions for the global-rules recorded session. */
import { strict as assert } from 'node:assert'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '../../src/global-rules.ts'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-llm'

export const name = 'global-rules-refresh-fixture'
export const inject = ['globalRules', 'llm', 'tools']

/**
 * Save through the production Host service and inspect each actual replay-model request.
 * @param ctx - isolated headless snapshot composition.
 */
export async function apply(ctx: Context): Promise<void> {
  assert.equal(process.env.DSH_SNAPSHOT, 'replay')
  const original = await ctx.globalRules.read()
  assert.equal(original.path, join(process.cwd(), '.dsh', 'AGENTS.md'))
  assert.equal(original.exists, false)
  await ctx.globalRules.save('GLOBAL_SNAPSHOT_OLD', original.revision)
  let requestIndex = 0
  ctx.on('llm/stream', (options, next) => {
    const text = JSON.stringify(options.messages)
    assert.equal(options.provider, 'grok')
    assert.equal(options.model, 'grok-4')
    assert.ok(text.includes('PROJECT_SNAPSHOT_RULE'))
    if (requestIndex === 0) {
      assert.ok(text.includes('GLOBAL_SNAPSHOT_OLD'))
      assert.ok(!text.includes('GLOBAL_SNAPSHOT_NEW'))
    } else if (requestIndex === 1) {
      assert.ok(text.includes('GLOBAL_SNAPSHOT_NEW'))
      assert.ok(!text.includes('GLOBAL_SNAPSHOT_OLD'))
      assert.ok(text.includes('NESTED_SNAPSHOT_RULE'))
    } else if (requestIndex === 2) {
      assert.ok(!text.includes('GLOBAL_SNAPSHOT_OLD'))
      assert.ok(!text.includes('GLOBAL_SNAPSHOT_NEW'))
      assert.ok(text.includes('NESTED_SNAPSHOT_RULE'))
    } else {
      throw new Error('Unexpected fourth request in the global rules snapshot')
    }
    requestIndex += 1
    return next()
  })
  ctx.on('tools/post-execute', async (exec, result, next) => {
    const downstream = await next()
    if (exec.name !== 'read' || result.isError) return downstream
    assert.equal(typeof exec.arguments, 'object')
    const path = (exec.arguments as { file_path?: string }).file_path
    const snapshot = await ctx.globalRules.read()
    if (path === 'nested/first.txt') await ctx.globalRules.save('GLOBAL_SNAPSHOT_NEW', snapshot.revision)
    else if (path === 'nested/second.txt') await ctx.globalRules.save('', snapshot.revision)
    else throw new Error(`Unexpected read in the global rules snapshot: ${path}`)
    return downstream
  })
}
