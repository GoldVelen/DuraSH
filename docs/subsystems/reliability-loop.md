# Reliability Loop

English | [中文](reliability-loop.zh.md)

[`@durash/dsh-reliability-loop`](../../packages/reliability/durash-reliability-loop) is DuraSH's Host-owned bounded delivery engine. It persists one implementation lane, one independent review lane, and at most one rework in the `reliability_loop` storage domain. It composes only into the `durash` profile and uses the generic [workflow subsystem](workflow.md) for every stage.

Source: [`packages/reliability/durash-reliability-loop/src/types.ts`](../../packages/reliability/durash-reliability-loop/src/types.ts)

## Fast handoff

`startDetached()` authenticates the exact live root Agent, persists a version-2 record at stage `accepted`, claims the one live driver, publishes the current Session view, and returns `{ loopId, revision, status: 'accepted' }` before any implementation, review, or rework stage settles. The initiating model turn, tool signal, code-runtime limit, and browser connection do not own the loop after acceptance. A second start for the same Session returns the existing active ref instead of starting another writer.

The model-facing [`dsh_reliability_handoff`](../../packages/reliability/durash-tool-reliability/README.md) accepts only the current direct-human root turn. It reads complete implementation and review lanes from the Session policy and returns the fast receipt; it never awaits terminal state or maps its abort signal into loop cancellation.

## Durable state and stages

One row is the sole execution truth. It contains the owning Session, positive revision, complete objective, immutable provider/model/reasoning-effort lanes, both rounds of bounded reports, current stage, lifecycle times, and optional terminal error or dismissal. The domain schema version is 2. Pre-release version 1 media is rejected rather than guessed or rewritten.

Stages are `accepted`, `implementing`, `reviewing`, `rework-implementing`, `rework-reviewing`, `completed`, `blocked`, `failed`, and `cancelled`. A first `changes-requested` review enters one rework; a second enters `blocked`. A stage child starts fresh with only the bounded objective or report handoff. `maxHandoffChars` defaults to 16384 and rejects oversized input instead of truncating it.

## Ownership, suspension, and cancellation

One `LoopDriver` is the single live writer for one loop. The runtime attaches its result observer before driving, so provider, child, workflow-worker, report, and storage failures are contained and cannot become unhandled Host-level rejections. Loop-internal failures become a durable `failed` record whenever the record can still be maintained.

Host or owning-Agent teardown calls `suspend`: it cancels and disposes the current workflow run, waits for resources to stop, and leaves the non-terminal durable stage unchanged. Agent adoption after restart claims that stage and re-runs only the first unsettled stage; already committed reports are retained. `cancelled` is reserved for an explicit authenticated user action. `cancel` checks Session ownership and exact revision, waits for worker and child quiescence, and publishes one terminal result.

## Session status and controls

`reliability-loop/change` is a required-on-read, log-only Session event derived after a domain commit. It carries the complete current status plus an optional once-per-loop terminal notice. The `reliabilityLoop` Session projection rejects same-loop revision rollback. It is display state, not a second execution source: recovery and stage transitions never read it. If domain commit succeeds but event append does not, Agent adoption republishes the latest view.

The client registers a compact `conversation.input.dock` status bar at order `-10`. It reads only the active Session projection, covers all nine stages, loads full details on demand, confirms cancellation, and dismisses only the exact visible terminal revision. A terminal `reliability-loop/change` creates one stable loop-id Conversation Node; active telemetry never enters the main chat and terminal rendering does not call a model.

The `details`, `cancel`, and `dismiss` Typert Remotes require the exact live Agent and matching Session ownership. Mutating `cancel` and `dismiss` also require the current loop revision, so unknown, cross-Session, and stale write refs fail closed. Read-only `details` returns the latest owned record, which keeps a terminal Conversation node useful after dismissal. Dismissal hides the latest visible terminal without deleting the domain record or resurfacing an older result.

## Model routes and context resilience

[`@durash/dsh-reliability-policy`](../../packages/reliability/durash-reliability-policy/README.md) rebuilds the exact-model directory from live adapter metadata. It preserves stale saved selections with a concrete validation error and refuses to start them; it never silently changes a model or effort. Valid routes snapshot provider, model, and optional reasoning effort into the loop, and the generic workflow worker forwards those fields to each stage child.

In-process stage children join the parent's exact preset generation. Under the shipped standard preset they therefore inherit the token meter, replay-safe tool-result pruner, and compaction engine. Existing compaction regressions cover oversized tool-result pruning, provider-confirmed context overflow followed by compaction and retry, and loud failure when retained input is indivisible. This subsystem does not restore the old 3081 workflow-specific executor or widen the code runtime's wall-clock limit.

## Boundaries

