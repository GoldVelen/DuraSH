/** Browser-safe view of the Host's sole global instruction file. @module @deepseek-ai/dsh-agent-instructions/types */

/** File state and instruction-loading limits; saving alone does not establish request admission. */
export interface GlobalRulesDocument {
  /** Actual configured path on the connected Host. */
  readonly path: string
  /** Exact UTF-8 text, including whitespace and line endings. */
  readonly content: string
  /** Opaque file snapshot fingerprint required by the next save. */
  readonly revision: string
  readonly exists: boolean
  /** Whether this plugin currently has a filesystem provider and an enabled byte budget. */
  readonly loadingEnabled: boolean
  readonly maxBytes: number
  readonly maxSourceBytes: number
}
