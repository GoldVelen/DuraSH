/**
 * Read native account directories and model metadata for editor requests.
 *
 * xAI, Codex, and OpenCode Go refreshes read authenticated directories.
 * Passive reads use the Host's account-bound catalog when available, then the
 * installed catalog. Hand-declared routes use their model-listing endpoint.
 *
 * Neither path is a catalog refresh. Nothing here is stored: the request
 * carries a draft the user is still editing, and the reply is candidate
 * metadata the surface offers for adoption. `cordis.patch.yml` remains the only
 * thing that decides what a route serves.
 *
 * OpenAI-compatible and Anthropic Messages protocols are interrogated through
 * their native model-listing endpoints. The parser accepts the standard
 * `data` array and the enriched `models` map some compatible gateways expose.
 * Unsupported hand-declared protocols report that no model listing is
 * available, leaving the surface's manual-entry option.
 *
 * @module dsh-llm-pi-ai/discovery
 */

import { INVALID_CREDENTIAL_CODE, LlmError, normalizeApiKey } from '@deepseek-ai/dsh-llm'
import type { LlmDiscoveredModel, LlmModelDiscoveryOperation } from '@deepseek-ai/dsh-llm'
import { attributionHeaders } from '@deepseek-ai/dsh-llm'
import { catalogModels, catalogProvider, THINKING_LEVELS } from './catalog.ts'
import { readModelDirectory as readEndpoint } from './model-directory-http.ts'
import { resolveRouteModels } from './catalog.ts'
import { DEFAULT_CONTEXT_WINDOW, DEFAULT_MAX_TOKENS, DEFAULT_INPUT, resolveCodexDirectoryClientVersion } from './config.ts'
import { getSupportedThinkingLevels } from './models.ts'
import { fetchOpenCodeGoCatalog } from './opencode-go-catalog.ts'
import type { Api, Model } from '@earendil-works/pi-ai'

/**
 * Protocols whose model listing this module can read. OpenAI protocols use
 * bearer auth at `GET {baseURL}/models`; Anthropic Messages uses `x-api-key`
 * and `anthropic-version` at its native `GET /v1/models`. Azure is absent
 * despite its OpenAI lineage — it authenticates with an `api-key` header and
 * requires an `api-version` query. Codex's subscription directory and Go's
 * Console workspace directory are handled separately. The remaining protocols
 * have no supported listing here.
 */
const LISTABLE_PROTOCOLS: ReadonlySet<string> = new Set([
  'anthropic-messages',
  'openai-completions',
  'openai-responses',
])

/** Stable API version required by Anthropic's model-listing endpoint. */
const ANTHROPIC_VERSION = '2023-06-01'

/** Largest model-list page accepted by Anthropic's public endpoint; discovery reads one page and does not follow `has_more`. */
const ANTHROPIC_MODEL_LIMIT = 1000

/** Capacity fields nested by enriched model-directory replies. */
interface ListingLimit {
  context?: unknown
  output?: unknown
}

/** Per-route capacities OpenRouter nests under each entry. */
interface ListingTopProvider {
  max_completion_tokens?: unknown
}

/** One entry of a supported `GET /models` reply. */
interface ListingEntry {
  id?: unknown
  /** Common gateway extensions; absent from the official listings. */
  name?: unknown
  display_name?: unknown
  displayName?: unknown
  contextWindow?: unknown
  context_window?: unknown
  context_length?: unknown
  max_input_tokens?: unknown
  maxOutputTokens?: unknown
  max_tokens?: unknown
  max_output_tokens?: unknown
  maxTokens?: unknown
  limit?: ListingLimit | null
  top_provider?: ListingTopProvider | null
  input_modalities?: unknown
  capabilities?: { reasoning_effort?: unknown } | null
}

/** A positive integer field of a listing entry, or `undefined` when absent or unusable. */
function capacity(...candidates: readonly unknown[]): number | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isInteger(candidate) && candidate > 0) return candidate
  }
  return undefined
}

/** A non-empty string field of a listing entry, or `undefined`. */
function label(...candidates: readonly unknown[]): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length > 0) return candidate
  }
  return undefined
}

