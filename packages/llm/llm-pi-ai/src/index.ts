/**
 * Generic pi-ai-backed LLM adapter plugin. One plugin instance owns a dict of
 * provider routes; a route may inherit the installed catalog under its own key
 * or explicitly select another provider's catalog while keeping its route
 * identity, and a route with no catalog source is declared outright. Native
 * account directories update model descriptors beneath profile customizations.
 * Profile facts resolve per request over the optional `llm-pi-ai` user-settings section and the optional
 * credential seam, so a changed key, endpoint, model, or knob reaches the next
 * request without a restart; a changed *route set* (or a route's
 * registration-captured retry policy) re-registers the same adapter instance
 * in place.
 *
 * ```yaml
 * - id: llm
 *   name: '@deepseek-ai/dsh-llm-pi-ai'
 *   config:
 *     providers:
 *       # Catalog route: everything but the credential comes from pi-ai.
 *       openai:
 *         apiKeyEnv: OPENAI_API_KEY
 *         retryPolicy:
 *           mode: normal
 *           maxRetries: 2
 *       # Catalog route with the catalog narrowed and one capacity corrected.
 *       anthropic:
 *         apiKeyEnv: ANTHROPIC_API_KEY
 *         models:
 *           - id: claude-sonnet-4-5
 *             contextWindow: 200000
 *       # Custom route reusing OpenAI's official catalog metadata.
 *       openai-proxy:
 *         catalogProvider: openai
 *         apiKeyEnv: OPENAI_PROXY_API_KEY
 *         api: openai-completions
 *         baseURL: https://proxy.example/v1
 *         models:
 *           - id: gpt-5.6-sol
 *       # Hand-declared route: pi-ai ships nothing under this key.
 *       acme-gateway:
 *         displayName: Acme Gateway
 *         apiKeyEnv: ACME_GATEWAY_API_KEY
 *         api: openai-completions
 *         baseURL: https://gateway.acme.example/v1
 *         # Reasoning dialect for a URL pi-ai cannot recognize.
 *         compat:
 *           thinkingFormat: deepseek
 *         models:
 *           - id: acme-large
 *             name: Acme Large
 *             contextWindow: 65536
 *             maxTokens: 4096
 *           - id: acme-think
 *             name: Acme Think
 *             contextWindow: 262144
 *             maxTokens: 32768
 *             # key = selectable level, value = wire spelling; only off may
 *             # leave the value empty (supported, send nothing).
 *             reasoningEfforts:
 *               off:
 *               high: high
 *               max: ultra
 * ```
 *
 * @module @deepseek-ai/dsh-llm-pi-ai
 */
import type {} from '@deepseek-ai/dsh-settings'

import type {} from '@deepseek-ai/cordis-plugin-loader'

import type { Context } from '@deepseek-ai/cordis'
import type { Api, Model } from '@earendil-works/pi-ai'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { assertUsableApiKey, LlmError, resolveImageAttachmentAccess } from '@deepseek-ai/dsh-llm'
import type { AdapterRegistrationHandle, DirectoryRegistrationHandle, LlmConfigurableProvider } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-fs'
import { deepEqualJson } from '@deepseek-ai/dsh-util-values'
import { PiAiAdapter } from './adapter.ts'
import { authContextFrom, credentialStoreFrom } from './auth.ts'
import { catalogProvider, catalogProviderIds } from './catalog.ts'
import { assertServiceable, Config, resolveModelCatalogTiming, resolveProfiles } from './config.ts'
import type { ResolvedPiAiProviderProfile } from './config.ts'
import { LiveCatalogSync } from './live-catalog-sync.ts'
import { discoverModels } from './discovery.ts'
import type { StoredModelDiscoveryProfile } from './discovery.ts'
import { registerPiAiFlows } from './login.ts'
import { createModels } from './models.ts'
import { createModelDirectoryReader } from './model-directory-http.ts'
import { providerDefaultsOf } from './provider-data.ts'

export { PiAiAdapter } from './adapter.ts'
export type { PiAiAdapterOptions } from './adapter.ts'
export { Config } from './config.ts'
export type {
  Options,
  PiAiCompatProfile,
  PiAiModality,
  PiAiModelOverride,
  PiAiModelProfile,
  PiAiProviderProfile,
  PiAiReasoningEfforts,
  PiAiThinkingFormat,
  ResolvedPiAiProviderProfile,
} from './config.ts'
export { recordKeyFor } from './auth.ts'
export { supportedProtocols } from './provider.ts'

