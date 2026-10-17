/** Workspace Go inventory joined with current public model capabilities and native SDK compatibility. */

import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'
import type { Api, Model, ModelThinkingLevel, ThinkingLevelMap } from '@earendil-works/pi-ai'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { THINKING_LEVELS } from './catalog.ts'
import { readModelDirectory } from './model-directory-http.ts'

const CONSOLE_CONFIG = 'https://opencode.ai/console/api/v2/config'
const MODELS_DEV = 'https://models.dev/api.json'
type Fields = Record<string, unknown>

function invalid(field: string): never {
  throw new LlmError(`OpenCode Go directory: invalid ${field}`, 'DISCOVERY_FAILED')
}

function object(value: unknown, field: string): Fields {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return invalid(field)
  return value as Fields
}

function optionalObject(value: unknown, field: string): Fields {
  return value === undefined ? {} : object(value, field)
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) return invalid(field)
  return value
}

function optionalText(value: unknown, field: string): string | undefined {
  return value === undefined ? undefined : text(value, field)
}

function declared(...values: readonly unknown[]): unknown {
  return values.find(value => value !== undefined)
}

function capacity(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) return invalid(field)
  return value
}

function goProvider(response: unknown): Fields {
  const providers = object(object(response, 'Console response').providers, 'Console providers')
  const direct = providers['opencode-go']
  if (direct !== undefined) {
    const provider = object(direct, 'Go provider')
    if (provider.canonical !== undefined && provider.canonical !== 'opencode-go') return invalid('Go canonical provider')
    return provider
  }
  const matches = Object.values(providers).filter(value =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
      && (value as Fields).canonical === 'opencode-go')
  if (matches.length !== 1) {
    throw new LlmError('OpenCode workspace must offer exactly one Go provider', 'DISCOVERY_FAILED')
  }
  return object(matches[0], 'Go provider')
}

function protocol(value: unknown): Api {
  const declared = text(value, 'model package').replace(/^aisdk:/u, '')
  switch (declared) {
    case '@ai-sdk/openai':
    case '@opencode/ai/providers/openai':
    case '@opencode/ai/providers/openai/responses':
    case '@opencode/ai/providers/openai-compatible/responses': return 'openai-responses'
    case '@ai-sdk/openai-compatible':
    case '@opencode/ai/providers/openai/chat':
    case '@opencode/ai/providers/openai-compatible': return 'openai-completions'
    case '@ai-sdk/anthropic':
    case '@opencode/ai/providers/anthropic':
    case '@opencode/ai/providers/anthropic-compatible': return 'anthropic-messages'
    case '@ai-sdk/google': return 'google-generative-ai'
    default: return invalid('unsupported model package')
  }
}

function goEndpoint(value: unknown, api: Api): string {
  const input = text(value, 'Go endpoint')
  if (!URL.canParse(input)) return invalid('Go endpoint')
  const url = new URL(input)
  if (url.origin !== 'https://opencode.ai' || url.username !== '' || url.password !== ''
    || url.search !== '' || url.hash !== '' || url.pathname.includes('%')
    || (url.pathname !== '/inference/go' && !url.pathname.startsWith('/inference/go/'))) {
    return invalid('Go endpoint authority or path')
  }
  const base = url.href.replace(/\/+$/u, '')
  return api === 'anthropic-messages' ? base.replace(/\/v1$/u, '') : base
}

function inputs(value: unknown): ('text' | 'image')[] {
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) return invalid('input modalities')
  const supported = value.filter((item): item is 'text' | 'image' => item === 'text' || item === 'image')
  if (supported.length === 0) return invalid('supported input modalities')
  return [...new Set(supported)]
}

function thinking(metadata: Fields, native: Model<Api> | undefined): Pick<Model<Api>, 'reasoning' | 'thinkingLevelMap'> {
  if (metadata.reasoning !== undefined && typeof metadata.reasoning !== 'boolean') return invalid('reasoning capability')
  const reasoning = metadata.reasoning ?? native?.reasoning ?? false
  if (!reasoning) return { reasoning: false }
  if (metadata.reasoning_options === undefined) {
    // Public metadata that omits the model keeps the installed SDK's map; metadata that
    // names the model but discloses no effort withholds every level.
    if (metadata.reasoning === undefined && native?.thinkingLevelMap !== undefined) {
      return { reasoning: true, thinkingLevelMap: { ...native.thinkingLevelMap } }
    }
    return { reasoning: true, thinkingLevelMap: Object.fromEntries(THINKING_LEVELS.map(level => [level, null])) }
  }
  if (!Array.isArray(metadata.reasoning_options)) return invalid('reasoning options')
  const map: ThinkingLevelMap = Object.fromEntries(THINKING_LEVELS.map(level => [level, null]))
  for (const value of metadata.reasoning_options) {
    const option = object(value, 'reasoning option')
    const type = text(option.type, 'reasoning option type')
    if (type !== 'effort') continue
    if (!Array.isArray(option.values) || !option.values.every(item => item === null || typeof item === 'string')) {
      return invalid('reasoning effort values')
    }
    for (const effort of option.values as readonly unknown[]) {
      if (effort === 'none') map.off = 'none'
      else if (typeof effort === 'string' && THINKING_LEVELS.some(level => level === effort)) map[effort as ModelThinkingLevel] = effort
    }
  }
  return { reasoning: true, thinkingLevelMap: map }
}

function price(value: unknown, fallback: number | undefined): number {
  if (value === undefined) return fallback ?? 0
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return invalid('model cost')
  return value
}

