/**
 * Per-session reliability-loop policy (`ctx.reliabilityPolicy`): the composer
 * switch's Host truth. One durable row per Session holds enablement and the
 * implementation/review selectors; the live LLM catalog is rebuilt on every
 * read so a missing route cannot stay enabled.
 * @module @durash/dsh-reliability-policy
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { reliabilityPolicyDomainSpec } from './spec.ts'
import type { ReliabilityPolicyRow } from './spec.ts'
import type {
  AcceptanceView,
  ReliabilityLaneRoute,
  ReliabilityModelOption,
  ReliabilityPolicyConfigureRequest,
  ReliabilityPolicyRequest,
  ReliabilityPolicySnapshot,
  ReliabilityThinking,
} from './types.ts'

export type * from './types.ts'
export { reliabilityPolicyDomainSpec, reliabilityPolicyRow } from './spec.ts'
export type { ReliabilityPolicyRow } from './spec.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    reliabilityPolicy: ReliabilityPolicyService
  }
}

/** Effort levels the switch offers until the workflow engine applies `effort`. */
export const RELIABILITY_THINKING_LEVELS: readonly ReliabilityThinking[] = Object.freeze([
  'off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max',
])

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
 * @param selector - selector with non-empty provider and model components.
 * @returns the provider route and remaining model id.
 * @throws {Error} when either component is empty or the slash is absent.
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
  enabledRoutes(sessionId: SessionId): {
    readonly implementation: ReliabilityLaneRoute
    readonly review: ReliabilityLaneRoute
  } | undefined {
    const row = this.table?.get(sessionId)
    if (row === undefined || !row.enabled
      || row.implementationModel === null || row.reviewModel === null) {
      return undefined
    }
    return {
      implementation: laneRoute(row.implementationModel, row.implementationThinking),
      review: laneRoute(row.reviewModel, row.reviewThinking),
    }
  }

  /**
   * Configured planning, frontend, backend, and testing routes.
   * @param sessionId - exact Session identity.
   * @returns the roles that have a selector, or undefined when none are set.
   */
  roleRoutes(sessionId: SessionId): {
    readonly planning?: ReliabilityLaneRoute
    readonly frontend?: ReliabilityLaneRoute
    readonly backend?: ReliabilityLaneRoute
    readonly testing?: ReliabilityLaneRoute
  } | undefined {
    const row = this.table?.get(sessionId)
    if (row === undefined) return undefined
    const roles = {
      ...optionalLane('planning', row.planningModel, row.planningThinking),
      ...optionalLane('frontend', row.frontendModel, row.frontendThinking),
      ...optionalLane('backend', row.backendModel, row.backendThinking),
      ...optionalLane('testing', row.testingModel, row.testingThinking),
    }
    return Object.keys(roles).length === 0 ? undefined : roles
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
   * Read current task acceptance without starting a workflow or model call.
   * @param request - Session whose recorded checks to inspect.
   * @returns the evaluated task, or null when the runtime or task is absent.
   */
  @Remote('acceptance')
  acceptance(request: ReliabilityPolicyRequest): Promise<AcceptanceView | null> {
    const runtime = this.ctx.get('reliabilityLoopRuntime') as {
      acceptanceView(sessionId: SessionId): Promise<AcceptanceView | null>
    } | undefined
    return runtime === undefined ? Promise.resolve(null) : runtime.acceptanceView(request.sessionId)
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
      const known = new Set(models.map(model => model.selector))
      if (request.enabled) {
        if (request.implementationModel === null || request.implementationThinking === null
          || request.reviewModel === null || request.reviewThinking === null) {
          throw new Error('select both implementation and review models before enabling the workflow')
        }
        if (!known.has(request.implementationModel)) {
          throw new Error(`implementation model '${request.implementationModel}' is not in the current catalog`)
        }
        if (!known.has(request.reviewModel)) {
          throw new Error(`review model '${request.reviewModel}' is not in the current catalog`)
        }
        assertThinking(models, request.implementationModel, request.implementationThinking, 'implementation')
        assertThinking(models, request.reviewModel, request.reviewThinking, 'review')
      }
      const current = this.requireTable().get(request.sessionId) ?? emptyRow(request.sessionId, Date.now())
      const roles = roleFields(request, current, models)
      const next: ReliabilityPolicyRow = {
        sessionId: request.sessionId,
        revision: current.revision + 1,
        enabled: request.enabled,
        implementationModel: request.implementationModel,
        implementationThinking: request.implementationThinking,
        reviewModel: request.reviewModel,
        reviewThinking: request.reviewThinking,
        ...roles,
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
      if (row.enabled && (row.implementationModel === null || row.reviewModel === null
        || !models.some(model => model.selector === row.implementationModel)
        || !models.some(model => model.selector === row.reviewModel))) {
        const disabled: ReliabilityPolicyRow = { ...row, enabled: false, revision: row.revision + 1, updatedAt: Date.now() }
        await table.put(sessionId, disabled)
        return this.project(disabled, models)
      }
      return this.project(row, models)
    })
  }

  /** Fill empty selectors from the first catalog entry so the panel has a starting pick. */
  private withDefaults(row: ReliabilityPolicyRow, models: readonly ReliabilityModelOption[]): ReliabilityPolicyRow {
    const first = models[0]
    if (first === undefined) return row
    const implementationModel = row.implementationModel ?? first.selector
    const reviewModel = row.reviewModel ?? first.selector
    return {
      ...row,
      implementationModel,
      implementationThinking: row.implementationThinking ?? advertisedEffort(models, implementationModel, 'high'),
      reviewModel,
      reviewThinking: row.reviewThinking ?? advertisedEffort(models, reviewModel, 'xhigh'),
    }
  }

  /** Rebuild the picker directory from every registered LLM provider. */
  private async modelDirectory(): Promise<readonly ReliabilityModelOption[]> {
    const providers = this.ctx.llm.listProviders()
    const options: ReliabilityModelOption[] = []
    for (const provider of providers) {
      let models: Awaited<ReturnType<typeof this.ctx.llm.listModels>>
      try {
        models = await this.ctx.llm.listModels(provider.id)
      } catch {
        continue
      }
      for (const model of models) {
        const channel = provider.id === 'cursor' ? 'Cursor' : 'DuraSH'
        options.push({
          selector: `${provider.id}/${model.id}`,
          label: model.name,
          provider: provider.id,
          model: model.id,
          badges: [
            { kind: 'channel', label: channel },
            { kind: 'provider', label: providerLabel(provider.id) },
          ],
          thinkingLevels: await thinkingFor(this.ctx, provider.id, model.id),
        })
      }
    }
    return options
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
      planningModel: row.planningModel ?? null,
      planningThinking: row.planningThinking ?? null,
      frontendModel: row.frontendModel ?? null,
      frontendThinking: row.frontendThinking ?? null,
      backendModel: row.backendModel ?? null,
      backendThinking: row.backendThinking ?? null,
      testingModel: row.testingModel ?? null,
      testingThinking: row.testingThinking ?? null,
      updatedAt: row.updatedAt,
      models,
    }
  }

  private queue<T>(sessionId: SessionId, work: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(sessionId) ?? Promise.resolve()
    const current = previous.then(work)
    this.tails.set(sessionId, current.then(() => undefined, () => undefined))
    return current
  }

  private requireTable(): KvTable<SessionId, ReliabilityPolicyRow> {
    if (this.table === undefined) throw new Error('reliability policy is not started yet')
    return this.table
  }
}