export const name = 'llm-pi-ai'
export const inject = ['llm']

const NS = 'llm-pi-ai'

/**
 * The registry captures these per route; a change here must re-register.
 * Sorted by provider so a settings document that merely reorders its keys is
 * not mistaken for a route change.
 */
function registrationFacts(profiles: ReadonlyMap<string, ResolvedPiAiProviderProfile>): unknown {
  return [...profiles.entries()]
    // `displayName` rides along because the registry hands it to every selector
    // through `providerInfo()`: a rename that did not re-register would leave
    // the old label showing until some unrelated fact happened to change.
    .map(([provider, profile]) => ({
      provider,
      displayName: profile.displayName,
      retryPolicy: profile.retryPolicy,
    }))
    .sort((left, right) => left.provider.localeCompare(right.provider))
}

/**
 * The configurable-provider directory: every installed catalog route, plus
 * every route the current profiles declare. A hand-declared route has no
 * catalog entry, so without this union it would have no settings address and
 * configuration surfaces could neither show nor edit it. A catalog route also
 * carries its catalog endpoint and native authentication, which a settings
 * editor shows while the profile leaves the endpoint or the credential
 * reference unset.
 * @param profiles - the currently resolved provider profiles.
 * @returns the directory entries in catalog order, declared routes last.
 */
function directoryEntries(
  profiles: ReadonlyMap<string, ResolvedPiAiProviderProfile>,
  settingsNs: string,
): LlmConfigurableProvider[] {
  const entries = new Map<string, LlmConfigurableProvider>()
  const declare = (provider: string, displayName: string, error?: string): void => {
    const installed = catalogProvider(provider)
    entries.set(provider, {
      provider,
      displayName,
      settingsNs,
      settingsPath: ['providers', provider],
      // Membership of the installed catalog, not of the settings document:
      // narrowing a shipped provider's models stores a profile too, and that
      // route is still one pi-ai knows.
      declared: installed === undefined,
      ...installed === undefined ? {} : providerDefaultsOf(installed),
      ...error === undefined ? {} : { error },
    })
  }
  for (const provider of catalogProviderIds()) declare(provider, provider)
  for (const [provider, profile] of profiles) declare(provider, profile.displayName, profile.catalogError)
  return [...entries.values()]
}


/** Account directories published by this Host root, shared across row re-applies. */
interface PublishedCatalogState {
  readonly models: Map<string, readonly Model<Api>[]>
  readonly errors: Map<string, string>
  readonly sources: Map<string, unknown>
  readonly cleared: Set<string>
  readonly retired: Map<string, readonly string[]>
  readonly observedAt: Map<string, string>
  directory?: DirectoryRegistrationHandle
  directoryFacts?: unknown
}
const publishedCatalogs = new WeakMap<Context, PublishedCatalogState>()
function publishedState(ctx: Context): PublishedCatalogState {
  const root = ctx.root
  let state = publishedCatalogs.get(root)
  if (state === undefined) {
    state = { models: new Map(), errors: new Map(), sources: new Map(), cleared: new Set(), retired: new Map(), observedAt: new Map() }
    publishedCatalogs.set(root, state)
  }
  return state
}

