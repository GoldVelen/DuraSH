# Reliability Loop

English | [中文](reliability-loop.zh.md)

[`@durash/dsh-reliability-loop`](../../packages/reliability/durash-reliability-loop) owns DuraSH's first reliability-engine slice: one bounded implement-review-rework cycle driven over the workflow seam, with the loop's whole state machine held as one durable record in the `reliability_loop` storage domain. It composes only into the `durash` profile, registers no tools or prompt sections, and contributes no model context of its own.

Source: [`packages/reliability/durash-reliability-loop/src/types.ts`](../../packages/reliability/durash-reliability-loop/src/types.ts)

## Public types

```ts type-equiv
/** Identifies one reliability loop across restarts (runtime-minted UUID). */
type ReliabilityLoopId = Branded<'ReliabilityLoopId'>
```

```ts type-equiv
/** One attempt's round: `1` is the original pass, `2` the single bounded rework. */
type LoopRound = 1 | 2
```

```ts type-equiv
/** Why a reviewer's report accepted or rejected an implementation. */
type ReviewVerdict = 'approved' | 'changes-requested'
```

```ts type-equiv
/**
 * Durable loop stage. CLOSED union (runtime-owned, callers may exhaust). The
 * four `-ing` stages each name one workflow run the loop is — or was, before
 * a restart — executing; the four terminal stages are final. `blocked` stops
 * the loop after the bounded rework still drew `changes-requested`; the
 * settled round-2 review attempt carries the durable blocker.
 */
type ReliabilityLoopStage =
  | 'implementing'
  | 'reviewing'
  | 'rework-implementing'
  | 'rework-reviewing'
  | 'completed'
  | 'blocked'
  | 'failed'
  | 'cancelled'
```

```ts type-equiv
/** One settled implementation attempt. */
interface ImplementAttempt {
  /** Which pass produced it. */
  readonly round: LoopRound
  /** The implementer's bounded work summary. */
  readonly summary: string
  /** How many `agent()` calls the stage run accepted. */
  readonly agentsStarted: number
}
```

```ts type-equiv
/** One settled review attempt. */
interface ReviewAttempt {
  /** Which pass produced it. */
  readonly round: LoopRound
  /** The reviewer's decision. */
  readonly verdict: ReviewVerdict
  /** The reviewer's evidence; a `changes-requested` verdict names the required modifications. */
  readonly feedback: string
  /** How many `agent()` calls the stage run accepted. */
  readonly agentsStarted: number
}
```

```ts type-equiv
/**
 * The durable record of one loop — the single authoritative state. Optional
 * slots name `| undefined` explicitly because the zod durable-boundary schema
 * produces that shape and the repo compiles with `exactOptionalPropertyTypes`.
 * Stage semantics (which attempt slots must be settled for which stage) are
 * owned by the runtime and asserted by the `./invariant` companion.
 */
interface ReliabilityLoopRecord {
  /** The loop's id. */
  readonly loopId: ReliabilityLoopId
  /** What the implementation must achieve, verbatim from the caller. */
  readonly objective: string
  /** Creation instant, ISO-8601. */
  readonly createdAt: string
  /** Current stage. */
  readonly stage: ReliabilityLoopStage
  /** The settled implementation attempt, when one has completed. */
  readonly implement?: ImplementAttempt | undefined
  /** The settled review attempt, when one has completed. */
  readonly review?: ReviewAttempt | undefined
  /** Settlement instant, ISO-8601; present iff `stage` is terminal. */
  readonly settledAt?: string | undefined
  /** Failure detail; present iff `stage` is `failed`. */
  readonly error?: string | undefined
}
```

```ts type-equiv
/** What a caller asks for when starting one loop. */
interface ReliabilityLoopStartRequest {
  /** The agent on whose behalf the loop runs (parent of every stage child). */
  parent: Agent
  /** What the implementation must achieve; bounded by `maxHandoffChars`. */
  objective: string
}
```

```ts type-equiv
/**
 * A caller-owned live loop. `result` settles once the loop has durably
 * reached a terminal stage AND the last stage run's resources are released;
 * after that point the loop writes nothing and owns nothing.
 */
interface ReliabilityLoopHandle {
  /** The loop's id. */
  readonly loopId: ReliabilityLoopId
  /**
   * Settles with the terminal durable record. Never rejects for loop-internal
   * failures (those land in the record as `failed`); it rejects only when the
   * durable record itself cannot be maintained (a storage fault), because no
   * terminal record can be delivered then.
   */
  readonly result: Promise<ReliabilityLoopRecord>
  /**
   * Request cancellation: the in-flight stage run is cancelled and the loop
   * settles `cancelled`. Idempotent; the first reason wins. A stage that
   * already settled is kept.
   * @param reason - human-readable cause (default `'reliability loop cancelled'`).
   */
  cancel(reason?: string): void
  /**
   * Cancel if needed and await durable settlement plus resource quiescence.
   * Never rejects; idempotent; safe on every path.
   */
  dispose(): Promise<void>
}
```

