/**
 * Host owner of the `authorization` Remote namespace: the surface half of
 * `ctx.authorization` as a browser configuration page drives it.
 *
 * `AuthorizationService.begin()` waits on a human for minutes — a device code
 * typed on a phone, a browser callback — so no request/response call carries
 * the attempt. Instead `begin` starts the attempt against a controller-held
 * interaction and returns at once; the page polls `describe` for notices and
 * the pending prompt, answers prompts with `respond`, and withdraws with
 * `cancel`. Attempt state lives here, on the Host: a second browser tab (or a
 * reloaded one) polling `describe` sees the same attempt and its outcome.
 *
 * @module @deepseek-ai/dsh-api-settings-controller/src/authorization.ts
 */

import { Context } from '@deepseek-ai/cordis'
import {
  AuthorizationDeclinedError, AuthorizationError,
  type AuthorizationEntry, type AuthorizationNotice, type AuthorizationPrompt,
} from '@deepseek-ai/dsh-authorization'
import { parseCredentialKey } from '@deepseek-ai/dsh-credentials'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import type {
  AuthorizationAttemptView, AuthorizationDescribeValue, AuthorizationPromptView,
} from './types.ts'
import { parseRemoteRequest } from './remote-request.ts'

const credentialKeySchema = z.string().regex(
  /^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/,
  'must be a "<scope>/<id>" credential key',
)
const beginRequestSchema = z.object({
  key: credentialKeySchema,
  method: z.string().min(1).optional(),
})
const respondRequestSchema = z.object({
  key: credentialKeySchema,
  promptId: z.string().min(1),
  value: z.string().min(1).optional(),
  declined: z.literal(true).optional(),
}).refine(
  request => (request.value === undefined) !== (request.declined === undefined),
  { message: 'exactly one of value or declined is required' },
)
const cancelRequestSchema = z.object({ key: credentialKeySchema })

/** Notices retained per attempt; older entries fall off as the flow reports more. */
const MAX_NOTICES = 50

type AuthorizationFailurePhase =
  | 'starting'
  | 'awaiting-provider'
  | 'committing-credential'

type NetworkMetadataField = 'code' | 'syscall' | 'hostname' | 'address' | 'port'

const REDACTED = '<redacted>'
const SAFE_TEXT = /^[A-Za-z0-9.:-]+$/u
const MAX_TEXT = 128
const MAX_CAUSE_DEPTH = 8
const MAX_NETWORK_METADATA = 4
const NETWORK_FIELDS: readonly NetworkMetadataField[] = ['code', 'syscall', 'hostname', 'address', 'port']

