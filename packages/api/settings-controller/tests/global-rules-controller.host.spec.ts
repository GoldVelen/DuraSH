import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GlobalRules } from '@deepseek-ai/dsh-agent-instructions/src/global-rules.ts'
import { resolveDiscoveryConfig } from '@deepseek-ai/dsh-agent-instructions/src/config.ts'
import SettingsController from '../src/index.ts'

const roots: string[] = []
const contexts: Context[] = []
async function boot(mount = true) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-global-rules-api-'))
  roots.push(root)
  const ctx = new Context()
  contexts.push(ctx)
  if (mount) await ctx.plugin(GlobalRules, {
    ...resolveDiscoveryConfig({ dshHome: root }),
    maxBytes: 8192,
    maxSourceBytes: 1024 * 1024,
  })
  await ctx.plugin(SettingsController)
  return { ctx, controller: ctx.settingsController, path: join(root, 'AGENTS.md') }
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('global rules through the settings Remote API', () => {
  it('reads and writes only the configured Host file without a settings provider', async () => {
    const { controller, path } = await boot()
    await writeFile(path, 'existing rules\r\n')
    const initial = await controller.readGlobalRules()
    expect(initial).toMatchObject({ path, content: 'existing rules\r\n', exists: true })
    const saved = await controller.saveGlobalRules('exact replacement  ', initial!.revision)
    expect(saved.content).toBe('exact replacement  ')
    expect(await readFile(path, 'utf8')).toBe(saved.content)
    expect(saved.loadingEnabled).toBe(false)
  })

  it('reports a missing plugin independently of file existence', async () => {
    const { controller } = await boot(false)
    expect(await controller.readGlobalRules()).toBe(null)
    await expect(controller.saveGlobalRules('rules', 'missing')).rejects.toMatchObject({ code: 'global-rules/rejected' })
  })

  it('classifies stale editor writes as conflicts and preserves external edits', async () => {
    const { controller, path } = await boot()
    const initial = await controller.readGlobalRules()
    await writeFile(path, 'external change')
    await expect(controller.saveGlobalRules('editor change', initial!.revision)).rejects.toMatchObject({
      code: 'global-rules/conflict', details: { expected: initial!.revision },
    })
    expect(await readFile(path, 'utf8')).toBe('external change')
  })

  it('surfaces read and write permission refusals without success responses', async () => {
    const { controller, ctx } = await boot()
    const initial = await controller.readGlobalRules()
    vi.spyOn(ctx.globalRules, 'read').mockRejectedValueOnce(new Error('EACCES: read denied'))
    await expect(controller.readGlobalRules()).rejects.toMatchObject({ code: 'global-rules/rejected', message: 'EACCES: read denied' })
    vi.spyOn(ctx.globalRules, 'save').mockRejectedValueOnce(new Error('EACCES: write denied'))
    await expect(controller.saveGlobalRules('rules', initial!.revision)).rejects.toMatchObject({ code: 'global-rules/rejected', message: 'EACCES: write denied' })
  })
})
