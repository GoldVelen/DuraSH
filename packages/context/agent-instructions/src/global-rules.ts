/**
 * Host-owned editing of the same global file used by instruction discovery.
 * @module @deepseek-ai/dsh-agent-instructions/global-rules
 */

import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { access, chmod, lstat, mkdir, mkdtemp, readFile, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type {} from '@deepseek-ai/dsh-fs'
import type { ResolvedConfig } from './config.ts'
import type { GlobalRulesDocument } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * A Host editor committed changed global rule text. Carries no rule body.
     * @mode emit
     * @param path - absolute configured rule file path.
     */
    'global-rules/saved'(path: string): void
  }
  interface Context {
    /** Editor for the configured Host global instruction file. */
    globalRules: GlobalRules
  }
}

/** Refusal to replace a file that changed after it was read. */
export class GlobalRulesConflict extends Error {
  /** Stable refusal code mapped by the Host settings controller. */
  readonly code = 'GLOBAL_RULES_CONFLICT'

  constructor(readonly expected: string, readonly actual: string) {
    super('Global rules changed on the Host. Reload the file before saving again.')
  }
}

interface Snapshot {
  document: GlobalRulesDocument
  mode: number
  symlink: boolean
}

/** Atomic, revision-checked editor; it never stores a second copy of rule text. */
export class GlobalRules extends Service {
  /** Number of committed content changes observed for this Host file. */
  private currentGeneration = 0

  /** Number of committed content changes observed for this Host file. */
  get generation(): number {
    return this.currentGeneration
  }
  private readonly path: string

  constructor(ctx: Context, private readonly config: ResolvedConfig) {
    super(ctx, 'globalRules')
    this.path = join(config.dshHome, 'AGENTS.md')
    ctx.on('global-rules/saved', (path) => {
      if (path === this.path) this.currentGeneration += 1
    })
  }

  /**
   * Read the configured file without creating it; missing files have empty content.
   * @returns exact text, file revision, and current loading limits.
   * @throws Error when the file cannot be read or is not valid UTF-8.
   */
  async read(): Promise<GlobalRulesDocument> {
    return (await this.snapshot()).document
  }

  /**
   * Replace exact text after checking the caller's revision before and after staging under the writer lock.
   * Retains permission bits independently of umask; symlink targets are readable but cannot be replaced.
   * @param content - complete next UTF-8 text, without normalization.
   * @param expectedRevision - fingerprint returned by the caller's last read.
   * @returns the committed file state; this is not a model-admission receipt.
   * @throws GlobalRulesConflict when the file changed, or Error on permission and storage failures.
   */
  async save(content: string, expectedRevision: string): Promise<GlobalRulesDocument> {
    if (Buffer.from(content, 'utf8').toString('utf8') !== content) {
      throw new Error('Global rules contain invalid Unicode and cannot be saved without changing the text.')
    }
    await mkdir(this.config.dshHome, { recursive: true, mode: 0o700 })
    return withFileLock(this.path, async () => {
      const before = await this.snapshot()
      if (before.document.revision !== expectedRevision) {
        throw new GlobalRulesConflict(expectedRevision, before.document.revision)
      }
      if (before.symlink) throw new Error(`Global rules cannot be saved through a symbolic link: ${this.path}`)
      if (before.document.exists && before.document.content === content) return before.document
      if (before.document.exists) await access(this.path, constants.W_OK)
      const stagingDirectory = await mkdtemp(join(this.config.dshHome, '.global-rules-'))
      const stagingPath = join(stagingDirectory, 'AGENTS.md')
      try {
        await writeFileAtomic(stagingPath, content, { mode: before.mode, dirMode: 0o700 })
        await chmod(stagingPath, before.mode)
        const current = await this.snapshot()
        if (current.document.revision !== expectedRevision) {
          throw new GlobalRulesConflict(expectedRevision, current.document.revision)
        }
        // The final check covers staging-time edits; non-cooperating writers
        // still have the filesystem's unavoidable check-to-rename race.
        await rename(stagingPath, this.path)
        if (before.document.content !== content) this.ctx.emit('global-rules/saved', this.path)
        return await this.read()
      } finally {
        await rm(stagingDirectory, { recursive: true, force: true })
      }
    })
  }

  private async snapshot(): Promise<Snapshot> {
    let entry
    try {
      entry = await lstat(this.path, { bigint: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const revision = createHash('sha256').update(this.path).update('\0missing').digest('hex')
      return { document: this.document('', revision, false), mode: 0o600, symlink: false }
    }
    const target = entry.isSymbolicLink() ? await stat(this.path, { bigint: true }) : entry
    if (!target.isFile()) throw new Error(`Global rules path is not a regular file: ${this.path}`)
    const bytes = await readFile(this.path)
    const content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
    const revision = createHash('sha256')
      .update(this.path).update('\0')
      .update([entry.dev, entry.ino, entry.mtimeNs, entry.ctimeNs,
        target.dev, target.ino, target.mtimeNs, target.ctimeNs].join(':'))
      .update(bytes).digest('hex')
    return {
      document: this.document(content, revision, true),
      mode: Number(target.mode & 0o777n),
      symlink: entry.isSymbolicLink(),
    }
  }

  private document(content: string, revision: string, exists: boolean): GlobalRulesDocument {
    return {
      path: this.path, content, revision, exists,
      loadingEnabled: this.ctx.get('fs') !== undefined && Number.isFinite(this.config.maxBytes) && this.config.maxBytes > 0,
      maxBytes: Number.isFinite(this.config.maxBytes) ? this.config.maxBytes : 0,
      maxSourceBytes: this.config.maxSourceBytes,
    }
  }
}
