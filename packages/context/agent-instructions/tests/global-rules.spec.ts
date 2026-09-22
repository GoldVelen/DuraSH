import { chmod, mkdtemp, mkdir, readFile, readdir, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { resolveConfig } from '../src/config.ts'
import { GlobalRules } from '../src/global-rules.ts'

vi.mock('@deepseek-ai/dsh-atomic-write', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@deepseek-ai/dsh-atomic-write')>()
  return { ...actual, writeFileAtomic: vi.fn(actual.writeFileAtomic) }
})
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, chmod: vi.fn(actual.chmod), rename: vi.fn(actual.rename) }
})

const roots: string[] = []
const contexts: Context[] = []

async function setup(homeSuffix = '') {
  const root = await mkdtemp(join(tmpdir(), 'dsh-global-rules-'))
  roots.push(root)
  const home = join(root, homeSuffix)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(GlobalRules, resolveConfig({ dshHome: home, maxBytes: 8192 }))
  return { root, home, ctx, rules: ctx.globalRules, path: join(home, 'AGENTS.md') }
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('Host global rules file editing', () => {
  it('reads original UTF-8 text and retains BOM, CRLF, and trailing whitespace after replacement', async () => {
    const { rules, path } = await setup()
    const original = '\uFEFF原有规则\r\n  preserve  \r\n\r\n'
    await writeFile(path, original, { mode: 0o640 })
    const before = await rules.read()
    expect(before).toMatchObject({ path, content: original, exists: true, loadingEnabled: false })
    expect(await rules.save(original, before.revision)).toEqual(before)
    expect(rules.generation).toBe(0)
    const content = '\uFEFF新的规则\r\n\t保留尾部  '
    const saved = await rules.save(content, before.revision)
    expect(saved.content).toBe(content)
    expect(await readFile(path, 'utf8')).toBe(content)
    expect(rules.generation).toBe(1)
    if (process.platform !== 'win32') expect((await stat(path)).mode & 0o777).toBe(0o640)
  })

  it('leaves a missing configured home absent until the first save', async () => {
    const { rules, home, path } = await setup('custom/home')
    const before = await rules.read()
    expect(before).toMatchObject({ path, content: '', exists: false })
    await expect(stat(home)).rejects.toMatchObject({ code: 'ENOENT' })
    const saved = await rules.save('', before.revision)
    expect(saved.exists).toBe(true)
    expect(await readFile(path, 'utf8')).toBe('')
    expect(rules.generation).toBe(0)
  })

  // POSIX permission bits are not implemented on Windows. This file runs
  // sequentially in an isolated fork; restore its process-wide mask before teardown.
  it.skipIf(process.platform === 'win32').each([0o000, 0o022, 0o077])(
    'retains existing permission bits when saving under umask %i', async (mask) => {
      const { rules, path } = await setup()
      await writeFile(path, 'original')
      await chmod(path, 0o660)
      const before = await rules.read()
      const originalMask = process.umask(mask)
      try {
        await rules.save('replacement', before.revision)
        expect((await stat(path)).mode & 0o777).toBe(0o660)
        expect(await readFile(path, 'utf8')).toBe('replacement')
      } finally {
        process.umask(originalMask)
      }
      expect(process.umask(originalMask)).toBe(originalMask)
    },
  )

  it.skipIf(process.platform === 'win32')('creates owner-only rules under a permissive umask', async () => {
    const { rules, path } = await setup()
    const before = await rules.read()
    const originalMask = process.umask(0o000)
    try {
      await rules.save('first rules', before.revision)
      expect((await stat(path)).mode & 0o777).toBe(0o600)
    } finally {
      process.umask(originalMask)
    }
    expect(process.umask(originalMask)).toBe(originalMask)
  })

  it('preserves the original file and generation when restoring replacement permissions fails', async () => {
    const { rules, path, home } = await setup()
    await writeFile(path, 'original')
    const before = await rules.read()
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    vi.mocked(chmod).mockRejectedValueOnce(Object.assign(new Error('chmod refused'), { code: 'EPERM' }))
    try {
      await expect(rules.save('replacement', before.revision)).rejects.toThrow('chmod refused')
      expect(await rules.read()).toEqual(before)
      expect(rules.generation).toBe(0)
      expect(await readdir(home)).toEqual(['AGENTS.md'])
    } finally {
      vi.mocked(chmod).mockReset().mockImplementation(actual.chmod)
    }
  })

  it('binds missing-file revisions to the configured path', async () => {
    const first = await setup('first-home')
    const second = await setup('second-home')
    const before = await first.rules.read()
    await expect(second.rules.save('intended for first home', before.revision))
      .rejects.toMatchObject({ code: 'GLOBAL_RULES_CONFLICT' })
    await expect(stat(second.path)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects external edits and deletion without replacing either state', async () => {
    const { rules, path } = await setup()
    await writeFile(path, 'original')
    const before = await rules.read()
    await writeFile(path, 'external change')
    await expect(rules.save('editor change', before.revision)).rejects.toMatchObject({ code: 'GLOBAL_RULES_CONFLICT' })
    expect(await readFile(path, 'utf8')).toBe('external change')
    const changed = await rules.read()
    await rm(path)
    await expect(rules.save('editor change', changed.revision)).rejects.toMatchObject({ code: 'GLOBAL_RULES_CONFLICT' })
    await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(rules.generation).toBe(0)
  })

  it('rejects an external edit made while the replacement is being prepared', async () => {
    const { rules, path, home } = await setup()
    await writeFile(path, 'original')
    const before = await rules.read()
    const actual = await vi.importActual<typeof import('@deepseek-ai/dsh-atomic-write')>('@deepseek-ai/dsh-atomic-write')
    vi.mocked(writeFileAtomic).mockImplementationOnce(async (...args) => {
      await writeFile(path, 'external edit during staging')
      await actual.writeFileAtomic(...args)
    })
    await expect(rules.save('editor replacement', before.revision))
      .rejects.toMatchObject({ code: 'GLOBAL_RULES_CONFLICT' })
    expect(await readFile(path, 'utf8')).toBe('external edit during staging')
    expect(rules.generation).toBe(0)
    expect(await readdir(home)).toEqual(['AGENTS.md'])
  })

  it('does not publish a generation or successful save when the final rename fails', async () => {
    const { rules, path, home } = await setup()
    await writeFile(path, 'original')
    const before = await rules.read()
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    vi.mocked(rename).mockImplementationOnce(actual.rename)
      .mockRejectedValueOnce(Object.assign(new Error('final rename refused'), { code: 'EACCES' }))
    await expect(rules.save('editor replacement', before.revision)).rejects.toThrow('final rename refused')
    expect(await readFile(path, 'utf8')).toBe('original')
    expect(rules.generation).toBe(0)
    expect(await readdir(home)).toEqual(['AGENTS.md'])
  })

  it('serializes independent writers and rejects the stale revision', async () => {
    const { rules, home, path } = await setup()
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(GlobalRules, resolveConfig({ dshHome: home, maxBytes: 8192 }))
    const before = await rules.read()
    const results = await Promise.allSettled([
      rules.save('one', before.revision),
      ctx.globalRules.save('two', before.revision),
    ])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const rejection = results.find(result => result.status === 'rejected')
    expect(rejection).toMatchObject({ reason: { code: 'GLOBAL_RULES_CONFLICT' } })
    expect(['one', 'two']).toContain(await readFile(path, 'utf8'))
  })

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('preserves text on real file permission refusals', async () => {
    const { rules, path } = await setup()
    await writeFile(path, 'protected original', { mode: 0o400 })
    const before = await rules.read()
    await expect(rules.save('replacement', before.revision)).rejects.toMatchObject({ code: 'EACCES' })
    expect(await readFile(path, 'utf8')).toBe('protected original')
    await chmod(path, 0o000)
    try {
      await expect(rules.read()).rejects.toMatchObject({ code: 'EACCES' })
    } finally {
      await chmod(path, 0o600)
    }
    expect(rules.generation).toBe(0)
  })

  it('does not replace a symbolic link or its original target when saving', async () => {
    const { rules, root, path } = await setup()
    const target = join(root, 'original.md')
    await writeFile(target, 'linked rules')
    await symlink(target, path)
    const before = await rules.read()
    expect(before.content).toBe('linked rules')
    await expect(rules.save('overwrite', before.revision)).rejects.toThrow('symbolic link')
    expect(await readFile(target, 'utf8')).toBe('linked rules')
    expect(rules.generation).toBe(0)
  })

  it('reports invalid UTF-8 and non-file paths as read failures', async () => {
    const { rules, path } = await setup()
    await writeFile(path, Buffer.from([0xff, 0xfe]))
    await expect(rules.read()).rejects.toThrow()
    await rm(path)
    await mkdir(path)
    await expect(rules.read()).rejects.toThrow('not a regular file')
  })

  it('reports unwritable hierarchy and invalid Unicode without saving', async () => {
    const { rules, home } = await setup('invalid-parent')
    const before = await rules.read()
    await writeFile(home, 'occupied')
    await expect(rules.save('rules', before.revision)).rejects.toThrow()
    await expect(rules.save('\ud800', before.revision)).rejects.toThrow('invalid Unicode')
    expect(rules.generation).toBe(0)
  })

  it('removes its service when the plugin is unloaded', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-global-rules-'))
    roots.push(root)
    const ctx = new Context()
    contexts.push(ctx)
    const fiber = ctx.plugin(GlobalRules, resolveConfig({ dshHome: root, maxBytes: 0 }))
    await fiber
    expect(ctx.get('globalRules')).toBeDefined()
    await fiber.dispose()
    expect(ctx.get('globalRules')).toBeUndefined()
  })
})
