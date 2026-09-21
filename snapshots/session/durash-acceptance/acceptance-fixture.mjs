/** Deterministic entropy and an owned Git workspace around the real acceptance services. */
import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import { access, rm } from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { join } from 'node:path'
import { promisify } from 'node:util'

export const name = 'acceptance-fixture'
export const inject = ['agents', 'reliabilityLoopRuntime', 'reliabilityPolicy']
const execute = promisify(execFile)

/**
 * Own the temporary Git repository and restore entropy when the profile exits.
 * @param {import('@deepseek-ai/cordis').Context} ctx - scenario composition.
 */
export async function apply(ctx) {
  ctx.effect(() => {
    const original = crypto.randomUUID
    let ordinal = 0
    crypto.randomUUID = () => `10000000-0000-4000-8000-${String(++ordinal).padStart(12, '0')}`
    syncBuiltinESMExports()
    return () => { crypto.randomUUID = original; syncBuiltinESMExports() }
  }, 'acceptance-fixture.entropy')
  const cwd = process.cwd()
  const git = join(cwd, '.git')
  try {
    await access(git)
    throw new Error('Acceptance fixture refuses an existing Git directory')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  ctx.effect(() => () => rm(git, { recursive: true, force: true }), 'acceptance-fixture.git')
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'Acceptance fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Acceptance fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
    GIT_AUTHOR_DATE: '2000-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2000-01-01T00:00:00Z',
  }
  await execute('git', ['init', '--quiet', '--object-format=sha1'], { cwd, env })
  await execute('git', ['-c', 'core.autocrlf=false', 'add', '.gitignore', 'fixture.txt'], { cwd, env })
  await execute('git', ['-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'fixture input'], { cwd, env })
}