/**
 * Join the endpoint base with the protocol's listing path. The base is
 * treated as a prefix rather than a URL to resolve against, so a deployment
 * path such as `https://gateway.example/openai/v1` keeps its segments instead
 * of losing them to `URL` resolution. OpenAI protocols list at
 * `{baseURL}/models`. Anthropic lists at `{root}/v1/models`, where the root is
 * the base without trailing slashes and without one trailing `/v1` segment:
 * gateway documentation publishes both spellings of the same root. Only this
 * listing URL normalizes that segment; model requests receive the configured
 * `baseURL` unchanged.
 */
function listingUrl(baseURL: string, api: string): string {
  const base = baseURL.replace(/\/+$/, '')
  if (api !== 'anthropic-messages') return `${base}/models`
  const root = base.endsWith('/v1') ? base.slice(0, -3) : base
  return `${root}/v1/models?limit=${String(ANTHROPIC_MODEL_LIMIT)}`
}

/**
 * Read one supported model-listing reply. The standard `data` array takes
 * precedence when both supported formats are present. An enriched `models`
 * map uses each property key as the endpoint-facing id; its nested `id` is
 * only a fallback for an empty key because gateways may put a canonical model
 * identity there instead of the alias they accept on requests. Only
 * object-valued map entries are models; primitive properties are ignored
 * because they may be directory metadata rather than model records.
 *
 * Entries without a usable id are skipped rather than failing the whole
 * interrogation: a single malformed row should not deny the user the rest of
 * a working endpoint's catalog. Missing names fall back to the adopted id so
 * the Web form receives a complete human-readable row.
 */
function readListing(body: unknown, fallbackNames = true): LlmDiscoveredModel[] {
  const listing = body as { data?: unknown; models?: unknown } | null
  const data = listing?.data
  let listed: { readonly key?: string; readonly raw: unknown }[]
  if (Array.isArray(data)) {
    const rows = data as readonly unknown[]
    listed = rows.map(raw => ({ raw }))
  } else {
    const models = listing?.models
    if (models === null || typeof models !== 'object' || Array.isArray(models)) {
      throw new LlmError(
        'the endpoint\'s model listing has neither a "data" array nor a "models" object; '
        + 'enter this provider\'s models by hand',
        'DISCOVERY_FAILED',
      )
    }
    listed = Object.entries(models as Record<string, unknown>)
      .filter(([, raw]) => raw !== null && typeof raw === 'object' && !Array.isArray(raw))
      .map(([key, raw]) => ({ key, raw }))
  }
  const models: LlmDiscoveredModel[] = []
  for (const { key, raw } of listed) {
    const entry = raw as ListingEntry | null
    const id = label(key, entry?.id)
    if (id === undefined) continue
    const name = label(entry?.name, entry?.display_name, entry?.displayName) ?? (fallbackNames ? id : undefined)
    const contextWindow = capacity(
      entry?.contextWindow,
      entry?.context_window,
      entry?.context_length,
      entry?.max_input_tokens,
      entry?.limit?.context,
    )
    const maxTokens = capacity(
      entry?.maxOutputTokens,
      entry?.max_output_tokens,
      entry?.maxTokens,
      entry?.max_tokens,
      entry?.limit?.output,
      entry?.top_provider?.max_completion_tokens,
    )
    const inputModalities = Array.isArray(entry?.input_modalities)
      ? entry.input_modalities.filter((value): value is 'text' | 'image' => value === 'text' || value === 'image')
      : undefined
    const offered = entry?.capabilities?.reasoning_effort
    const efforts = Array.isArray(offered)
      ? offered.flatMap((value: unknown): [string, string][] => {
        if (value === 'none') return [['off', 'none']]
        return typeof value === 'string' && THINKING_LEVELS.some(level => level === value) && value !== 'off'
          ? [[value, value]] : []
      })
      : []
    models.push({
      id,
      ...name === undefined ? {} : { name },
      ...contextWindow === undefined ? {} : { contextWindow },
      ...maxTokens === undefined ? {} : { maxTokens },
      ...inputModalities === undefined || inputModalities.length === 0 ? {} : { inputModalities },
      ...efforts.length === 0 ? {} : { reasoningEfforts: Object.fromEntries<string>(efforts) },
    })
  }
  return models
}

