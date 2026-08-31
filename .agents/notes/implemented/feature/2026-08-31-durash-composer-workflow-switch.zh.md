# Agent Note: DuraSH composer 工作流开关

Status: implemented

[English](2026-08-31-durash-composer-workflow-switch.md) | 中文

## 问题

3081 产品在 composer 上有 **工作流** 开/关芯片（`ui-runs` 里的 `WorkflowPolicyDock`）：按会话保存实施与审查模型，启用后把对话里的实现工作交给独立的实施/审查闭环。DuraSH 用 `@durash/dsh-reliability-loop` 替换了那套 Pi orchestrator，并明确推迟了面向模型的消费者。开源时如果没有这个开关，闭环就只剩程序化入口：用户无法在 composer 上打开它、挑选两个模型，也无法让人类回合启动经过认证的实施/审查工作。把已退役的 3081 `workflow-orchestrator` / `executor-pi` / `dsh-runs` 栈复制到当前基线，会重新制造第一个可靠性切片拒绝的硬分叉。

## 决策

`durash` profile 在现有闭环周围挂载三个兄弟包：

- `@durash/dsh-reliability-policy`（`ctx.reliabilityPolicy`）— 每个会话一行持久的 `reliability_policy`：启用标志加上 `provider/model` 选择器与记下的思考强度。每次读取都从 `ctx.llm` 重建目录；选择器已离开目录的启用行会被关掉。
- `@durash/dsh-client-ui-reliability` — 把 3081 的 composer 芯片接回 `conversation.input.left`（`id: workflow`）。只通过生成的 `reliabilityPolicy` Remote 通信。
- `@durash/dsh-tool-reliability` — `dsh_reliability_handoff`，进程内注册，会话策略关闭时闭门失败，打开后用保存的实施/审查路由启动一次闭环。

Dock 选择性恢复 3081 中经过验证的呈现方式，不恢复它的状态模型。设置面板通过 portal 挂到 `document.body`，用共享的 `useAnchoredPosition` 与 `useAnchoredMaxHeight` primitive 固定在 composer 触发器上方，并受视口约束。思考强度使用共享的 portaled `Menu`；模型目录有自己的 body portal，因此两个界面都不会被面板滚动区裁剪。所有值仍来自当前 `reliabilityPolicy` 快照，并通过它生成的 Remote 保存。

闭环记录现在持久化可选的通道 provider/model，以便恢复时仍用同一批子代理。思考强度记在策略行上，因为 worker-thread 的 `agent()` 仍推迟 `effort`。

这就是[第一个可靠性闭环切片](2026-08-30-durash-reliability-loop-first-slice.zh.md)推迟的面向模型消费者。它不是 Pi 执行器、Runs 控制台或三路审查流水线的移植。

## 考虑过的替代方案

**从 3081 worktree 移植 `ui-runs` 以及 `workflow-orchestrator`、`dsh-runs`、`executor-pi`。** 拒绝：那是第一个切片拒绝复制的 1.8 万行编排栈，且 `executor-pi` 属于本开源产品线不交付的闭源 Pi RPC 产品。

**只有死的 composer 芯片，没有 Host 策略或工具。** 拒绝：3081 开关的职责是让下一轮用户回合跑实施/审查，而不是显示一个什么都不写的拨动。

**把面板留在 composer 内并使用原生 select。** 拒绝：composer 的 overflow 与右侧边缘位置会裁剪树内绝对定位面板，原生 select 的界面也不符合共享菜单呈现。Portal 与共享定位能力可以修复这些呈现问题，而不引入旧编排状态。

**把策略和工具放进 `durash-reliability-loop`。** 拒绝：闭环包的契约是 `ctx.workflowEngine` 上的持久阶段机。会话 UI 策略与面向模型的工具独立演化，会把 Host Remote、LLM 目录和提示段落所有权混进引擎。

## 后果

`durash` Web 会话在 composer 上显示「工作流」。即使 composer 靠近底部或右侧边缘，设置面板、思考强度菜单与模型目录也会保持在视口内。两条通道都选好模型后打开开关，会注入交接指导，并让模型调用 `dsh_reliability_handoff`，按所选路由启动可靠性闭环。默认关闭。面板里的思考强度按会话保存，尚未传给子代理。3081 的 Runs 控制台与三路审查流水线不属于本切片。

## 测试

`packages/reliability/durash-reliability-policy/tests/policy.spec.ts` 覆盖默认关闭读取、ensure 默认值、必须两条通道都齐才能启用，以及保存的模型离开目录时关掉启用行。`packages/reliability/durash-tool-reliability/tests/tool-reliability.spec.ts` 覆盖门控指导、闭门失败的 execute，以及用会话通道启动闭环。`packages/client/ui-reliability/tests/` 覆盖控制器拒绝不完整启用、composer 芯片与槽位注册、body portal 所有权、外部点击与 Escape 关闭、共享思考强度菜单、模型目录 portal、选择，以及通过当前策略 API 保存。`packages/client/ui-primitives/tests/use-anchored-position.client.spec.tsx` 钉住共享的上方锚定坐标与尺寸变化观察。`apps/web/tests/durash-workflow-settings.e2e.ts` 在窄视口浏览器中启动构建后的 DuraSH profile，并打开位置更低的审查字段：面板、思考强度菜单与模型目录都使用 body portal 且保持在视口内，面板实际进入右侧贴边分支，两个选择界面也都符合共享的水平贴边计算。`packages/bundle/durash-web-profile/tests/profile.spec.ts` 断言 overlay 插入三行新产品 row。
