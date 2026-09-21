/** Observed filesystem and command capabilities supplied by the executing agent's services. */
export interface EvidenceIO {
  /**
   * Run in the agent's execution world; incomplete includes timeout, abort, and output truncation.
   * @param command POSIX command text.
   * @param cwd Execution directory in the same world as read.
   * @param signal Cancels execution.
   * @returns Observed output and settlement, with optional original executor metadata.
   */
  run(command: string, cwd: string, signal: AbortSignal): Promise<{
    exitCode: number | null
    stdout: string
    stderr: string
    incomplete: boolean
    raw?: unknown
  }>
  /**
   * Read exact bytes in the same world as run.
   * @param path Absolute input path.
   * @param signal Cancels the read.
   * @returns Unmodified file contents.
   */
  read(path: string, signal: AbortSignal): Promise<Uint8Array>
}

/** Content identity independent of a commit label. */
export interface ContentIdentity {
  digest: string
  files: Record<string, string>
}

/** Git label observed alongside the declared source contents. */
export interface SourceIdentity extends ContentIdentity {
  head: string
}

/** Parsed outcomes; skipped never contributes to passed. */
export interface TestCounts {
  tests: number
  passed: number
  failed: number
  skipped: number
  /** Individual observed skip identities and reasons; old aggregate-only receipts omit this. */
  skips?: Array<{ testId: string; reason: string }>
}

/** Changed test line requiring semantic review, not a correctness verdict. */
export interface TestChangeRisk {
  path: string
  kind: string
  line: string
}

/** Locally readable bundle metadata and exact content identity. */
export interface IOSBundleIdentity {
  path: string
  bundleId: string
  version: string
  build: string
  applicationId: string
  groups: string[]
  digest: string
}

/** Artifact coherence only: does not assert installation or user-visible behavior. */
export interface IOSIdentity {
  adapter: 'ios-local-bundle'
  app: IOSBundleIdentity
  widget: IOSBundleIdentity
  sharedGroups: string[]
  consistent: boolean
  reasons: string[]
}