/** Read picker-visible subscription models; public API availability does not restrict ChatGPT accounts. */
function readCodexListing(body: unknown): LlmDiscoveredModel[] {
  if (typeof body !== 'object' || body === null || !('models' in body) || !Array.isArray(body.models)) {
    throw new LlmError('Codex model directory did not contain a models array', 'DISCOVERY_FAILED')
  }
  const data = body.models.flatMap((raw: unknown) => {
    if (typeof raw !== 'object' || raw === null) return []
    const entry = raw as Record<string, unknown>
    if (entry.visibility !== 'list') return []
    const levels = Array.isArray(entry.supported_reasoning_levels) ? entry.supported_reasoning_levels : []
    return [{
      id: entry.slug, display_name: entry.display_name, context_window: entry.context_window,
      input_modalities: entry.input_modalities,
      capabilities: { reasoning_effort: levels.map((level: unknown) =>
        typeof level === 'object' && level !== null && 'effort' in level ? level.effort : undefined) },
    }]
  })
  return readListing({ data }).map(({ reasoningEfforts, ...model }) => ({
    ...model,
    ...reasoningEfforts !== undefined && Object.keys(reasoningEfforts).some(level => level !== 'off')
      ? { reasoningEfforts } : {},
  }))
}

/** Extract the account selector required by Codex from its OAuth access token without exposing credentials. */
function codexAccountId(token: string): string {
  let payload: unknown
  try {
    payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'))
  } catch (_error: unknown) {
    // A malformed JWT cannot identify a subscription account; parser errors may contain token text.
    throw new LlmError('Codex model discovery requires a valid subscription access token', INVALID_CREDENTIAL_CODE)
  }
  if (typeof payload === 'object' && payload !== null && 'https://api.openai.com/auth' in payload) {
    const auth = payload['https://api.openai.com/auth']
    if (typeof auth === 'object' && auth !== null && 'chatgpt_account_id' in auth
      && typeof auth.chatgpt_account_id === 'string' && auth.chatgpt_account_id.length > 0) {
      return auth.chatgpt_account_id
    }
  }
  throw new LlmError('Codex access token does not identify a subscription account; sign in again', INVALID_CREDENTIAL_CODE)
}

/**
 * Accept one probe key, or refuse it before the header is built. Without this
 * the `fetch` below would throw a ByteString `TypeError` that this function's
 * catch reports as `could not reach <url>` — blaming the network for a local,
 * deterministic fault.
 * @param raw - the key typed into the form or read from storage.
 * @returns the trimmed, usable key.
 */
function usableProbeKey(raw: string): string {
  const checked = normalizeApiKey(raw)
  if (checked.ok) return checked.value
  throw new LlmError(
    checked.reason === 'empty'
      ? 'this provider\'s API key is blank; enter it on the Models page, or clear it to probe unauthenticated'
      : 'this provider\'s API key contains characters no HTTP header can carry; paste the raw key only',
    INVALID_CREDENTIAL_CODE,
  )
}

/** Host-owned profile inputs that a configuration draft deliberately omits. */
export interface StoredModelDiscoveryProfile {
  /** Host-owned directory reader; public metadata caching stays within this adapter instance. */
  readonly readDirectory?: typeof readEndpoint
  /** Deployment headers configured on the named route. */
  readonly headers: Readonly<Record<string, string>> | undefined
  /** Resolve the named route's credential only when the draft carries none. */
  readonly resolveApiKey: () => Promise<string | undefined>
  /** Stored endpoint when the draft leaves it inherited. */
  readonly baseURL?: string
  /** Installed provider whose protocol and authentication this route uses. */
  readonly catalogProvider?: string
  /** Supported Codex directory version selected by this route. */
  readonly codexDirectoryClientVersion?: string
  /** Resolve provider-native authentication, including subscription refresh, only when no explicit key exists. */
  readonly resolveNativeAuth?: (signal?: AbortSignal) => Promise<{
    apiKey?: string
    headers?: Record<string, string | null>
  } | undefined>
  /** Current account-bound model metadata, owned by this Host route. */
  readonly runtimeModels?: readonly Model<Api>[]
  /** Publish a fresh directory only while the captured route and authorization remain current. */
  readonly publishCatalog?: (models: readonly Model<Api>[]) => void
}