- The current product loop has one implementer, one reviewer, and one rework. Planning coordination, multi-path adversarial review, aggregation, and automatic cost scheduling are not implemented.
- The generic workflow engine does not journal script-internal progress. A crash inside a stage re-runs that unsettled stage after adoption; member-level durable progress is not claimed.
- Terminal summaries are deterministic and bounded. Full objective and round reports require the authenticated details Remote; raw provider and child evidence remains in the owning workflow and child Sessions.

The ownership and projection decision is recorded in the [Host-owned reliability-loop Agent Note](../../.agents/notes/implemented/feature/2026-08-31-host-owned-reliability-loop.md).

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxreliabilityloopruntime--reliabilityloopruntime"></a>

### `ctx.reliabilityLoopRuntime` — `ReliabilityLoopRuntime`

Detached, Host-owned reliability-loop runtime and Remote provider.

```ts cordis-catalog
/**
 * Persist and claim one background loop, then return before any stage settles.
 * A duplicate active start returns that loop's current ref and never creates
 * a second writer.
 * @param request - root Session, objective, and exact lane snapshots.
 * @returns durable acceptance acknowledgement.
 */
startDetached(request: ReliabilityLoopStartRequest): Promise<ReliabilityLoopStartAck>

/**
 * Every durable record in storage order.
 * @returns record snapshots.
 */
list(): ReliabilityLoopRecord[]

/**
 * Read one durable record without granting cross-Session Remote access.
 * @param loopId - exact loop identity.
 * @returns the record or undefined.
 */
get(loopId: ReliabilityLoopId): ReliabilityLoopRecord | undefined

/**
 * Return the current full record for one loop in the caller's Session.
 * Read access is Session-authenticated but not revision-gated so a terminal
 * Conversation node remains useful after its status dock is dismissed.
 * @param agent - exact live Agent resolved by Typert.
 * @param ref - loop identity plus the caller's observed revision.
 * @returns bounded objective and every settled report.
 */
@Remote('details') details(agent: Agent, ref: ReliabilityLoopRef): ReliabilityLoopDetails

/**
 * Explicitly cancel one active loop and wait for stage resources to stop.
 * @param agent - exact live Agent resolved by Typert.
 * @param ref - expected current revision.
 * @returns terminal status after quiescence.
 */
@Remote('cancel') cancel(agent: Agent, ref: ReliabilityLoopRef): Promise<ReliabilityLoopStatusView>

/**
 * Hide the currently visible terminal dock without deleting durable history.
 * @param agent - exact live Agent resolved by Typert.
 * @param ref - expected current terminal revision.
 * @returns the new tombstone revision.
 */
@Remote('dismiss') dismiss(agent: Agent, ref: ReliabilityLoopRef): Promise<ReliabilityLoopRef>
```

Types: [Agent](core.md)

Source: [`packages/reliability/durash-reliability-loop/src/index.ts`](../../packages/reliability/durash-reliability-loop/src/index.ts)

<a id="ctxreliabilitypolicy--reliabilitypolicyservice"></a>

### `ctx.reliabilityPolicy` — `ReliabilityPolicyService`

Session-keyed reliability policy (`ctx.reliabilityPolicy`). Catalog reads go through `ctx.llm`; the durable row never stores the directory.

```ts cordis-catalog
/**
 * Whether the reliability handoff tool is enabled for this Session.
 * @param sessionId - exact Session identity.
 * @returns the persisted enablement flag, false when no row exists.
 */
workflowEnabled(sessionId: SessionId): boolean

/**
 * Parsed implementation and review routes when the policy is enabled.
 * @param sessionId - exact Session identity.
 * @returns both lanes, or `undefined` when the policy is off or incomplete.
 */
async enabledRoutes(sessionId: SessionId): Promise<{ readonly implementation: ReliabilityLaneRoute readonly review: ReliabilityLaneRoute } | undefined>

/**
 * Read the Session policy and the current LLM catalog.
 * @param request - Session identity.
 * @returns the snapshot the composer switch renders.
 */
@Remote('policy') policy(request: ReliabilityPolicyRequest): Promise<ReliabilityPolicySnapshot>

/**
 * Ensure a durable row exists, then return it with the current catalog.
 * @param request - Session identity.
 * @returns the snapshot, creating a disabled row when none exists.
 */
@Remote('ensurePolicy') ensurePolicy(request: ReliabilityPolicyRequest): Promise<ReliabilityPolicySnapshot>

/**
 * Replace the Session policy. Enabling requires both lanes to name catalog
 * models; a missing route cannot stay enabled.
 * @param request - complete replacement.
 * @returns the committed snapshot.
 */
@Remote('configure') configure(request: ReliabilityPolicyConfigureRequest): Promise<ReliabilityPolicySnapshot>
```

Types: [SessionId](core.md)

Source: [`packages/reliability/durash-reliability-policy/src/index.ts`](../../packages/reliability/durash-reliability-policy/src/index.ts)
<!-- END GENERATED cordis-surface -->
