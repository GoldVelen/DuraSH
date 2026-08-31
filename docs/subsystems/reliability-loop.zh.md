# 可靠性闭环

[English](reliability-loop.md) | 中文

[`@durash/dsh-reliability-loop`](../../packages/reliability/durash-reliability-loop) 是由 DuraSH Host 持有的有界交付引擎。它在 `reliability_loop` storage domain 中持久保存一条实施通道、一条独立审查通道和最多一轮返工。它只组合进 `durash` profile，每个阶段都使用通用[工作流子系统](workflow.zh.md)。

源码：[`packages/reliability/durash-reliability-loop/src/types.ts`](../../packages/reliability/durash-reliability-loop/src/types.ts)

## 快速交接

`startDetached()` 鉴权精确的存活根 Agent，以 `accepted` 阶段写入版本 2 记录，取得唯一存活驱动者，发布当前会话 view，然后在实施、审查或返工阶段结算前返回 `{ loopId, revision, status: 'accepted' }`。接管完成后，发起它的模型回合、工具信号、代码运行上限与浏览器连接都不拥有该闭环。同一会话的第二次启动会返回既有活动 ref，不会创建另一个写入者。

面向模型的 [`dsh_reliability_handoff`](../../packages/reliability/durash-tool-reliability/README.zh.md) 只接受当前由直接人类发起的根回合。它从会话策略读取完整实施与审查通道，返回快速回执；它不等待终态，也不把自身 abort 信号映射成闭环取消。

## 持久状态与阶段

一行记录是唯一执行真源。它包含所属会话、正 revision、完整目标、不可变的 provider/model/reasoning-effort 通道、两轮有界报告、当前阶段、生命周期时间，以及可选终态错误或关闭时间。domain schema 版本为 2。预发布的版本 1 介质会被拒绝，不进行猜测或重写。

阶段为 `accepted`、`implementing`、`reviewing`、`rework-implementing`、`rework-reviewing`、`completed`、`blocked`、`failed` 与 `cancelled`。第一轮 `changes-requested` 进入一次返工；第二轮仍要求修改则进入 `blocked`。每个阶段子代理全新启动，只接收有界目标或报告交接。`maxHandoffChars` 默认 16384，超限输入会被拒绝，不会截断。

## 所有权、暂停与取消

一个 `LoopDriver` 是一个闭环的唯一存活写入者。运行时在驱动前先挂接结果观察者，因此 provider、子代理、workflow worker、报告与存储故障会被收敛，不能变成 Host 级未处理 rejection。只要记录仍可维护，闭环内部失败就写成持久 `failed`。

Host 或所属 Agent 拆卸会调用 `suspend`：取消并释放当前 workflow run，等待资源停止，保持非终态持久阶段不变。重启后 Agent 接管该阶段，只重跑第一个未完成阶段；已提交报告会保留。`cancelled` 只留给受鉴权的用户显式操作。`cancel` 校验会话归属与精确 revision，等待 worker 和子代理静止，然后发布一次终态结果。

## 会话状态与操作

`reliability-loop/change` 是 domain 提交后派生的 required-on-read、log-only 会话事件。它携带完整当前状态及可选的每闭环一次终态通知。`reliabilityLoop` 会话投影拒绝同一闭环的 revision 回退。它是展示状态，不是第二执行真源：恢复和阶段转换绝不读取它。若 domain 提交成功而事件 append 失败，Agent 接管会补发最新 view。

客户端以 order `-10` 注册紧凑的 `conversation.input.dock` 状态条。它只读取活动会话投影，覆盖九个阶段，按需加载完整详情，二次确认取消，只关闭精确可见的终态 revision。终态 `reliability-loop/change` 创建一个稳定的 loop-id Conversation Node；活动遥测不进入主对话，终态渲染也不调用模型。

`details`、`cancel` 与 `dismiss` Typert Remote 要求精确存活 Agent 与匹配的会话归属。会修改状态的 `cancel` 和 `dismiss` 还要求当前 loop revision，因此未知、跨会话和 stale 写入 ref 都闭门失败。只读 `details` 返回最新归属记录，使终态 Conversation Node 在关闭后仍可查看。关闭只隐藏最新可见终态，不删除 domain 记录，也不重新翻出旧结果。

## 模型路由与上下文韧性

[`@durash/dsh-reliability-policy`](../../packages/reliability/durash-reliability-policy/README.zh.md) 根据 adapter 实时元数据重建精确模型目录。它保留失效选择并给出具体校验错误，拒绝用其启动；绝不静默更换模型或档位。有效路由把 provider、model 与可选 reasoning effort 快照进闭环，通用 workflow worker 再把这些字段传给各阶段子代理。

同进程阶段子代理加入父代理的精确 preset generation。在发布的 standard preset 下，它们因此继承 token meter、可回放工具结果裁剪器与压缩引擎。既有压缩回归覆盖超大工具结果裁剪、provider 确认上下文超限后的压缩重试，以及保留输入不可分割时的明确失败。本子系统不恢复旧 3081 的 workflow 专用执行器，也不放宽代码运行的 wall-clock 上限。

## 边界

- 当前产品闭环只有一个实施者、一个审查者和一轮返工。计划协调、多路对抗性审查、汇总与自动成本调度尚未实现。
- 通用 workflow 引擎不记录脚本内部进度。阶段内崩溃会在接管后重跑该未完成阶段；本系统不声称成员级持久进度。
- 终态摘要是确定且有界的。完整目标和两轮报告需要受鉴权的详情 Remote；原始 provider 与子代理证据留在所属 workflow 和子会话中。

所有权与投影决策记录于 [Host 持有的可靠性闭环 Agent Note](../../.agents/notes/implemented/feature/2026-08-31-host-owned-reliability-loop.zh.md)。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

Types: [SessionId](core.zh.md)

Source: [`packages/reliability/durash-reliability-policy/src/index.ts`](../../packages/reliability/durash-reliability-policy/src/index.ts)
<!-- END GENERATED cordis-surface -->
