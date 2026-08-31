# 可靠性闭环

[English](reliability-loop.md) | 中文

[`@durash/dsh-reliability-loop`](../../packages/reliability/durash-reliability-loop) 承载 DuraSH 可靠性引擎的第一个切片：一个有界的实施-审查-返工闭环，跑在 workflow seam 之上，循环的整个状态机以一条持久记录的形式保存在 `reliability_loop` storage domain 中。它只组合进 `durash` profile，不注册任何工具或提示段落，自身不贡献任何模型上下文。

Source: [`packages/reliability/durash-reliability-loop/src/types.ts`](../../packages/reliability/durash-reliability-loop/src/types.ts)

## 公共类型

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
  /** Implementation-stage provider route, when the caller selected one. */
  readonly implementationProvider?: string | undefined
  /** Implementation-stage model id, when the caller selected one. */
  readonly implementationModel?: string | undefined
  /** Review-stage provider route, when the caller selected one. */
  readonly reviewProvider?: string | undefined
  /** Review-stage model id, when the caller selected one. */
  readonly reviewModel?: string | undefined
}
```

```ts type-equiv
/** What a caller asks for when starting one loop. */
interface ReliabilityLoopStartRequest {
  /** The agent on whose behalf the loop runs (parent of every stage child). */
  parent: Agent
  /** What the implementation must achieve; bounded by `maxHandoffChars`. */
  objective: string
  /** Implementation-stage child route; omitted children inherit the parent. */
  implementation?: ReliabilityLoopLane
  /** Review-stage child route; omitted children inherit the parent. */
  review?: ReliabilityLoopLane
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

## 会话策略类型

[`@durash/dsh-reliability-policy`](../../packages/reliability/durash-reliability-policy) 存储 composer 开关及实施／审查路由选择。思考强度属于持久策略数据；当前 worker-thread 引擎尚未把它应用到阶段子代理。

```ts type-equiv
/** Thinking effort stored on a lane; the worker-thread engine does not yet apply it to children. */
type ReliabilityThinking = string
```

```ts type-equiv
/** One catalog badge rendered next to a model option. */
interface ReliabilityModelBadge {
  readonly kind: 'channel' | 'provider'
  readonly label: string
}
```

```ts type-equiv
/** One selectable implementation or review model. */
interface ReliabilityModelOption {
  /** `provider/model` selector persisted on the policy row. */
  readonly selector: string
  /** Human-readable model name. */
  readonly label: string
  /** Provider route that owns the model. */
  readonly provider: string
  /** Model id passed to the stage child. */
  readonly model: string
  /** Channel and provider badges for the picker. */
  readonly badges: readonly ReliabilityModelBadge[]
  /** Effort levels the switch offers for this model. */
  readonly thinkingLevels: readonly ReliabilityThinking[]
}
```

```ts type-equiv
/** Parsed provider/model override for one loop lane. */
interface ReliabilityLaneRoute {
  readonly provider: string
  readonly model: string
}
```

```ts type-equiv
/** Session-bound policy the composer switch reads and writes. */
interface ReliabilityPolicySnapshot {
  readonly sessionId: SessionId
  readonly revision: number
  readonly enabled: boolean
  readonly implementationModel: string | null
  readonly implementationThinking: ReliabilityThinking | null
  readonly reviewModel: string | null
  readonly reviewThinking: ReliabilityThinking | null
  readonly updatedAt: number
  readonly models: readonly ReliabilityModelOption[]
}
```

```ts type-equiv
/** Session identity for a policy read. */
interface ReliabilityPolicyRequest {
  readonly sessionId: SessionId
}
```

```ts type-equiv
/** Session policy replacement from the composer switch. */
interface ReliabilityPolicyConfigureRequest {
  readonly sessionId: SessionId
  readonly enabled: boolean
  readonly implementationModel: string | null
  readonly implementationThinking: ReliabilityThinking | null
  readonly reviewModel: string | null
  readonly reviewThinking: ReliabilityThinking | null
}
```

## 状态与持久性

一个循环就是 `reliability_loop` domain `loops` 表中的一行，记录是唯一权威状态：每次阶段转换都是一次单记录持久写入，恢复不读取任何其他内容，也不存在会话事件副本或第二个 store。四个 `-ing` 阶段各自命名循环正在（或重启前曾经）执行的一个 workflow run；`completed`、`blocked`、`failed`、`cancelled` 是终态，`settledAt` 恰好只在终态出现。`blocked` 在单轮返工仍得到 `changes-requested` 后停止循环，由已结算的第二轮审查尝试承载持久 blocker。

阶段机规定每个阶段必须结算哪些尝试槽位，`./invariant` 伴随在每个读写点和 `domain/changed` 事件流上断言这种一致性。转换由驱动者拥有的 run 句柄（`run.result`）推导，而不是从只读的 `workflow/*` 事件推导，所以一个阶段只有一个存活事实来源。

## 生命周期与恢复

`start` 先写入持久记录再启动任何 run；该写入之后的崩溃可恢复。`resume(loopId, parent)` 从记录的当前阶段驱动状态机：已结算的尝试绝不重跑，且由于一个循环只有一个存活驱动者，第一个未完成阶段恰好重跑一次——对已被拥有的循环再次 `resume` 或 `start` 会响亮失败。父代理由调用方提供；运行时绝不伪造归属。`result` 只在终态记录持久化且最后一个阶段 run 释放之后结算，因此已结算的循环不拥有任何资源、不再写入任何内容。

有界交接回应历史审查溢出故障：`maxHandoffChars`（默认 16384）限制目标、每份实施摘要与每条审查反馈；超限产物使阶段响亮失败，且每个阶段子代理全新启动，只收到有界交接——绝不接收父对话或先前阶段的转录。

## 边界与限制

- 循环运行时是程序化服务。`durash` profile 的 composer 开关、会话策略与 `dsh_reliability_handoff` 工具是面向模型的消费者。
- 记录只持久化阶段转换。workflow 引擎没有日志，阶段中途崩溃会重跑该阶段一次；不投影成员级持久进度。
- 只有一个实施者与一个审查者——没有协调阶段、三路审查或阶段内扇出，`blocked` 停机之外也没有 `needs_replan` 轮次词汇。
- 只有持久 seam 故障（存储故障或不变量破坏）才会让 `result` reject；其余循环内部失败都以 `failed` 落入记录。
- 没有本地取消请求却以 `cancelled` 结算的 run 属于契约破坏，循环以 `failed` 停止，而不是误认为调用方取消。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

Types: [Agent](core.zh.md)

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
enabledRoutes(sessionId: SessionId): { readonly implementation: ReliabilityLaneRoute readonly review: ReliabilityLaneRoute } | undefined

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

Types: [SessionId](core.zh.md)

Source: [`packages/reliability/durash-reliability-policy/src/index.ts`](../../packages/reliability/durash-reliability-policy/src/index.ts)
<!-- END GENERATED cordis-surface -->
