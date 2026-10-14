/** OpenCode Go's Console device login and subscription inference addresses. */

import { setTimeout as sleep } from 'node:timers/promises'
import type { Model, Api, OAuthAuth, OAuthCredential, Provider } from '@earendil-works/pi-ai'
import { attributionHeaders } from '@deepseek-ai/dsh-llm'
import { deadline, MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'

const CONSOLE_URL = 'https://opencode.ai/console'
const GO_URL = 'https://opencode.ai/inference/go'
const CLIENT_ID = 'durash'

/** Maximum Go refresh duration admitted by the application shutdown grace. */
export const MAX_GO_REFRESH_TIMEOUT_MS = 15_000

/** Default Go refresh deadline, configurable through a provider's oauthRefreshTimeoutMs. */
export const DEFAULT_GO_REFRESH_TIMEOUT_MS = MAX_GO_REFRESH_TIMEOUT_MS

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`OpenCode authorization: missing ${field}`)
  return value
}

function duration(value: unknown, field: string, maxMilliseconds: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value * 1000 > maxMilliseconds) {
    throw new Error(`OpenCode authorization: invalid ${field}`)
  }
  return value * 1000
}

function grant(body: Record<string, unknown>, previous?: OAuthCredential): OAuthCredential {
  const now = Date.now()
  const orgId = body.org_id
  if (orgId !== undefined && orgId !== null && typeof orgId !== 'string') {
    throw new Error('OpenCode authorization: invalid org_id')
  }
  return {
    type: 'oauth',
    access: requiredText(body.access_token, 'access_token'),
    refresh: requiredText(body.refresh_token, 'refresh_token'),
    expires: now + duration(body.expires_in, 'expires_in', Number.MAX_SAFE_INTEGER - now),
    ...typeof orgId === 'string' ? { orgId } : previous?.orgId === undefined ? {} : { orgId: previous.orgId },
  }
}

/**
 * Create the Console device flow using the launcher's proxy-aware global fetch by default.
 * Access-token lifetimes become persisted timestamps independently of device-flow timer limits.
 * Refresh runs under pi-ai's CredentialStore.modify lock and returns the rotated grant for persistence.
 * @param fetcher - HTTP transport; injection does not change the Console authority.
 * @param refreshTimeoutMs - Resolved independent refresh deadline in milliseconds.
 * @returns Browser login, refresh and bearer-header derivation for OpenCode Go.
 */
export function openCodeGoOAuth(
  fetcher: typeof fetch = globalThis.fetch, refreshTimeoutMs: number = DEFAULT_GO_REFRESH_TIMEOUT_MS,
): OAuthAuth {
  const post = async (path: string, values: Record<string, string>, signal: AbortSignal) => {
    signal.throwIfAborted()
    const response = await fetcher(`${CONSOLE_URL}${path}`, {
      method: 'POST', headers: { ...attributionHeaders(), 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams(values), signal, redirect: 'error',
    })
    let body: unknown
    try { body = await response.json() } catch {
      signal.throwIfAborted()
      // JSON parse diagnostics may quote a token-bearing response body.
      throw new Error('OpenCode authorization: response is not valid JSON')
    }
    signal.throwIfAborted()
    if (!object(body)) throw new Error('OpenCode authorization: invalid JSON response')
    return { response, body }
  }
  return {
    name: 'OpenCode Go', isSubscription: true, loginLabel: 'Sign in to OpenCode Go',
    async login(interaction) {
      const device = await post('/auth/device/code', { client_id: CLIENT_ID, supports_org_scope: 'true' }, interaction.signal)
      if (!device.response.ok) throw new Error(`OpenCode device login refused (${String(device.response.status)})`)
      const code = requiredText(device.body.device_code, 'device_code')
      const userCode = requiredText(device.body.user_code, 'user_code')
      const verification = new URL(requiredText(device.body.verification_uri_complete, 'verification_uri_complete'), `${CONSOLE_URL}/`)
      if (verification.protocol !== 'https:' || verification.origin !== new URL(CONSOLE_URL).origin) {
        throw new Error('OpenCode authorization: verification URL must belong to the OpenCode Console')
      }
      let interval = device.body.interval === undefined ? 5000 : duration(device.body.interval, 'interval', MAX_TIMER_DELAY_MS)
      using timeout = deadline(interaction.signal, duration(device.body.expires_in, 'expires_in', MAX_TIMER_DELAY_MS), 'OPENCODE_AUTH_TIMEOUT')
      interaction.notify({ type: 'device_code', userCode, verificationUri: verification.href })
      for (;;) {
        await sleep(interval, undefined, { signal: timeout.signal })
        const { response, body } = await post('/auth/device/token', {
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: code, client_id: CLIENT_ID,
        }, timeout.signal)
        if (response.ok) return grant(body)
        if (response.status === 400 && body.error === 'authorization_pending') continue
        if (response.status === 400 && body.error === 'slow_down') { interval = Math.min(interval + 5000, MAX_TIMER_DELAY_MS); continue }
        throw new Error(`OpenCode device login refused (${String(response.status)}); sign in again`)
      }
    },
    async refresh(credential, signal) {
      signal.throwIfAborted()
      // The server consumes a refresh token once. Finish its replacement under
      // the credential-store lock even if the requesting conversation cancels.
      using timeout = deadline(undefined, refreshTimeoutMs, 'OPENCODE_REFRESH_TIMEOUT')
      const { response, body } = await post('/auth/device/token', {
        grant_type: 'refresh_token', refresh_token: credential.refresh, client_id: CLIENT_ID,
      }, timeout.signal)
      if (!response.ok) throw new Error(`OpenCode token refresh refused (${String(response.status)}); sign in again`)
      return grant(body, credential)
    },
    toAuth: credential => Promise.resolve({ headers: { authorization: `Bearer ${credential.access}` } }),
  }
}

/**
 * Add Console OAuth while retaining Go's native API-key auth, metadata and three implementations.
 * @param native - Installed OpenCode Go provider.
 * @returns Subscription provider using canonical Go addresses without a pay-as-you-go fallback.
 */
export function openCodeGoProvider(native: Provider): Provider {
  return {
    ...native,
    auth: { ...native.auth, oauth: openCodeGoOAuth() },
    getModels: () => native.getModels().map(model => ({ ...model,
      baseUrl: model.api === 'anthropic-messages' ? GO_URL : `${GO_URL}/v1`,
    })),
  }
}

/**
 * Send the durable conversation id on Go and other OpenCode inference routes without creating an id.
 * @param model - Resolved endpoint and provider identity.
 * @param sessionId - Durable conversation identifier; absent for unscoped direct requests.
 * @param catalogProvider - Native provider reused by a named route.
 * @returns Session header for OpenCode only, or an empty object.
 */
export function openCodeSessionHeaders(
  model: Model<Api>, sessionId: string | undefined, catalogProvider?: string,
): Record<string, string> {
  if (sessionId === undefined) return {}
  const go = model.provider === 'opencode-go' || catalogProvider === 'opencode-go'
  const openCodeHost = URL.canParse(model.baseUrl) && new URL(model.baseUrl).hostname === 'opencode.ai'
  return go || openCodeHost ? { 'x-opencode-session': sessionId } : {}
}