/** Project account metadata for the editor without turning catalog output limits into request defaults. */
function projectModels(models: readonly Model<Api>[]): LlmDiscoveredModel[] {
  return models.map(model => ({
    id: model.id, name: model.name, contextWindow: model.contextWindow, maxTokens: model.maxTokens,
    inputModalities: [...model.input],
    ...!model.reasoning ? {} : { reasoningEfforts: Object.fromEntries(getSupportedThinkingLevels(model)
      .map(level => [level, model.thinkingLevelMap?.[level] ?? (level === 'off' ? null : level)])) },
  }))
}

/** Materialize directory metadata using a native single-protocol provider's implementation defaults. */
function nativeModels(provider: string, models: readonly LlmDiscoveredModel[], baseURL: string): readonly Model<Api>[] {
  if (models.length === 0) return []
  return resolveRouteModels({ provider, baseURL, models: models.map(model => ({
    // Codex and xAI directory parsers assign a name to every emitted entry.
    id: model.id, name: model.name as string,
    ...model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow },
    ...model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens },
    ...model.inputModalities === undefined ? {} : { input: [...model.inputModalities] },
    ...model.reasoningEfforts === undefined ? {} : { reasoningEfforts: model.reasoningEfforts },
  })), defaultContextWindow: DEFAULT_CONTEXT_WINDOW, defaultMaxTokens: DEFAULT_MAX_TOKENS, defaultInput: [...DEFAULT_INPUT] }).models
}

/**
 * Read model metadata for a named route or an unsaved provider draft.
 * @param request - the endpoint, protocol, and one-shot credential to use.
 * @param storedProfile - Host-owned account metadata, publication callback,
 *   headers, and lazy credential resolution; credentials resolve only on the
 *   network path when the request carries no one-shot key.
 * @returns directory candidates, or current Host or installed metadata on passive reads.
 * @throws LlmError when the protocol has no readable listing, the endpoint
 *   refuses or fails the request, or the reply is not a model listing.
 */
