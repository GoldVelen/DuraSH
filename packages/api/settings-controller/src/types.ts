/**
 * Browser-safe failure vocabulary of the configuration surfaces this package
 * serves. The redacted views themselves live with their seam in
 * `@deepseek-ai/dsh-settings/types`, whose Cordis event declarations already
 * register that file for the Client compilation face.
 *
 * @module @deepseek-ai/dsh-api-settings-controller/types
 */

/** Stable settings failure details returned by the `settings` namespace. */
export interface SettingsErrorDetailsMap {
  /**
   * Every seam refusal that is not a stale write: an unregistered or malformed
   * namespace, a read-only provider, schema validation, storage.
   */
  'settings-rejected': { readonly ns: string }
  /**
   * The stored revision moved after the caller read it. Its own outcome rather
   * than an invalid request: the caller must re-read and re-apply.
   */
  'settings-conflict': { readonly ns: string; readonly expected: number; readonly actual: number }
}

/** Settings business failure carried by a rejected Remote call. */
export type SettingsError = {
  [Code in keyof SettingsErrorDetailsMap]: {
    readonly code: Code
    readonly message: string
    readonly details: SettingsErrorDetailsMap[Code]
  }
}[keyof SettingsErrorDetailsMap]

/** Confirmation that the settings document was handed to the native editor. */
export interface SettingsDocumentOpenValue {
  readonly opened: true
}

/** Result of opening or revealing one locally authored Agent preset directory. */
export type AgentPresetDirectoryOpenValue =
  | { readonly opened: true }
  | { readonly opened: false; readonly path: string }

/** Stable credential failure details returned by the `credentials` namespace. */
export interface CredentialErrorDetailsMap {
  /**
   * The provider refused a valid write, for example because a read-only source
   * shadows the reference. The details name only the reference, never the value.
   */
  'credential-rejected': { readonly ref: string }
}

/** Credential business failure carried by a rejected Remote call. */
export type CredentialError = {
  [Code in keyof CredentialErrorDetailsMap]: {
    readonly code: Code
    readonly message: string
    readonly details: CredentialErrorDetailsMap[Code]
  }
}[keyof CredentialErrorDetailsMap]

/** Stable authorization failure details returned by the `authorization` namespace. */
export interface AuthorizationErrorDetailsMap {
  /** The requested key or prompt does not name a flow or live attempt. */
  'not-found': { readonly key: string }
  /** An attempt for the key is already running, or the prompt id is stale. */
  conflict: { readonly key: string }
}

/** Authorization business failure carried by a rejected Remote call. */
export type AuthorizationError = {
  [Code in keyof AuthorizationErrorDetailsMap]: {
    readonly code: Code
    readonly message: string
    readonly details: AuthorizationErrorDetailsMap[Code]
  }
}[keyof AuthorizationErrorDetailsMap]

/** One registered sign-in flow as the Models page lists it. */
export interface AuthorizationFlowView {
  /** The credential key the flow writes, in its joined `<scope>/<id>` form. */
  readonly key: string
  /** User-facing name of what the flow authorizes. */
  readonly label: string
  /** The ways the flow can run, most preferred first. */
  readonly methods: readonly { readonly id: string; readonly label: string }[]
  /** Whether an attempt for this key is running right now. */
  readonly inFlight: boolean
}

/** One question a flow has put to the surface, awaiting `authorization.respond`. */
export interface AuthorizationPromptView {
  /** Caller-supplied id echoed back by `respond`. */
  readonly id: string
  /** Presentation kind; `select` answers with the chosen option's id. */
  readonly kind: 'text' | 'secret' | 'select'
  readonly message: string
  readonly options?: readonly { readonly id: string; readonly label: string; readonly description?: string }[]
  readonly placeholder?: string
}

/** One controller-tracked attempt as a polling page sees it. */
export interface AuthorizationAttemptView {
  /** The joined credential key the attempt runs for. */
  readonly key: string
  /** `running` until the attempt reaches its terminal status. */
  readonly status: 'running' | 'authorized' | 'cancelled' | 'failed'
  /** What the flow has reported so far, oldest first. */
  readonly notices: readonly { readonly message: string; readonly url?: string; readonly code?: string }[]
  /** The question awaiting an answer, while one is pending. */
  readonly pendingPrompt?: AuthorizationPromptView
  /** Failure detail for a terminal `failed` attempt. */
  readonly message?: string
}

/** The `authorization.describe` snapshot: what can be signed into, and what is in flight. */
export interface AuthorizationDescribeValue {
  readonly flows: readonly AuthorizationFlowView[]
  readonly attempts: readonly AuthorizationAttemptView[]
}
