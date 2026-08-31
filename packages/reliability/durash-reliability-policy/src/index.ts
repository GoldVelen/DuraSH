/**
 * Per-session reliability-loop policy (`ctx.reliabilityPolicy`): the composer
 * switch's Host truth. One durable row per Session holds enablement and the
 * implementation/review selectors; the live LLM catalog is rebuilt on every
 * read so a missing route cannot stay enabled.
 * @module @durash/dsh-reliability-policy
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm/brand'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { reliabilityPolicyDomainSpec } from './spec.ts'
import type { ReliabilityPolicyRow } from './spec.ts'
import type {
  ReliabilityLaneRoute,
  ReliabilityModelOption,
  ReliabilityPolicyConfigureRequest,
  ReliabilityPolicyRequest,
  ReliabilityPolicySnapshot,
} from './types.ts'

export type * from './types.ts'
export { reliabilityPolicyDomainSpec, reliabilityPolicyRow } from './spec.ts'
export type { ReliabilityPolicyRow } from './spec.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    reliabilityPolicy: ReliabilityPolicyService
  }
}

const PROVIDER_LABELS: Readonly<Record<string, string>> = Object.freeze({
  anthropic: 'Anthropic',
  cursor: 'Cursor',
  dashscope: 'DashScope',
  deepseek: 'DeepSeek',
  'deepseek-official': 'DeepSeek',
  openai: 'OpenAI',
  'openai-codex': 'OpenAI Codex',
  xai: 'xAI',
  zai: 'Z.AI',
})

/**
 * Split a persisted `provider/model` selector on the first slash.
 * @param selector - exact persisted route selector.
 * @returns parsed provider and model route.
 */
export function parseLaneSelector(selector: string): ReliabilityLaneRoute {
  const slash = selector.indexOf('/')
  if (slash <= 0 || slash === selector.length - 1) {
    throw new Error(`reliability policy selector '${selector}' must be provider/model`)
  }
  return { provider: selector.slice(0, slash), model: selector.slice(slash + 1) }
}