## State and durability

One loop is one row of the `reliability_loop` domain's `loops` table, and the record is the single authoritative state: every stage transition is one durable record write, recovery reads nothing else, and no session-event copy or second store exists. The four `-ing` stages each name one workflow run the loop is — or was, before a restart — executing; `completed`, `blocked`, `failed`, and `cancelled` are final, and `settledAt` is present exactly on them. `blocked` stops the loop after the single bounded rework still drew `changes-requested`, with the settled round-2 review attempt carrying the durable blocker.

The stage machine owns which attempt slots must be settled for each stage, and the `./invariant` companion asserts that coherence at every read and write site and on the `domain/changed` stream. The transitions derive from the run handle the driver owns (`run.result`), not from the observe-only `workflow/*` events, so a stage has exactly one live fact source.

## Lifecycle and recovery

`start` writes the durable record before any run exists; a crash after that write is recoverable. `resume(loopId, parent)` drives the machine from the record's current stage: settled attempts are never re-run, and the first unsettled stage re-runs exactly once because one live driver owns one loop — a second `resume` or `start` on an owned loop fails loud. The caller supplies the parent agent; the runtime never fabricates attribution. `result` settles only after the terminal record is durable and the last stage run is disposed, so a settled loop owns nothing and writes nothing.

Bounded handoffs answer the historical review-overflow failure: `maxHandoffChars` (default 16384) bounds the objective, every implementation summary, and every reviewer feedback; an oversized artifact fails the stage loud, and each stage child starts fresh, receiving only the bounded handoff — never the parent conversation or prior stage transcripts.

## Boundaries and limitations

- The loop is a programmatic service; no model-facing tool or command exists yet.
- The record persists stage transitions only. The workflow engine journals nothing, so a crash mid-stage re-runs that stage once; member-level durable progress is not projected.
- One implementer and one reviewer only — no coordination stage, three-way review, or per-stage fan-out, and no `needs_replan` round vocabulary beyond the `blocked` stop.
- `result` rejects only on a durable-seam fault (storage failure or invariant breach); every loop-internal failure lands in the record as `failed`.
- A run that settles `cancelled` without a local cancel request is a contract violation and stops the loop `failed` rather than being mistaken for a caller cancellation.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxreliabilityloopruntime--reliabilityloopruntime"></a>

### `ctx.reliabilityLoopRuntime` — `ReliabilityLoopRuntime`

The reliability-loop runtime. One live driver owns one loop; the runtime enforces that single ownership and cancels every live loop to quiescence before its domain closes at teardown.

```ts cordis-catalog
/**
 * Start one loop: write its durable record first, then drive the first
 * stage. The caller owns the returned handle and defines its own interval
 * over `result`.
 * @param request - the parent agent and the bounded objective.
 * @returns the live loop handle.
 * @throws when the objective is empty or over the handoff bound.
 */
async start(request: ReliabilityLoopStartRequest): Promise<ReliabilityLoopHandle>

/**
 * Resume one interrupted loop after a restart: drive the state machine from
 * its record's current stage. Settled attempts are never re-run; the first
 * unsettled stage re-runs exactly once because the driver owns the loop
 * exclusively.
 * @param loopId - the interrupted loop's id.
 * @param parent - the agent on whose behalf the resumed stages run.
 * @returns the live loop handle.
 * @throws when the loop is unknown, already settled, or already owned by a
 *   live driver.
 */
resume(loopId: ReliabilityLoopId, parent: Agent): ReliabilityLoopHandle

/**
 * Every durable loop record, in storage order.
 * @returns the record snapshot.
 */
list(): ReliabilityLoopRecord[]

/**
 * Read one loop's durable record.
 * @param loopId - the loop's id.
 * @returns the record, or `undefined` when unknown.
 */
get(loopId: ReliabilityLoopId): ReliabilityLoopRecord | undefined
```

Types: [Agent](core.md)

Source: [`packages/reliability/durash-reliability-loop/src/index.ts`](../../packages/reliability/durash-reliability-loop/src/index.ts)
<!-- END GENERATED cordis-surface -->