const ROLE_KEYS = ['planning', 'frontend', 'backend', 'testing'] as const

function laneRoute(selector: string, thinking: string | null): ReliabilityLaneRoute {
  const route = parseLaneSelector(selector)
  return thinking === null ? route : { ...route, thinking }
}

function optionalLane(
  key: typeof ROLE_KEYS[number],
  selector: string | null | undefined,
  thinking: string | null | undefined,
): Partial<Record<typeof ROLE_KEYS[number], ReliabilityLaneRoute>> {
  if (selector === undefined || selector === null) return {}
  return { [key]: laneRoute(selector, thinking ?? null) }
}

function advertisedEffort(
  models: readonly ReliabilityModelOption[],
  selector: string,
  preferred: string,
): string | null {
  const levels = models.find(model => model.selector === selector)?.thinkingLevels ?? []
  if (levels.length === 0) return null
  return levels.includes(preferred) ? preferred : null
}

function assertThinking(
  models: readonly ReliabilityModelOption[],
  selector: string,
  thinking: string | null,
  lane: string,
): void {
  const levels = models.find(model => model.selector === selector)?.thinkingLevels ?? []
  if (levels.length === 0 || thinking === null) return
  if (!levels.includes(thinking)) {
    throw new Error(`${lane} thinking '${thinking}' is not listed for '${selector}'`)
  }
}

function roleFields(
  request: ReliabilityPolicyConfigureRequest,
  current: ReliabilityPolicyRow,
  models: readonly ReliabilityModelOption[],
): Pick<ReliabilityPolicyRow, 'planningModel' | 'planningThinking' | 'frontendModel' | 'frontendThinking' | 'backendModel' | 'backendThinking' | 'testingModel' | 'testingThinking'> {
  const known = new Set(models.map(model => model.selector))
  const pick = (key: typeof ROLE_KEYS[number]): { model: string | null; thinking: string | null } => {
    const modelKey = `${key}Model` as const
    const thinkingKey = `${key}Thinking` as const
    const requestedModel = request[modelKey]
    const model = requestedModel === undefined ? (current[modelKey] ?? null) : requestedModel
    const requestedThinking = request[thinkingKey]
    const thinking = requestedThinking === undefined ? (current[thinkingKey] ?? null) : requestedThinking
    if (model !== null && !known.has(model)) throw new Error(`${key} model '${model}' is not in the current catalog`)
    if (model !== null) assertThinking(models, model, thinking, key)
    return { model, thinking: model === null ? null : thinking }
  }
  const planning = pick('planning')
  const frontend = pick('frontend')
  const backend = pick('backend')
  const testing = pick('testing')
  return {
    planningModel: planning.model,
    planningThinking: planning.thinking,
    frontendModel: frontend.model,
    frontendThinking: frontend.thinking,
    backendModel: backend.model,
    backendThinking: backend.thinking,
    testingModel: testing.model,
    testingThinking: testing.thinking,
  }
}

async function thinkingFor(ctx: Context, provider: string, model: string): Promise<readonly ReliabilityThinking[]> {
  try {
    const info = await ctx.llm.resolveModelInfo(provider, model)
    return info.reasoning?.efforts.map(effort => effort.id) ?? []
  } catch (error) {
    // A model with no capability record stays selectable and keeps thinking unknown.
    void error
    return []
  }
}

export default ReliabilityPolicyService
