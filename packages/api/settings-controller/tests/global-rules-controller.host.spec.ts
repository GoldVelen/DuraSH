import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentPresets, { serviceForScope } from '@deepseek-ai/dsh-agent-presets'
import * as AgentInstructions from '@deepseek-ai/dsh-agent-instructions'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { GlobalRules } from '@deepseek-ai/dsh-agent-instructions/src/global-rules.ts'
import { resolveConfig } from '@deepseek-ai/dsh-agent-instructions/src/config.ts'
import SettingsController from '../src/index.ts'

const roots: string[] = []
const contexts: Context[] = []
async function boot(mount = true) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-global-rules-api-'))
  roots.push(root)
  const ctx = new Context()
  contexts.push(ctx)
  if (mount) await ctx.plugin(GlobalRules, resolveConfig({ dshHome: root, maxBytes: 8192 }))
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


describe('the settings API reading a Loader-mounted default preset', () => {
  it('opens the same isolated instruction service before any session exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-global-preset-api-'))
    roots.push(root)
    const ctx = new Context()
    contexts.push(ctx)
    const home = join(root, 'configured-home')
    const presetRoot = join(root, 'presets')
    const presetDir = join(presetRoot, 'ordinary')
    await mkdir(home)
    await mkdir(presetDir, { recursive: true })
    const path = join(home, 'AGENTS.md')
    await writeFile(path, 'original preset rules')
    await writeFile(join(presetDir, 'agent.cordis.yml'), `- id: instructions
  name: cordis:instructions
  isolate:
    globalRules: true
  config:
    dshHome: ${JSON.stringify(home)}
    maxBytes: 8192
`)
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, `- name: cordis:sessionProjection
- name: cordis:localFs
  config:
    cwd: ${JSON.stringify(root)}
- name: cordis:presets
  config:
    default: ordinary
    includeShippedRoot: false
    includeUserRoot: false
    roots:
      - path: ${JSON.stringify(presetRoot)}
        trust: user
- name: cordis:settingsController
`)
    ctx.baseUrl = pathToFileURL(root).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    ctx.loader.builtins.instructions = AgentInstructions
    ctx.loader.builtins.sessionProjection = SessionProjectionRegistry
    ctx.loader.builtins.localFs = LocalFileSystem
    ctx.loader.builtins.presets = AgentPresets
    ctx.loader.builtins.settingsController = SettingsController
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await ctx.loader.await()
    expect(ctx.get('globalRules')).toBeUndefined()
    const initial = await ctx.settingsController.readGlobalRules()
    expect(initial).toMatchObject({ path, content: 'original preset rules', loadingEnabled: true })
    const key = await ctx.agentPresets.standingKeyFor()
    const provider = serviceForScope(ctx, key, 'globalRules')
    expect(provider).toBeDefined()
    const saved = await ctx.settingsController.saveGlobalRules('updated preset rules', initial!.revision)
    expect(await provider!.read()).toEqual(saved)
    expect(await readFile(path, 'utf8')).toBe('updated preset rules')
    expect(ctx.get('globalRules')).toBeUndefined()
    expect(ctx.get('agents')).toBeUndefined()
  })
})