export async function discoverModels(
  request: LlmModelDiscoveryOperation,
  storedProfile?: () => StoredModelDiscoveryProfile | undefined,
): Promise<readonly LlmDiscoveredModel[]> {
  const refreshedProfile = storedProfile?.()
  const sourceProvider = refreshedProfile?.catalogProvider ?? request.provider
  const onlineXai = request.refresh === true && sourceProvider === 'xai'
  const onlineCodex = request.refresh === true && sourceProvider === 'openai-codex'
  const onlineGo = request.refresh === true && sourceProvider === 'opencode-go'
  const onlineNative = onlineXai || onlineCodex || onlineGo
  if (!onlineNative && request.provider !== undefined) {
    if (refreshedProfile?.runtimeModels !== undefined) return projectModels(refreshedProfile.runtimeModels)
    const installed = catalogModels(request.provider)
    if (installed.size > 0) {
      return [...installed.values()].map(model => ({
        id: model.id,
        name: model.name,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        inputModalities: [...model.input],
      }))
    }
  }
  const baseURL = request.baseURL || (onlineNative
    ? refreshedProfile?.baseURL ?? catalogProvider(sourceProvider)?.baseUrl
    : undefined)
  if (!onlineGo && (baseURL === undefined || baseURL.length === 0)) {
    throw new LlmError(
      `pi-ai ships no catalog for provider "${request.provider ?? ''}", so its models can only come from its`
      + " endpoint; set a baseURL, or enter this provider's models by hand",
      'DISCOVERY_FAILED',
    )
  }
  // A draft that has not chosen a protocol yet is asked as OpenAI Chat
  // Completions: it is the shape a gateway is overwhelmingly likely to speak,
  // and the alternative — refusing until the field is filled — would withhold
  // the action from the case it exists for. The cost is a misdirected message
  // when the endpoint speaks something else (an Anthropic gateway answers 401,
  // which reads as a credential problem), and hand-entry remains the way out.
  const api = request.api ?? 'openai-completions'
  if (!onlineGo && !onlineCodex && !LISTABLE_PROTOCOLS.has(api)) {
    throw new LlmError(
      `pi-ai protocol "${api}" has no model listing this build can read; enter this provider's models by hand`,
      'DISCOVERY_UNSUPPORTED',
    )
  }
  // A key typed into the form wins: it may replace the stored key that is
  // failing. The stored profile is asked past the catalog and protocol checks,
  // and its credential resolver remains lazy so a typed key cannot fail over a
  // stored credential it supersedes. A route may still authenticate through a
  // deployment-owned Authorization header when neither key exists.
  const stored = refreshedProfile ?? storedProfile?.()
  const publish = (models: readonly Model<Api>[]): void => {
    // Unsaved endpoint, protocol and key drafts cannot replace the account directory serving conversations.
    if (request.apiKey !== undefined || request.api !== undefined
      || request.baseURL !== undefined && request.baseURL !== stored?.baseURL) return
    stored?.publishCatalog?.(models)
  }
  const supplied = request.apiKey ?? await stored?.resolveApiKey()
  const native = onlineNative && supplied === undefined
    ? await stored?.resolveNativeAuth?.(request.signal)
    : undefined
  const credential = supplied ?? native?.apiKey
  const apiKey = credential === undefined ? undefined : usableProbeKey(credential)
  const headers = new Headers(Object.entries({ ...native?.headers, ...stored?.headers })
    .filter((entry): entry is [string, string] => entry[1] !== null))
  headers.set('accept', 'application/json')
  if (api === 'anthropic-messages') {
    headers.set('anthropic-version', ANTHROPIC_VERSION)
    if (apiKey !== undefined) headers.set('x-api-key', apiKey)
  } else if (apiKey !== undefined) {
    headers.set('authorization', `Bearer ${apiKey}`)
  }
  for (const [name, value] of Object.entries(attributionHeaders())) headers.set(name, value)
  if (onlineGo) {
    if (apiKey !== undefined) headers.set('authorization', `Bearer ${apiKey}`)
    if (!headers.has('authorization')) throw new LlmError('OpenCode Go model discovery requires account sign-in or an API key', 'MISSING_CREDENTIAL')
    const models = await fetchOpenCodeGoCatalog(headers, request.signal, stored?.readDirectory)
    publish(models)
    return projectModels(models)
  }
  // Every non-Go path requires an endpoint before resolving credentials.
  const endpoint = baseURL as string
  if (onlineCodex) {
    if (apiKey === undefined) {
      throw new LlmError('Codex model discovery requires subscription sign-in', 'MISSING_CREDENTIAL')
    }
    headers.set('authorization', `Bearer ${apiKey}`)
    headers.set('chatgpt-account-id', codexAccountId(apiKey))
    headers.set('originator', 'pi')
    const base = endpoint.replace(/\/+$/, '')
    const root = base.endsWith('/codex') ? base : `${base}/codex`
    const clientVersion = resolveCodexDirectoryClientVersion(stored?.codexDirectoryClientVersion)
    const found = readCodexListing(await readEndpoint(
      `${root}/models?client_version=${encodeURIComponent(clientVersion)}`, headers, request.signal,
    ))
    publish(nativeModels(sourceProvider, found, endpoint))
    return found
  }
  if (onlineXai) {
    if (!headers.has('authorization')) {
      throw new LlmError('xAI model discovery requires an API key or subscription sign-in', 'MISSING_CREDENTIAL')
    }
    const directory = readListing(await readEndpoint(`${endpoint.replace(/\/+$/, '')}/models`, headers, request.signal))
    const body = await readEndpoint(`${endpoint.replace(/\/+$/, '')}/language-models`, headers, request.signal)
    if (typeof body !== 'object' || body === null || !('models' in body) || !Array.isArray(body.models)) {
      throw new LlmError('xAI language-model directory did not contain a models array', 'DISCOVERY_FAILED')
    }
    const metadata = new Map(directory.map(model => [model.id, model]))
    const found = readListing({ data: body.models }, false).map(model => ({
      ...metadata.get(model.id),
      ...model,
      name: model.name ?? metadata.get(model.id)?.name ?? model.id,
    }))
    publish(nativeModels(sourceProvider, found, endpoint))
    return found
  }
  return readListing(await readEndpoint(listingUrl(endpoint, api), headers, request.signal))
}
