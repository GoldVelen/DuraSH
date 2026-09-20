import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'

/**
 * Keyless smoke for SOURCE `dsh` execution: run `apps/cli/src/bin.ts`
 * with the exact production runtime vector (`node --import tsx/esm`, the
 * vector the root `dsh` script invokes directly) and assert the
 * required-config diagnostic and profile-loaded tool identity. The Node
 * compatibility matrix runs this WHOLE file, so a Node release changing module
 * hooks or TypeScript handling breaks this gate instead of every developer's
 * `pnpm dsh`; the built-bin
 * suite covers the published `lib/` entry, not this source chain.
 */

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const dshSourceBin = 'apps/cli/src/bin.ts'

describe('dsh SOURCE launcher (node --import tsx/esm)', () => {
  it('launches the source CLI without building', async () => {
    const rootPackage = JSON.parse(await readFile(new URL('../../../package.json', import.meta.url), 'utf8')) as {
      readonly scripts?: Record<string, string>
    }
    expect(rootPackage.scripts?.dsh).toBe('node --import tsx/esm apps/cli/src/bin.ts')
  })

  it('boots the source entry and requires a profile', async () => {
    const result = await execa(process.execPath, ['--import', 'tsx/esm', dshSourceBin], {
      cwd: repoRoot,
      input: '',
      timeout: 25_000,
      killSignal: 'SIGKILL',
      reject: false,
    })
    if (result.timedOut) {
      throw new Error(`dsh source launch did not exit within 25s. stdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
    }
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('--profile <name> is required')
    expect(result.stdout).toBe('')
  }, 30_000)

  it('shares the source tool scheduler with profile-loaded plugins', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-source-scheduler-'))
    try {
      const probe = join(root, 'scheduler.mjs')
      const patch = join(root, 'cordis.patch.yml')
      const toolsSource = pathToFileURL(join(repoRoot, 'packages/core/tools/src/index.ts')).href
      await writeFile(probe, `
import { TOOL_RUNTIME_SCHEDULER } from ${JSON.stringify(toolsSource)};
export const name = 'source-scheduler-probe';
export const inject = ['tools', 'appReady', 'appExit'];
export function apply(ctx) {
  ctx.effect(() => ctx.appReady.onReady(() => {
    const scheduler = ctx.tools[TOOL_RUNTIME_SCHEDULER];
    console.log(JSON.stringify({ sharedScheduler: typeof scheduler?.prepare === 'function' }));
    ctx.appExit(0);
  }));
}
`)
      await writeFile(patch, JSON.stringify([
        { id: 'acp', disabled: true },
        { insert: [{ id: 'source-scheduler-probe', name: probe }] },
      ]))
      const result = await execa(process.execPath, [
        '--import', 'tsx/esm', dshSourceBin, '--profile', 'acp', '--patch', patch,
      ], {
        cwd: repoRoot,
        env: {
          DSH_HOME: join(root, 'home'),
          DSH_AGENTS_HOME: join(root, 'agents'),
          DSH_TELEMETRY_DISABLED: '1',
          TSX_TSCONFIG_PATH: undefined,
        },
        input: '',
        timeout: 25_000,
        killSignal: 'SIGKILL',
        reject: false,
      })
      expect(result.timedOut, result.stderr).toBe(false)
      expect(result.signal, result.stderr).toBeUndefined()
      expect(result.exitCode, result.stderr).toBe(0)
      expect(result.stdout.trim()).toBe('{"sharedScheduler":true}')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 30_000)
})