function headers(provider: Fields, model: Fields): Record<string, string> | undefined {
  const merged = new Headers()
  for (const source of [provider.headers, model.headers]) {
    for (const [name, value] of Object.entries(optionalObject(source, 'model headers'))) {
      if (typeof value !== 'string') return invalid('model header value')
      if (/^(authorization|x-api-key|api-key|x-goog-api-key)$/iu.test(name)) continue
      try { merged.set(name, value) } catch { return invalid('model header') }
    }
  }
  const entries = Object.fromEntries(merged)
  return Object.keys(entries).length === 0 ? undefined : entries
}

function materialize(
  key: string, model: Fields, provider: Fields, publicProvider: Fields, publicModels: Fields,
): Model<Api> {
  const id = text(declared(model.modelID, key), 'wire model id')
  const publicEntry = declared(publicModels[id], publicModels[key])
  const metadata = optionalObject(publicEntry, 'public model metadata')
  const metadataProvider = optionalObject(metadata.provider, 'public model provider')
  const api = protocol(declared(model.package, provider.package, metadataProvider.npm, publicProvider.npm))
  const native = getBuiltinModels('opencode-go').find(candidate => candidate.id === id && candidate.api === api)
  const settings = optionalObject(model.settings, 'model settings')
  const providerSettings = optionalObject(provider.settings, 'provider settings')
  const limit = optionalObject(model.limit, 'model limits')
  const metadataLimit = optionalObject(metadata.limit, 'public model limits')
  const capabilities = optionalObject(model.capabilities, 'model capabilities')
  const modalities = optionalObject(metadata.modalities, 'public model modalities')
  const cost = optionalObject(metadata.cost, 'public model cost')
  const reasoning = thinking(metadata, native)
  const canonical = optionalText(metadata.canonical_model_id, 'canonical model id')
  const deepseek = api === 'openai-completions' && canonical?.startsWith('deepseek/') === true
  const adaptive = api === 'anthropic-messages' && Array.isArray(metadata.reasoning_options)
    && metadata.reasoning_options.some(value => value !== null && typeof value === 'object'
      && !Array.isArray(value) && (value as Fields).type === 'effort')
  const compat = deepseek ? { ...native?.compat, supportsStore: false, supportsDeveloperRole: false,
    supportsReasoningEffort: true, maxTokensField: 'max_tokens' as const,
    requiresReasoningContentOnAssistantMessages: true, thinkingFormat: 'deepseek' as const }
    : adaptive ? { ...native?.compat, forceAdaptiveThinking: true } : native?.compat
  const modelHeaders = headers(provider, model)
  return {
    id,
    name: text(declared(model.name, metadata.name, native?.name, id), 'model name'),
    provider: 'opencode-go',
    api,
    baseUrl: goEndpoint(declared(settings.baseURL, providerSettings.baseURL, metadataProvider.api, publicProvider.api), api),
    contextWindow: capacity(declared(limit.context, metadataLimit.context, native?.contextWindow), 'context limit'),
    maxTokens: capacity(declared(limit.output, metadataLimit.output, native?.maxTokens), 'output limit'),
    input: inputs(declared(capabilities.input, modalities.input, native?.input)),
    cost: { input: price(cost.input, native?.cost.input), output: price(cost.output, native?.cost.output),
      cacheRead: price(cost.cache_read, native?.cost.cacheRead), cacheWrite: price(cost.cache_write, native?.cost.cacheWrite) },
    ...reasoning,
    ...compat === undefined ? {} : { compat: { ...compat } },
    ...modelHeaders === undefined ? {} : { headers: modelHeaders },
  }
}

/**
 * Read the workspace's Go models and join their declared routing with current public capabilities.
 * Credentials are sent only to the Console; every inference endpoint must remain in its HTTPS Go subtree.
 * Models absent from public metadata retain only same-protocol SDK capabilities, otherwise reasoning is unknown.
 * @param headers - Console authorization and workspace headers supplied by the credential owner.
 * @param signal - cancellation for both directory reads.
 * @param readDirectory - Host-owned reader with optional conditional public-metadata caching.
 * @returns complete native models addressed by the Console's accepted wire ids, without changing any catalog or settings.
 * @throws when Go is absent, a consumed directory field is invalid, or an endpoint leaves the Go authority.
 */
export async function fetchOpenCodeGoCatalog(
  headers: Headers, signal?: AbortSignal, readDirectory: typeof readModelDirectory = readModelDirectory,
): Promise<readonly Model<Api>[]> {
  signal?.throwIfAborted()
  const provider = goProvider(await readDirectory(CONSOLE_CONFIG, headers, signal))
  const models = object(provider.models, 'Go models')
  if (Object.keys(models).length === 0) return []
  const publicProvider = object(object(await readDirectory(MODELS_DEV, new Headers(), signal), 'public directory')['opencode-go'], 'public Go provider')
  const publicModels = object(publicProvider.models, 'public Go models')
  signal?.throwIfAborted()
  const materialized: Model<Api>[] = []
  const ids = new Set<string>()
  for (const [key, value] of Object.entries(models)) {
    const model = object(value, 'Go model')
    if (model.disabled !== undefined && typeof model.disabled !== 'boolean') return invalid('model disabled flag')
    if (model.disabled === true) continue
    const entry = materialize(key, model, provider, publicProvider, publicModels)
    if (ids.has(entry.id)) return invalid('duplicate wire model id')
    ids.add(entry.id)
    materialized.push(entry)
  }
  return materialized
}