function providerLabel(provider: string): string {
  const known = PROVIDER_LABELS[provider]
  if (known !== undefined) return known
  return provider
    .split(/[-_]+/u)
    .filter(part => part.length > 0)
    .map(part => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

function emptyRow(sessionId: SessionId, now: number): ReliabilityPolicyRow {
  return {
    sessionId,
    revision: 0,
    enabled: false,
    implementationModel: null,
    implementationThinking: null,
    reviewModel: null,
    reviewThinking: null,
    updatedAt: now,
  }
}

/** Select the requested lane default from one exact-model capability record. */
function preferredEffort(
  model: ReliabilityModelOption | undefined,
  preferred: string,
): string | null {
  if (model === undefined || model.reasoningEfforts.length === 0) return null
  const requested = model.reasoningEfforts.find(effort => effort.id === preferred)
  if (requested !== undefined) return requested.id
  const adapterDefault = model.reasoningEfforts.find(effort => effort.isDefault)
  return adapterDefault?.id ?? model.reasoningEfforts[0]?.id ?? null
}

/** Validate one saved lane against the current exact-model directory. */
function laneValidation(
  label: 'implementation' | 'review',
  selector: string | null,
  effort: string | null,
  models: readonly ReliabilityModelOption[],
): string | undefined {
  if (selector === null) return `select an ${label} model before enabling the workflow`
  const model = models.find(option => option.selector === selector)
  if (model === undefined) return `${label} model '${selector}' is not in the current catalog`
  if (model.reasoningEfforts.length === 0) {
    if (effort !== null) return `${label} model '${selector}' does not expose reasoning efforts`
    return undefined
  }
  if (effort === null) return `select an ${label} reasoning effort before enabling the workflow`
  if (!model.reasoningEfforts.some(option => option.id === effort)) {
    return `${label} model '${selector}' does not support reasoning effort '${effort}'`
  }
  return undefined
}

/** Validate both lanes of an enabled policy candidate. */
function enabledValidation(
  row: Pick<ReliabilityPolicyRow, 'implementationModel' | 'implementationThinking' | 'reviewModel' | 'reviewThinking'>,
  models: readonly ReliabilityModelOption[],
): string | undefined {
  return laneValidation('implementation', row.implementationModel, row.implementationThinking, models)
    ?? laneValidation('review', row.reviewModel, row.reviewThinking, models)
}

/** Report saved directory drift without changing the durable row. */
function savedValidation(
  row: ReliabilityPolicyRow,
  models: readonly ReliabilityModelOption[],
): string | undefined {
  if (!row.enabled && row.implementationModel === null && row.reviewModel === null) return undefined
  return enabledValidation(row, models)
}

/**
 * Session-keyed reliability policy (`ctx.reliabilityPolicy`). Catalog reads
 * go through `ctx.llm`; the durable row never stores the directory.
 */
export class ReliabilityPolicyService extends TypertRemoteService {
  static inject = ['storageDomain', 'llm']

  private table: KvTable<SessionId, ReliabilityPolicyRow> | undefined
  private readonly tails = new Map<SessionId, Promise<void>>()

  /**
   * @param ctx - Host context carrying storage and the LLM catalog.
   */
  constructor(ctx: Context) {
    super(ctx, 'reliabilityPolicy')
  }

  /** Open the durable domain and close it after in-flight writes drain. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(reliabilityPolicyDomainSpec)
    this.table = domain.table('sessions')
    this.ctx.effect(() => this.domainLifecycle(domain), 'reliability-policy.domain')
  }

  /** Yield the domain close first, then in-flight writes; unwind reverses that. */
  private *domainLifecycle(domain: Domain<typeof reliabilityPolicyDomainSpec>): Generator<() => Promise<void>> {
    yield () => domain.close()
    yield () => Promise.all([...this.tails.values()]).then(() => undefined)
  }

  /**
   * Whether the reliability handoff tool is enabled for this Session.
   * @param sessionId - exact Session identity.
   * @returns the persisted enablement flag, false when no row exists.
   */
  workflowEnabled(sessionId: SessionId): boolean {
    return this.table?.get(sessionId)?.enabled === true
  }

  /**
   * Parsed implementation and review routes when the policy is enabled.
   * @param sessionId - exact Session identity.
   * @returns both lanes, or `undefined` when the policy is off or incomplete.
   */
  async enabledRoutes(sessionId: SessionId): Promise<{
    readonly implementation: ReliabilityLaneRoute
    readonly review: ReliabilityLaneRoute
  } | undefined> {
    const row = this.table?.get(sessionId)
    if (row === undefined || !row.enabled) return undefined
    const models = await this.enabledDirectory(row)
    const error = enabledValidation(row, models)
    if (error !== undefined) throw new Error(`reliability policy is invalid: ${error}`)
    /* v8 ignore next -- enabledValidation guarantees both selectors. */
    const implementation = parseLaneSelector(row.implementationModel ?? '')
    /* v8 ignore next -- enabledValidation guarantees both selectors. */
    const review = parseLaneSelector(row.reviewModel ?? '')
    return {
      implementation: {
        ...implementation,
        ...row.implementationThinking === null ? {} : { reasoningEffort: ReasoningEffortId(row.implementationThinking) },
      },
      review: {
        ...review,
        ...row.reviewThinking === null ? {} : { reasoningEffort: ReasoningEffortId(row.reviewThinking) },
      },
    }
  }

  /**
   * Read the Session policy and the current LLM catalog.
   * @param request - Session identity.
   * @returns the snapshot the composer switch renders.
   */
  @Remote('policy')
  policy(request: ReliabilityPolicyRequest): Promise<ReliabilityPolicySnapshot> {
    return this.snapshot(request.sessionId, false)
  }

  /**
   * Ensure a durable row exists, then return it with the current catalog.
   * @param request - Session identity.
   * @returns the snapshot, creating a disabled row when none exists.
   */
  @Remote('ensurePolicy')
  ensurePolicy(request: ReliabilityPolicyRequest): Promise<ReliabilityPolicySnapshot> {
    return this.snapshot(request.sessionId, true)
  }

  /**
   * Replace the Session policy. Enabling requires both lanes to name catalog
   * models; a missing route cannot stay enabled.
   * @param request - complete replacement.
   * @returns the committed snapshot.
   */
  @Remote('configure')
  configure(request: ReliabilityPolicyConfigureRequest): Promise<ReliabilityPolicySnapshot> {
    return this.queue(request.sessionId, async () => {
      const models = await this.modelDirectory()
      if (request.enabled) {
        const error = enabledValidation(request, models)
        if (error !== undefined) throw new Error(error)
      }
      const current = this.requireTable().get(request.sessionId) ?? emptyRow(request.sessionId, Date.now())
      const next: ReliabilityPolicyRow = {
        sessionId: request.sessionId,
        revision: current.revision + 1,
        enabled: request.enabled,
        implementationModel: request.implementationModel,
        implementationThinking: request.implementationThinking,
        reviewModel: request.reviewModel,
        reviewThinking: request.reviewThinking,
        updatedAt: Date.now(),
      }
      await this.requireTable().put(request.sessionId, next)
      return this.project(next, models)
    })
  }

  /** Read or create the row, then attach the live catalog. */
  private async snapshot(sessionId: SessionId, ensure: boolean): Promise<ReliabilityPolicySnapshot> {
    return this.queue(sessionId, async () => {
      const models = await this.modelDirectory()
      const table = this.requireTable()
      let stored = table.get(sessionId)
      if (ensure && (stored === undefined
        || stored.implementationModel === null || stored.reviewModel === null)) {
        const baseline = stored ?? emptyRow(sessionId, Date.now())
        const filled = this.withDefaults(baseline, models)
        if (filled.implementationModel !== baseline.implementationModel
          || filled.reviewModel !== baseline.reviewModel
          || filled.implementationThinking !== baseline.implementationThinking
          || filled.reviewThinking !== baseline.reviewThinking) {
          stored = { ...filled, revision: baseline.revision + 1, updatedAt: Date.now() }
          await table.put(sessionId, stored)
        } else {
          stored = baseline
        }
      }
      const row = stored ?? emptyRow(sessionId, 0)
      return this.project(row, models)
    })
  }

  /** Fill empty selectors from the first catalog entry so the panel has a starting pick. */
  private withDefaults(row: ReliabilityPolicyRow, models: readonly ReliabilityModelOption[]): ReliabilityPolicyRow {
    const first = models[0]
    if (first === undefined) return row
    const implementationModel = row.implementationModel ?? first.selector
    const reviewModel = row.reviewModel ?? first.selector
    const implementationOption = models.find(model => model.selector === implementationModel)
    const reviewOption = models.find(model => model.selector === reviewModel)
    return {
      ...row,
      implementationModel,
      implementationThinking: row.implementationThinking
        ?? preferredEffort(implementationOption, 'high'),
      reviewModel,
      reviewThinking: row.reviewThinking
        ?? preferredEffort(reviewOption, 'xhigh'),
    }
  }

  /** Rebuild the picker directory from every registered LLM provider. */
  private async modelDirectory(): Promise<readonly ReliabilityModelOption[]> {
    const providers = this.ctx.llm.listProviders()
    const groups = await Promise.all(providers.map(async (provider) => {
      let models: Awaited<ReturnType<typeof this.ctx.llm.listModels>>
      try {
        models = await this.ctx.llm.listModels(provider.id)
      } catch {
        return []
      }
      const options = await Promise.all(models.map(async (model) => {
        let resolved: Awaited<ReturnType<typeof this.ctx.llm.resolveModelInfo>>
        try {
          resolved = await this.ctx.llm.resolveModelInfo(provider.id, model.id)
        } catch {
          return undefined
        }
        return this.modelOption(provider.id, model.id, resolved)
      }))
      return options.filter(option => option !== undefined)
    }))
    return groups.flat()
  }

  /** Resolve only the two selected routes before a model-facing handoff. */
  private async enabledDirectory(row: ReliabilityPolicyRow): Promise<readonly ReliabilityModelOption[]> {
    const selectors = [...new Set([row.implementationModel, row.reviewModel]
      .filter((selector): selector is string => selector !== null))]
    const listings = new Map<string, Promise<Awaited<ReturnType<typeof this.ctx.llm.listModels>>>>()
    const options = await Promise.all(selectors.map(async (selector) => {
      let route: ReliabilityLaneRoute
      try {
        route = parseLaneSelector(selector)
      } catch {
        return undefined
      }
      let listing = listings.get(route.provider)
      if (listing === undefined) {
        listing = this.ctx.llm.listModels(route.provider)
        listings.set(route.provider, listing)
      }
      try {
        if (!(await listing).some(model => model.id === route.model)) return undefined
        const resolved = await this.ctx.llm.resolveModelInfo(route.provider, route.model)
        return this.modelOption(route.provider, route.model, resolved)
      } catch {
        return undefined
      }
    }))
    return options.filter(option => option !== undefined)
  }

  /** Project one exact adapter capability record into a picker option. */
  private modelOption(
    provider: string,
    model: string,
    resolved: Awaited<ReturnType<typeof this.ctx.llm.resolveModelInfo>>,
  ): ReliabilityModelOption {
    const channel = provider === 'cursor' ? 'Cursor' : 'DuraSH'
    return {
      selector: `${provider}/${model}`,
      label: resolved.name,
      provider,
      model,
      badges: [
        { kind: 'channel', label: channel },
        { kind: 'provider', label: providerLabel(provider) },
      ],
      reasoningEfforts: (resolved.reasoning?.efforts ?? []).map(effort => ({
        id: String(effort.id),
        name: effort.name,
        ...effort.description === undefined ? {} : { description: effort.description },
        isDefault: effort.id === resolved.reasoning?.defaultEffort,
      })),
    }
  }

  private project(row: ReliabilityPolicyRow, models: readonly ReliabilityModelOption[]): ReliabilityPolicySnapshot {
    return {
      sessionId: row.sessionId,
      revision: row.revision,
      enabled: row.enabled,
      implementationModel: row.implementationModel,
      implementationThinking: row.implementationThinking,
      reviewModel: row.reviewModel,
      reviewThinking: row.reviewThinking,
      updatedAt: row.updatedAt,
      models,
      validationError: savedValidation(row, models) ?? null,
    }
  }

  private queue<T>(sessionId: SessionId, work: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(sessionId) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(work)
    const tail = current.then(() => undefined, () => undefined)
    this.tails.set(sessionId, tail)
    void tail.finally(() => {
      if (this.tails.get(sessionId) === tail) this.tails.delete(sessionId)
    })
    return current
  }

  private requireTable(): KvTable<SessionId, ReliabilityPolicyRow> {
    if (this.table === undefined) throw new Error('reliability policy is not started yet')
    return this.table
  }
}

export default ReliabilityPolicyService
