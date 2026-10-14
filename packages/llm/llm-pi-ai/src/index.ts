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

import { FiberState, type Context } from '@deepseek-ai/cordis'
import type { Api, Model } from '@earendil-works/pi-ai'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { assertUsableApiKey, LlmError, resolveImageAttachmentAccess } from '@deepseek-ai/dsh-llm'
import type { AdapterRegistrationHandle, DirectoryRegistrationHandle, LlmConfigurableProvider } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-settings'
import { deepEqualJson } from '@deepseek-ai/dsh-util-values'
import { PiAiAdapter } from './adapter.ts'
import { authContextFrom, credentialStoreFrom } from './auth.ts'
import { catalogProvider, catalogProviderIds } from './catalog.ts'
import { assertServiceable, Config, resolveModelCatalogTiming, resolveProfiles } from './config.ts'
import type { ResolvedPiAiProviderProfile } from './config.ts'
import { discoverModels } from './discovery.ts'
import type { StoredModelDiscoveryProfile } from './discovery.ts'
import { registerPiAiFlows } from './login.ts'
import { createModels } from './models.ts'
import { LiveCatalogSync } from './live-catalog-sync.ts'
import { createModelDirectoryReader } from './model-directory-http.ts'

export { PiAiAdapter } from './adapter.ts'
export type { PiAiAdapterOptions } from './adapter.ts'
export { Config } from './config.ts'
export type {
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
 * configuration surfaces could neither show nor edit it.
 * @param profiles - the currently resolved provider profiles.
 * @returns the directory entries in catalog order, declared routes last.
 */
function directoryEntries(
  profiles: ReadonlyMap<string, ResolvedPiAiProviderProfile>,
): LlmConfigurableProvider[] {
  const catalog = new Set(catalogProviderIds())
  const entries = new Map<string, LlmConfigurableProvider>()
  const declare = (provider: string, displayName: string, error?: string): void => {
    entries.set(provider, {
      provider,
      displayName,
      settingsNs: NS,
      settingsPath: ['providers', provider],
      // Membership of the installed catalog, not of the settings document:
      // narrowing a shipped provider's models stores a profile too, and that
      // route is still one pi-ai knows.
      declared: !catalog.has(provider),
      ...error === undefined ? {} : { error },
    })
  }
  for (const provider of catalog) declare(provider, provider)
  for (const [provider, profile] of profiles) declare(provider, profile.displayName, profile.catalogError)
  return [...entries.values()]
}

/** Register one generic pi-ai adapter for all configured provider routes. */
export function apply(ctx: Context, config: Config): void {
  resolveModelCatalogTiming(config)
  let current: () => Config = () => config
  const runtimeCatalogs = new Map<string, readonly Model<Api>[]>()
  const readDirectory = createModelDirectoryReader()
  const catalogErrors = new Map<string, string>()
  const catalogSources = new Map<string, unknown>()
  let catalogRevision = 0
  let lastCatalogRevision = -1
  let lastRaw: Config | undefined
  let memoized: ReadonlyMap<string, ResolvedPiAiProviderProfile> | undefined
  /**
   * Profiles resolve from the configuration identity and Host catalog revision.
   * Operations with neither change share an immutable adapter snapshot.
   *
   * Model-resolution diagnostics stay beside serviceable models, so stored
   * configuration remains editable after its catalog changes.
   * Scalar configuration errors still reject resolution.
   */
  const profiles = (): ReadonlyMap<string, ResolvedPiAiProviderProfile> => {
    const raw = current()
    if (raw === lastRaw && lastCatalogRevision === catalogRevision && memoized !== undefined) return memoized
    const next = resolveProfiles(raw.providers, 'deferred', runtimeCatalogs)
    lastRaw = raw
    lastCatalogRevision = catalogRevision
    memoized = next
    return next
  }
  profiles()

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
  let directory: DirectoryRegistrationHandle | undefined
  let directoryFacts: unknown
  const ensureDirectory = (): void => {
    const entries = directoryEntries(profiles()).map((entry) => {
      const error = catalogErrors.get(entry.provider)
      return { ...entry, ...error === undefined ? {} : { error } }
    })
    if (deepEqualJson(entries, directoryFacts)) return
    // Atomic replace, never dispose-then-register: a route another adapter
    // family already declares (a profile keyed `deepseek-official`) would
    // otherwise leave this plugin's whole directory withdrawn and the Models
    // page empty. The candidate set is validated first, so a collision keeps
    // the previous entries serving and only costs a diagnostic.
    if (directory === undefined) {
      directory = ctx.llm.registerConfigurableProviders(entries)
    } else {
      directory.replace(entries)
    }
    directoryFacts = entries
  }
  ensureDirectory()
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
      ...profile === undefined ? {} : { codexDirectoryClientVersion: profile.codexDirectoryClientVersion },
      resolveApiKey: () => profile === undefined ? Promise.resolve(undefined) : resolveApiKey(provider, profile),
      ...runtimeModels === undefined ? {} : { runtimeModels },
      ...native === undefined ? {} : {
        resolveNativeAuth: async (signal?: AbortSignal) => {
          const models = createModels({ credentials: credentialStore, authContext: auth.authContext })
          models.setProvider({ ...native, id: provider })
          return (await models.getAuth(provider, signal === undefined ? undefined : { signal }))?.auth
        },
      },
    }
  }
  // Namespace-wide discovery serves drafts before their route is configured.
  // Stored native refreshes share the Host's catalog coordinator; draft keys,
  // endpoints, and protocols cannot publish into its account directory.
  // Stored credentials and deployment headers remain on the Host, where native
  // authentication is available before the first profile is saved.
  ctx.llm.registerModelDiscovery(NS, async (request, signal) => {
    const provider = request.provider
    const profile = provider === undefined ? undefined : profiles().get(provider)
    if (request.refresh === true && provider !== undefined && onlineProviders().includes(provider)
      && request.apiKey === undefined && request.api === undefined
      && (request.baseURL === undefined || request.baseURL === profile?.baseURL)) {
      await catalogs.refresh(provider, signal)
      return discoverModels({ provider }, () => storedDiscoveryProfile(provider))
    }
    return discoverModels({ ...request, ...signal === undefined ? {} : { signal } }, () => storedDiscoveryProfile(provider))
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
      registration = ctx.llm.registerAdapter(routes, adapter)
    } else {
      registration.replace(routes)
    }
    registeredFacts = facts
  }
  ensureRegistrationFacts()

  /** Settings that select a directory authority and its authentication. */
  function catalogSource(provider: string): unknown {
    const profile = current().providers?.[provider]
    return { provider: profile?.catalogProvider ?? provider, baseURL: profile?.baseURL,
      api: profile?.api, apiKeyEnv: profile?.apiKeyEnv, headers: profile?.headers,
      codexDirectoryClientVersion: profile?.codexDirectoryClientVersion }
  }

  /** Publish complete Host metadata and invalidate the consumers of this route's models. */
  function publishCatalog(provider: string, models: readonly Model<Api>[]): void {
    const previous = runtimeCatalogs.get(provider)
    const hadError = catalogErrors.delete(provider)
    if (!hadError && deepEqualJson(previous, models)) return
    runtimeCatalogs.set(provider, models)
    catalogRevision += 1
    const previousDirectory = directoryFacts
    ensureRegistrationFacts()
    ensureDirectory()
    if (previousDirectory === directoryFacts) registration?.replace([...profiles().keys()])
  }

  /** Native account directories synchronize automatically; private endpoints opt in explicitly. */
  function onlineProviders(): readonly string[] {
    return Object.entries(current().providers ?? {}).flatMap(([provider, profile]) => {
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
      // The coordinator invokes only current, configured native sources.
      const stored = storedDiscoveryProfile(provider) as StoredModelDiscoveryProfile
      await discoverModels({ provider, refresh: true, signal }, () => ({ ...stored,
        publishCatalog: (candidate) => { models = candidate },
      }))
      // Each eligible source publishes native metadata before its successful refresh returns.
      return models as readonly Model<Api>[]
    },
    publish: publishCatalog,
    failure: (provider, error) => {
      const message = error instanceof LlmError ? error.message : 'Model directory could not be loaded; check account sign-in and refresh'
      catalogErrors.set(provider, message)
      ensureDirectory()
      ctx.logger.warn('llm-pi-ai: model directory for "%s": %s', provider, message)
    },
  })

  /** Invalidate directories after their endpoint or credential selection changes. */
  function synchronizeSources(): void {
    const active = new Set(onlineProviders())
    for (const provider of new Set([...catalogSources.keys(), ...active])) {
      const source = catalogSource(provider)
      if (active.has(provider) && deepEqualJson(source, catalogSources.get(provider))) continue
      catalogs.invalidate(provider)
      if (active.has(provider) && catalogSources.has(provider)) runtimeCatalogs.set(provider, [])
      else runtimeCatalogs.delete(provider)
      catalogErrors.delete(provider)
      catalogRevision += 1
      if (active.has(provider)) catalogSources.set(provider, source)
      else catalogSources.delete(provider)
    }
    catalogs.notify()
  }

  ctx.on('credentials/record-updated', (key) => {
    const provider = onlineProviders().find(route => `llm-pi-ai/${route}` === key)
    if (provider === undefined) return
    if (ownCredentialWrites.has(provider)) { catalogs.notify(); return }
    catalogs.invalidate(provider)
    runtimeCatalogs.set(provider, [])
    catalogErrors.delete(provider)
    catalogRevision += 1
    ensureRegistrationFacts()
    ensureDirectory()
    catalogs.notify()
  })
  ctx.on('credentials/reference-updated', (ref) => {
    for (const provider of onlineProviders()) {
      if (profiles().get(provider)?.apiKeyEnv !== ref) continue
      catalogs.invalidate(provider)
      runtimeCatalogs.set(provider, [])
      catalogErrors.delete(provider)
      catalogRevision += 1
    }
    ensureRegistrationFacts()
    ensureDirectory()
    catalogs.notify()
  })
  ctx.inject(['authorization'], (authorized) => {
    authorized.on('authorization/settled', (key, settlement) => {
      if (settlement !== 'authorized') return
      const provider = onlineProviders().find(route => `llm-pi-ai/${route}` === key)
      if (provider === undefined) return
      catalogs.invalidate(provider)
      runtimeCatalogs.set(provider, [])
      catalogErrors.delete(provider)
      catalogRevision += 1
      ensureRegistrationFacts()
      ensureDirectory()
      catalogs.notify()
    })
  })
  let credentialsReady = ctx.get('credentials') !== undefined
  ctx.on('internal/service', (service) => {
    if (service === 'credentials' && ctx.get('credentials') === undefined) credentialsReady = false
  })
  ctx.inject(['credentials'], (credentialCtx) => {
    /** Invalidate account metadata when the optional credential service becomes ready or leaves. */
    function synchronizeCredentials(): void {
      for (const provider of onlineProviders()) {
        catalogs.invalidate(provider)
        runtimeCatalogs.set(provider, [])
        catalogErrors.delete(provider)
        catalogRevision += 1
      }
      ensureRegistrationFacts()
      ensureDirectory()
      catalogs.notify()
    }
    credentialCtx.effect(() => {
      if (!credentialsReady) synchronizeCredentials()
      credentialsReady = true
      return () => {
        credentialsReady = false
        if (ctx.fiber.state === FiberState.ACTIVE) synchronizeCredentials()
      }
    })
  })
  ctx.effect(() => {
    synchronizeSources()
    catalogs.start()
    return () => catalogs.close()
  })

  ctx.inject(['settings'], (settingsCtx) => {
    let registering = true
    settingsCtx.settings.installSection(ctx, NS, Config, config, {
      validate: (value) => {
        // Stored catalog drift must not prevent registration of the repair UI.
        if (registering) {
          resolveProfiles(value.providers, 'deferred', runtimeCatalogs)
        } else {
          assertServiceable(value, current(), runtimeCatalogs)
        }
      },
      setSource: (source) => {
        current = source
      },
      onChange: () => {
        synchronizeSources()
        // Named here rather than left to the settings watcher: `assertServiceable`
        // cannot see the llm registry, so a profile claiming a route another
        // adapter family owns is stored successfully and only fails at this swap.
        // Without its own diagnostic that refusal reaches the operator as a
        // generic "settings: watcher failed", naming neither the route nor why it
        // is not serving. The previous routes keep serving either way.
        try {
          ensureRegistrationFacts()
        } catch (error) {
          ctx.logger.error('llm-pi-ai: keeping the previously registered routes after a refused update')
          ctx.logger.error(error)
        }
        // The directory follows the profiles the registry accepted, so a route
        // that failed to register is not advertised as configurable. A refused
        // directory swap is contained here for the same reason the registry's
        // is: the previous entries keep serving, and `directoryFacts` stays put
        // so returning to a working configuration re-applies.
        try {
          ensureDirectory()
        } catch (error) {
          ctx.logger.error('llm-pi-ai: keeping the previous configurable-provider directory after a refused update')
          ctx.logger.error(error)
        }
      },
    })
    registering = false
  })
}