function redactAuthorizationText(text: string): string {
  return text
    .replace(/\bBearer\s+[^\s]+/giu, `Bearer ${REDACTED}`)
    .replace(
      /([?&](?:access_token|refresh_token|id_token|client_secret|client_assertion|code_verifier|code)=)[^&#\s]+/giu,
      `$1${REDACTED}`,
    )
    .replace(
      /("(?:access_token|refresh_token|id_token|client_secret|client_assertion|code_verifier|code)"\s*:\s*")[^"]+(")/giu,
      `$1${REDACTED}$2`,
    )
}

function safeText(value: unknown): string | undefined {
  if (typeof value === 'number') return Number.isInteger(value) && value >= 0 ? String(value) : undefined
  if (typeof value !== 'string') return undefined
  if (value.length === 0 || value.length > MAX_TEXT || !SAFE_TEXT.test(value)) return undefined
  return value
}

function networkMetadataOf(error: Error): string | undefined {
  const parts: string[] = []
  for (const field of NETWORK_FIELDS) {
    const candidate = safeText(Reflect.get(error, field))
    if (candidate === undefined) continue
    parts.push(`${field}=${candidate}`)
  }
  return parts.length === 0 ? undefined : parts.join(' ')
}

function collectNetworkMetadata(value: unknown): string[] {
  const seen = new Set<string>()
  const details: string[] = []
  const visit = (current: unknown, depth: number): void => {
    if (depth > MAX_CAUSE_DEPTH || details.length >= MAX_NETWORK_METADATA || !(current instanceof Error)) return
    const metadata = networkMetadataOf(current)
    if (metadata !== undefined && !seen.has(metadata) && details.length < MAX_NETWORK_METADATA) {
      seen.add(metadata)
      details.push(metadata)
    }
    if (current instanceof AggregateError) {
      for (const item of current.errors) {
        visit(item, depth + 1)
        if (details.length >= MAX_NETWORK_METADATA) return
      }
    }
    if (current.cause !== undefined && current.cause !== null) visit(current.cause, depth + 1)
  }
  visit(value, 0)
  return details
}

function phaseMessageOf(phase: AuthorizationFailurePhase): string {
  switch (phase) {
    case 'starting':
      return 'the sign-in attempt failed before the controller received a notice or prompt'
    case 'awaiting-provider':
      return 'the sign-in attempt failed after the controller received a notice or prompt'
    case 'committing-credential':
      return 'the sign-in attempt reached credential storage but did not finish committing a usable credential'
  }
}

function failurePhaseOf(record: AttemptRecord, error: unknown): AuthorizationFailurePhase {
  if (error instanceof AuthorizationError && error.code === 'NOT_COMMITTED') return 'committing-credential'
  return record.controllerObservedInteraction ? 'awaiting-provider' : 'starting'
}

function failureMessageOf(record: AttemptRecord, error: unknown): string {
  const phase = failurePhaseOf(record, error)
  const outer = error instanceof Error ? error.message : String(error)
  const detail = redactAuthorizationText(outer)
  const metadata = collectNetworkMetadata(error)
  const suffix = metadata.length === 0 ? '' : ` [${metadata.join('; ')}]`
  return `${phaseMessageOf(phase)}: ${detail}${suffix}`
}

/** One controller-tracked attempt: the service owns the run, this owns the view. */
interface AttemptRecord {
  /** The joined credential key the attempt runs for; the wire view carries it. */
  key: string
  status: 'running' | 'authorized' | 'cancelled' | 'failed'
  controllerObservedInteraction: boolean
  notices: AuthorizationNotice[]
  pending: {
    id: string
    prompt: AuthorizationPrompt
    settle: (value: string) => void
    fail: (error: Error) => void
  } | undefined
  /** Failure detail for a terminal `failed` attempt. */
  message: string | undefined
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the `authorization` Remote namespace. */
    authorizationController: AuthorizationController
  }
}

/**
 * Host service backing the generated `ctx.remote.authorization` namespace. It
 * carries the wire obligations the authorization seam itself does not: the
 * long-running attempt is started without a hanging request, its notices and
 * prompts are projected for polling, and every refusal maps to a stable code.
 * Prompts travel one way per question — a `secret` answer is typed into
 * `respond` and never read back.
 */
export class AuthorizationController extends TypertRemoteService {
  /** @param ctx - Host context where the authorization service may be mounted. */
  constructor(ctx: Context) {
    super(ctx, 'authorizationController', { namespace: 'authorization' })
  }

  /** Controller-tracked attempts by credential key, terminal ones included. */
  private readonly attempts = new Map<string, AttemptRecord>()

  /** Source of prompt ids; unique within the process, which is all a page needs. */
  private promptSeq = 0

  /**
   * Snapshot every registered flow and every tracked attempt.
   * @returns the flows a sign-in surface offers, and the attempts it may be watching.
   * @throws RemoteError when no authorization service is mounted.
   */
  @Remote
  describe(): Promise<AuthorizationDescribeValue> {
    return this.describeSnapshot()
  }

  /**
   * Assemble the flows-and-attempts snapshot from the seam, this tracker, and
   * stored credential records. A grant that survived a restart has no in-memory
   * attempt, so it is projected as an already-authorized attempt the Models
   * page can enable from.
   */
  private async describeSnapshot(): Promise<AuthorizationDescribeValue> {
    const flows = this.service().list()
    const stored: Array<AuthorizationDescribeValue['attempts'][number]> = []
    const credentials = this.ctx.get('credentials')
    if (credentials !== undefined) {
      for (const entry of flows) {
        const record = await credentials.describeRecord(entry.key)
        if (!record.configured) continue
        stored.push({ key: entry.key, status: 'authorized', notices: [] })
      }
    }
    // Snapshot tracked attempts after the asynchronous metadata reads. A begin
    // that starts while describe is reading credentials must win over the
    // stored projection in this same response.
    const tracked = [...this.attempts.values()].map(record => this.projectAttempt(record))
    const trackedKeys = new Set(this.attempts.keys())
    return {
      flows: flows.map(entry => this.projectFlow(entry)),
      attempts: [...tracked, ...stored.filter(attempt => !trackedKeys.has(attempt.key))],
    }
  }

  /**
   * Start one authorization attempt without waiting for it to finish.
   * @param request - the credential key whose flow to run, and optionally the
   *   method; defaults to the flow's first.
   * @returns confirmation that the attempt started; poll `describe` for its progress.
   * @throws RemoteError `gateway/bad-request` for a malformed payload,
   *   `authorization/not-found` when no flow claims the key, or
   *   `authorization/conflict` when an attempt is already running.
   */
  @Remote
  begin(request: { key: string; method?: string }): Promise<{ started: true }> {
    return Promise.resolve(this.beginAttempt(request))
  }

  /**
   * Validate and start one attempt against a controller-tracked record.
   *
   * The record tracks only facts this controller directly observed. It does not
   * infer anything about the provider's internal state beyond whether a notice
   * or prompt reached the controller, and whether the authorization seam later
   * reported `NOT_COMMITTED`.
   */
  private beginAttempt(request: { key: string; method?: string }): { started: true } {
    const parsed = parseRemoteRequest('authorization.begin', beginRequestSchema, request)
    let branded
    try {
      branded = parseCredentialKey(parsed.key)
    } catch (error) {
      throw new RemoteError(
        'gateway/bad-request',
        error instanceof Error ? error.message : String(error),
        {},
      )
    }
    const entry = this.flowFor(branded)
    const method = parsed.method ?? entry.methods[0]?.id ?? ''
    if (!entry.methods.some(candidate => candidate.id === method)) {
      throw new RemoteError(
        'gateway/bad-request',
        `authorization flow for "${parsed.key}" offers no method "${method}"`,
        {},
      )
    }
    if (entry.inFlight) {
      throw new RemoteError(
        'authorization/conflict',
        `an authorization attempt for "${parsed.key}" is already running`,
        { key: parsed.key },
      )
    }
    // A fresh begin supersedes the previous attempt's terminal view.
    this.attempts.delete(parsed.key)
    const record: AttemptRecord = {
      key: parsed.key,
      status: 'running', controllerObservedInteraction: false, notices: [], pending: undefined, message: undefined,
    }
    this.attempts.set(parsed.key, record)
    void this.service().begin({
      key: branded,
      method,
      interaction: {
        notify: (notice) => { this.recordNotice(record, notice) },
        prompt: prompt => this.awaitPrompt(record, prompt),
      },
    }).then((outcome) => {
      record.status = outcome.status
      this.endPending(record)
    }, (error: unknown) => {
      record.status = 'failed'
      record.message = failureMessageOf(record, error)
      this.endPending(record)
    })
    return { started: true }
  }

  /**
   * Answer the pending prompt of one running attempt.
   * @param request - the key, the prompt id from `describe`, and either the
   *   answer or a decline.
   * @throws RemoteError `gateway/bad-request` for a malformed payload or a stale
   *   prompt id, or `authorization/not-found` when no running attempt exists.
   */
  @Remote
  respond(request: { key: string; promptId: string; value?: string; declined?: true }): Promise<void> {
    this.answerPrompt(request)
    return Promise.resolve()
  }

  /** Deliver one answer (or decline) to the pending prompt of a running attempt. */
  private answerPrompt(request: { key: string; promptId: string; value?: string; declined?: true }): void {
    const parsed = parseRemoteRequest('authorization.respond', respondRequestSchema, request)
    const record = this.runningFor(parsed.key)
    if (record.pending === undefined || record.pending.id !== parsed.promptId) {
      throw new RemoteError(
        'gateway/bad-request',
        `no pending prompt "${parsed.promptId}" for "${parsed.key}"`,
        {},
      )
    }
    const pending = record.pending
    if (parsed.declined === true) pending.fail(new AuthorizationDeclinedError())
    else pending.settle(parsed.value ?? '')
  }

  /**
   * Withdraw the running attempt for a key, if any.
   * @param request - the key whose attempt should stop.
   * @throws RemoteError `gateway/bad-request` for a malformed payload.
   */
  @Remote
  cancel(request: { key: string }): Promise<void> {
    this.withdraw(request)
    return Promise.resolve()
  }

  /** Withdraw the running attempt for a parsed key. */
  private withdraw(request: { key: string }): void {
    const parsed = parseRemoteRequest('authorization.cancel', cancelRequestSchema, request)
    let branded
    try {
      branded = parseCredentialKey(parsed.key)
    } catch (error) {
      throw new RemoteError(
        'gateway/bad-request',
        error instanceof Error ? error.message : String(error),
        {},
      )
    }
    this.service().cancel(branded)
  }

  /** Resolve the service or report how to supply it. */
  private service() {
    const authorization = this.ctx.get('authorization')
    if (authorization === undefined) {
      throw new RemoteError(
        'gateway/internal',
        'authorization service is absent: this deployment does not mount @deepseek-ai/dsh-authorization'
          + ' in its composition, so no sign-in flow can run',
        {},
      )
    }
    return authorization
  }

  /** The registered flow for a key, or an `authorization/not-found` refusal naming it. */
  private flowFor(key: ReturnType<typeof parseCredentialKey>): AuthorizationEntry {
    const entry = this.service().describe(key)
    if (entry === undefined) {
      throw new RemoteError(
        'authorization/not-found',
        `no authorization flow is registered for "${key}"`,
        { key },
      )
    }
    return entry
  }

  /** The tracked attempt for a key, or an `authorization/not-found` refusal when none is running. */
  private runningFor(key: string): AttemptRecord {
    const record = this.attempts.get(key)
    if (record === undefined || record.status !== 'running') {
      throw new RemoteError(
        'authorization/not-found',
        `no running authorization attempt for "${key}"`,
        { key },
      )
    }
    return record
  }

  /** Append one flow notice under the retention bound; a notice never stalls a flow. */
  private recordNotice(record: AttemptRecord, notice: AuthorizationNotice): void {
    record.controllerObservedInteraction = true
    record.notices.push(notice)
    if (record.notices.length > MAX_NOTICES) record.notices.splice(0, record.notices.length - MAX_NOTICES)
  }

  /**
   * Hand one flow prompt to the polling surface. The deferred settles only
   * through `respond`, the prompt's own withdrawal, or the attempt ending —
   * whichever comes first — so a flow racing a typed code against a browser
   * callback still sees its losing question withdrawn.
   */
  private awaitPrompt(record: AttemptRecord, prompt: AuthorizationPrompt): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      record.controllerObservedInteraction = true
      this.promptSeq += 1
      const id = `prompt-${String(this.promptSeq)}`
      let settled = false
      const onPromptWithdrawn = (): void => {
        finish(() => { reject(new AuthorizationError('the flow withdrew this prompt', 'PROMPT_WITHDRAWN')) })
      }
      const finish = (settle: () => void): void => {
        if (settled) return
        settled = true
        prompt.signal?.removeEventListener('abort', onPromptWithdrawn)
        // Only a prompt's own finish vacates its seat; a successor prompt owns
        // the slot by the time an older finish runs.
        if (record.pending !== undefined && record.pending.id === id) record.pending = undefined
        settle()
      }
      prompt.signal?.addEventListener('abort', onPromptWithdrawn, { once: true })
      record.pending = {
        id,
        prompt,
        settle: (value) => { finish(() => { resolve(value) }) },
        fail: (error: Error) => { finish(() => { reject(error) }) },
      }
    })
  }

  /** Reject a still-pending deferred when its attempt reaches a terminal status. */
  private endPending(record: AttemptRecord): void {
    record.pending?.fail(new AuthorizationError(
      'the authorization attempt ended with this prompt unanswered', 'ATTEMPT_ENDED'))
  }

  /** The wire view of one registered flow. */
  private projectFlow(entry: AuthorizationEntry): AuthorizationDescribeValue['flows'][number] {
    return {
      key: entry.key,
      label: entry.label,
      methods: entry.methods.map(method => ({ id: method.id, label: method.label })),
      inFlight: entry.inFlight,
    }
  }

  /** The wire view of one tracked attempt, prompts projected without their plumbing. */
  private projectAttempt(record: AttemptRecord): AuthorizationAttemptView {
    const pending = record.pending
    const pendingView: AuthorizationPromptView | undefined = pending === undefined ? undefined : {
      id: pending.id,
      kind: pending.prompt.kind,
      message: pending.prompt.message,
      ...pending.prompt.kind === 'select'
        ? { options: pending.prompt.options.map(option => ({ ...option })) }
        : pending.prompt.placeholder === undefined ? {} : { placeholder: pending.prompt.placeholder },
    }
    return {
      key: record.key,
      status: record.status,
      notices: record.notices.map(notice => ({ ...notice })),
      ...pendingView === undefined ? {} : { pendingPrompt: pendingView },
      ...record.message === undefined ? {} : { message: record.message },
    }
  }
}

export default AuthorizationController