/** Register one generic pi-ai adapter for all configured provider routes. */
export function apply(ctx: Context, config: Config): void {
  resolveModelCatalogTiming(config)
  ctx.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
  const settingsNs = ctx.fiber.entry?.options.id ?? NS
  const readDirectory = createModelDirectoryReader()
  const published = publishedState(ctx)
  const catalogErrors = published.errors
  const catalogSources = published.sources
  const sourceCleared = published.cleared
  const directoryAt = published.observedAt
  const retiredModels = published.retired
  const runtimeCatalogs = published.models
  let catalogRevision = 0
  let lastCatalogRevision = -1

  /**
   * Profiles resolve from the configuration identity and Host catalog revision.
   * Operations with neither change share an immutable adapter snapshot.
   *
   * Model-resolution diagnostics stay beside serviceable models, so stored
   * configuration remains editable after its catalog changes.
   * Scalar configuration errors still reject resolution.
   */
  let currentConfig: Config = config
  const current = (): Config => currentConfig
  let lastRaw: ReturnType<Config['providers']['get']> | undefined
  let memoized: ReadonlyMap<string, ResolvedPiAiProviderProfile> | undefined
  const profiles = (): ReadonlyMap<string, ResolvedPiAiProviderProfile> => {
    const raw = config.providers.get()
    if (raw === lastRaw && lastCatalogRevision === catalogRevision && memoized !== undefined) return memoized
    const next = resolveProfiles(structuredClone(raw) as import('./config.ts').Options['providers'], 'deferred', runtimeCatalogs)
    lastRaw = raw
    memoized = next
    lastCatalogRevision = catalogRevision
    return next
  }
  profiles()

  /** Publish one route's refreshed account directory and retire the ids it dropped. */
  function publishCatalog(provider: string, models: readonly Model<Api>[]): void {
    const previous = runtimeCatalogs.get(provider)
    const hadError = catalogErrors.delete(provider)
    const cleared = sourceCleared.delete(provider)
    if (!hadError && !cleared && deepEqualJson(previous, models)) return
    if (previous !== undefined && previous.length > 0) {
      const nextIds = new Set(models.map(model => model.id))
      const retired = previous.map(model => model.id).filter(id => !nextIds.has(id))
      if (retired.length > 0) retiredModels.set(provider, retired)
      else retiredModels.delete(provider)
    }
    directoryAt.set(provider, new Date().toISOString())
    runtimeCatalogs.set(provider, models)
    catalogRevision += 1
    ensureRegistrationFacts()
    ensureDirectory()
    // The adapters carry the resolved model list, so a published directory always rebuilds them.
    registration?.replace([...profiles().keys()])
  }

  /** Native account directories synchronize automatically; private endpoints opt in explicitly. */
  function onlineProviders(source: Config = current()): readonly string[] {
    return Object.entries(source.providers.get()).flatMap(([provider, profile]) => {
      const source = profile.catalogProvider ?? provider
      if (!['openai-codex', 'opencode-go', 'xai'].includes(source) || profile.api !== undefined) return []
      if (profile.baseURL !== undefined && profile.modelCatalogMode !== 'live') {
        const base = catalogProvider(source)?.baseUrl
        if (base === undefined || !URL.canParse(profile.baseURL) || new URL(profile.baseURL).origin !== new URL(base).origin) return []
      }
      return [provider]
    })
  }

  const catalogs = new LiveCatalogSync({
    providers: onlineProviders,
    timeoutMs: () => resolveModelCatalogTiming(current()).timeoutMs,
    refreshMs: () => resolveModelCatalogTiming(current()).refreshMs,
    fetch: async (provider, signal) => {
      let models: readonly Model<Api>[] | undefined
      const stored = storedDiscoveryProfile(provider)
      await discoverModels({ provider, refresh: true, signal }, () => ({
        ...stored as StoredModelDiscoveryProfile,
        publishCatalog: (candidate) => { models = candidate },
      }))
      return models as readonly Model<Api>[]
    },
    publish: publishCatalog,
    failure: (provider, error) => {
      const message = error instanceof LlmError ? error.message : 'Model directory could not be loaded; check account sign-in and refresh'
      const observedAt = new Date().toISOString()
      catalogErrors.set(provider, `${message} (directory observed at ${observedAt})`)
      directoryAt.set(provider, observedAt)
      ensureDirectory()
      ctx.logger.warn('llm-pi-ai: model directory for "%s": %s', provider, message)
    },
  })

  /** Drop one route's published models until the next successful directory. */
  function clearCatalogSource(provider: string): void {
    runtimeCatalogs.set(provider, [])
    sourceCleared.add(provider)
    retiredModels.delete(provider)
    directoryAt.delete(provider)
    catalogRevision += 1
  }

  /** Route facts that decide which account directory serves this provider. */
  function catalogSource(provider: string): unknown {
    const profile = current().providers.get()[provider]
    return { provider: profile?.catalogProvider ?? provider, baseURL: profile?.baseURL,
      api: profile?.api, apiKeyEnv: profile?.apiKeyEnv, headers: profile?.headers,
      codexDirectoryClientVersion: profile?.codexDirectoryClientVersion }
  }

  /** Re-schedule every online route whose source changed after a stored configuration change. */
  function synchronizeSources(source: Config = current()): void {
    const active = new Set(onlineProviders(source))
    let changed = false
    for (const provider of new Set([...catalogSources.keys(), ...active])) {
      const facts = catalogSource(provider)
      if (active.has(provider) && deepEqualJson(facts, catalogSources.get(provider))) continue
      changed = true
      catalogs.invalidate(provider)
      if (active.has(provider) && catalogSources.has(provider)) clearCatalogSource(provider)
      else {
        runtimeCatalogs.delete(provider)
        catalogErrors.delete(provider)
        sourceCleared.delete(provider)
        retiredModels.delete(provider)
        directoryAt.delete(provider)
        catalogRevision += 1
      }
      if (active.has(provider)) catalogSources.set(provider, facts)
      else catalogSources.delete(provider)
    }
    // Rescheduling every route would re-fetch unchanged ones after each stored write.
    if (changed) catalogs.notify()
  }

  ctx.effect(() => {
    synchronizeSources()
    catalogs.start()
    return () => catalogs.close()
  })

  ctx.on('internal/config', function (this: import('@deepseek-ai/cordis').Fiber, _raw, next) {
    const raw: unknown = next()
    if (this !== ctx.fiber) return raw
    const candidate = Config(raw as import('./config.ts').Options)
    // A stored write lands as a configuration event, not a re-apply: resynchronize here.
    currentConfig = candidate
    // The stored row may be mutated in place, so the resolved-profile cache must drop.
    lastRaw = undefined
    memoized = undefined
    synchronizeSources(candidate)
    // A refused swap costs a diagnostic, not the routes already serving: the registry and
    // the configurable-provider directory are each contained separately.
    try {
      ensureRegistrationFacts()
    } catch (error) {
      ctx.logger.error('llm-pi-ai: keeping the previously registered routes after a refused update')
      ctx.logger.error(error)
    }
    try {
      ensureDirectory()
    } catch (error) {
      ctx.logger.error('llm-pi-ai: keeping the previous configurable-provider directory after a refused update')
      ctx.logger.error(error)
    }
    assertServiceable(
      { providers: structuredClone(candidate.providers.get()) as Record<string, import('./config.ts').PiAiProviderProfile> },
      { providers: structuredClone(config.providers.get()) as Record<string, import('./config.ts').PiAiProviderProfile> },
    )
    return raw
  })

  const resolveApiKey = async (
    provider: string,
    profile: ResolvedPiAiProviderProfile,
  ): Promise<string | undefined> => {
    const ref = profile.apiKeyEnv
    // Only a profile that names no credential at all defers to pi-ai's
    // provider-native discovery. Once one is named, a miss must fail loud:
    // handing pi-ai `undefined` would let it pick up an unrelated ambient key
    // (OPENAI_API_KEY and friends), billing another tenant for a request the
    // deployment meant to authenticate differently.
    if (ref === undefined) return undefined
    const credentials = ctx.get('credentials')
    const hit = credentials !== undefined
      ? (await credentials.resolve(ref))?.value
      // Without the seam the environment is the whole credential plane.
      : launchEnvironmentOf(ctx).get(ref)?.value
    if (hit !== undefined && hit.length > 0) return assertUsableApiKey(hit, 'llm-pi-ai', ref)
    throw new LlmError(
      `llm-pi-ai: no credential for provider route "${provider}"; its profile resolves ${ref}, which is not`
      + ` set — store ${ref} through the credentials service (the web Models page writes it) or export it,`
      + ' and remove apiKeyEnv only if this provider should authenticate from pi-ai\'s own environment discovery',
      'MISSING_CREDENTIAL',
    )
  }

  // One store and one ambient context for the whole plugin instance: both read
  // through `ctx` per call, so they stay correct across the collection rebuilds
  // a configuration change causes, and a sign-in survives one.
  const authBase = { credentials: credentialStoreFrom(ctx), authContext: authContextFrom(ctx) }
  const ownCredentialWrites = new Set<string>()
  const credentialStore: typeof authBase.credentials = {
    ...authBase.credentials,
    modify: async (provider, mutate) => {
      const rotation = { active: false }
      try {
        return await authBase.credentials.modify(provider, async (credential) => {
          const next = await mutate(credential)
          // Native auth updates preserve the account; new sign-ins use the unwrapped store.
          // This callback holds the record writer lock, so no external write is hidden.
          rotation.active = true
          ownCredentialWrites.add(provider)
          return next
        })
      } finally {
        if (rotation.active) {
          ownCredentialWrites.delete(provider)
        }
      }
    },
  }
  const auth = { credentials: credentialStore, authContext: authBase.authContext }
  const adapter = new PiAiAdapter({
    profiles,
    resolveApiKey,
    auth,
    resolveAttachments: () => ctx.get('attachments'),
    resolveImageAccess: (attachments, ref) => resolveImageAttachmentAccess(
      attachments,
      hostPath => ctx.get('fs')?.processPathFromHostPath(hostPath),
      ref,
    ),
    onReplayDegrade: ({ provider, model, reason }) => {
      ctx.logger.warn(
        `llm-pi-ai: unusable replay state on assistant history for route "${provider}/${model}";`
        + ` sending that message as provider-neutral content (${reason})`,
      )
    },
  })
  // Independent of the route set: signing in is what makes a route worth
  // adding, so the flows are offered before any profile names their provider.
  // Scoped to the authorization seam rather than injected outright, because a
  // composition without it (headless, ACP) simply has no surface to sign in
  // from, while everything else this plugin does still works.
  ctx.inject(['authorization'], (authorized) => { registerPiAiFlows(authorized, authBase) })
  // The full installed catalog is configurable from the moment the plugin
  // mounts — dormant or not — so configuration surfaces can offer every
  // pi-ai provider before any route exists. Hand-declared routes join it as
  // profiles appear, and leave with them.
  const ensureDirectory = (): void => {
    const entries = directoryEntries(profiles(), settingsNs).map((entry) => {
      const error = catalogErrors.get(entry.provider)
      const observedAt = directoryAt.get(entry.provider)
      const retired = retiredModels.get(entry.provider)
      return {
        ...entry,
        ...error === undefined ? {} : { error },
        ...observedAt === undefined ? {} : { directoryAt: observedAt },
        ...retired === undefined || retired.length === 0 ? {} : { retiredModels: retired },
      }
    })
    if (deepEqualJson(entries, published.directoryFacts)) return
    // Atomic replace, never dispose-then-register: a route another adapter
    // family already declares (a profile keyed `deepseek-official`) would
    // otherwise leave this plugin's whole directory withdrawn and the Models
    // page empty. The candidate set is validated first, so a collision keeps
    // the previous entries serving and only costs a diagnostic.
    if (published.directory === undefined) {
      published.directory = ctx.root.llm.registerConfigurableProviders(entries)
    } else {
      published.directory.replace(entries)
    }
    published.directoryFacts = entries
  }
  // A mount that collides with another adapter family keeps serving the routes already there.
  try {
    ensureDirectory()
  } catch (error) {
    ctx.logger.error('llm-pi-ai: keeping the previous configurable-provider directory after a refused mount')
    ctx.logger.error(error)
  }
  /** Host-owned route facts and live authentication for explicit model discovery. */
  const storedDiscoveryProfile = (
    provider: string | undefined,
  ): StoredModelDiscoveryProfile | undefined => {
    if (provider === undefined) return undefined
    const profile = profiles().get(provider)
    const sourceProvider = profile?.catalogProvider ?? provider
    const native = profile?.piProvider ?? catalogProvider(sourceProvider)
    if (profile === undefined && native === undefined) return undefined
    const runtimeModels = runtimeCatalogs.get(provider)
    return {
      readDirectory,
      headers: profile?.headers,
      ...profile?.baseURL === undefined ? {} : { baseURL: profile.baseURL },
      catalogProvider: profile?.catalogProvider ?? provider,
      // The stored row carries the compatibility version most recently written, which may
      // lead the resolved default for one configuration event.
      codexDirectoryClientVersion: current().providers.get()[provider]?.codexDirectoryClientVersion
        ?? profile?.codexDirectoryClientVersion ?? '',
      resolveApiKey: () => profile === undefined ? Promise.resolve(undefined) : resolveApiKey(provider, profile),
      ...runtimeModels === undefined ? {} : { runtimeModels },
      ...native === undefined ? {} : {
        resolveNativeAuth: async (signal?: AbortSignal) => {
          const models = createModels({ credentials: credentialStore, authContext: auth.authContext })
          models.setProvider({ ...native, id: provider })
          // pi-ai lets a started refresh outlive the caller's signal so a rotated token is
          // never discarded; its own lock wait is what releases a cancelled caller.
          return (await models.getAuth(provider, signal === undefined ? undefined : { signal }))?.auth
        },
      },
    }
  }
  // Interrogating an endpoint is a configuration-time action over a draft, so
  // it is offered for the whole namespace rather than per route: the provider
  // a surface is adding does not exist yet. The draft is the whole request
  // except the stored credential and deployment-owned headers: the curated UI
  // accepts neither, so an already-configured route supplies both inside the
  // Host rather than widening the discovery request.
  ctx.llm.registerModelDiscovery(settingsNs, (request, signal) => {
    // A bare lookup of a native account route serves the models its profile declares;
    // an explicit protocol or key is a draft probe against the endpoint.
    const nativeRoute = request.provider !== undefined && ['xai', 'openai-codex', 'opencode-go'].includes(
      current().providers.get()[request.provider]?.catalogProvider ?? request.provider,
    )
    const declarable = request.refresh !== true && request.api === undefined && request.apiKey === undefined
      && nativeRoute
    const declared = !declarable ? undefined : request.provider === undefined
      ? undefined
      : current().providers.get()[request.provider]?.models
    if (declared !== undefined && declared.length > 0) {
      return Promise.resolve(declared.map(model => ({
        id: model.id,
        ...model.name === undefined ? {} : { name: model.name },
        ...model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow },
        ...model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens },
        ...model.input === undefined ? {} : { inputModalities: [...model.input] },
      })))
    }
    return discoverModels(
      { ...request, ...signal === undefined ? {} : { signal } },
      () => storedDiscoveryProfile(request.provider),
    )
  })
  // Route effects bind to this apply fiber via the stable `ctx` reference,
  // even when a swap runs inside the scoped settings callback below. A bare
  // mount (zero routes) is the dormant posture: nothing registers until a
  // settings section supplies profiles, and routes drop when it empties.
  let registration: AdapterRegistrationHandle | undefined
  let registeredFacts: unknown
  const ensureRegistrationFacts = (): void => {
    const facts = registrationFacts(profiles())
    if (deepEqualJson(facts, registeredFacts)) return
    // The registry captures the route set and each route's retry policy at
    // registration, so a change to either must re-register. The swap is
    // atomic (same adapter instance, validated before anything moves): a
    // conflicting route leaves the previous routes serving requests, and
    // `registeredFacts` only advances once the registry actually holds the
    // new set — so returning to a working configuration always re-applies.
    const routes = [...profiles().keys()]
    if (registration === undefined) {
      // Dormant bare mount: nothing is registered until a section supplies
      // profiles, and an empty section keeps it that way.
      if (routes.length === 0) {
        registeredFacts = facts
        return
      }
      // A route another adapter family already owns is refused by name: drop only that
      // route and keep the rest serving instead of withdrawing the whole set.
      let remaining = [...routes]
      while (remaining.length > 0) {
        try {
          registration = ctx.llm.registerAdapter(remaining, adapter)
          break
        } catch (error) {
          const refused = /provider "([^"]+)"/u.exec(String(error))?.[1]
          if (refused === undefined || !remaining.includes(refused)) throw error
          catalogErrors.set(refused, String(error))
          remaining = remaining.filter(id => id !== refused)
        }
      }
    } else {
      registration.replace(routes)
    }
    registeredFacts = facts
  }
  // A swap that collides with a route another family owns keeps the previous routes serving.
  try {
    ensureRegistrationFacts()
  } catch (error) {
    ctx.logger.error('llm-pi-ai: keeping the previously registered routes after a refused mount')
    ctx.logger.error(error)
  }

  ctx.on('loader/volatile-update', () => {
    try { ensureRegistrationFacts(); ensureDirectory() }
    catch (error) {
      ctx.logger.error('llm-pi-ai: configuration conflicts with an existing provider route')
      ctx.logger.error(error)
    }
  })
}
