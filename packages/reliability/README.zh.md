---
description: "可靠性组页：DuraSH 自有可靠性引擎家族，目前包含一个带产品自有持久状态的有界实施/审查闭环。"
kind: "package-group"
---

# packages/reliability

[English](README.md) | 中文

## 摘要

DuraSH 可靠性包在 `durash` profile 中提供一个实施阶段、独立审查和至多一轮返工。产品自有的 storage-domain 记录保存有界状态机。composer 开关、按会话策略和受门控的交接工具允许模型工作进入闭环。阶段使用 `ctx.workflowEngine` 及其 subagent 提供方，不改变 agent 循环或重复实现这些执行服务；这些包负责持久状态、执行边界与准入策略。

## 目录

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## 包列表

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`durash-reliability-loop`](durash-reliability-loop/README.zh.md) | 一个带持久状态、重启恢复与取消静止的有界实施-审查-返工闭环 | `ctx.reliabilityLoopRuntime` |
| [`durash-reliability-policy`](durash-reliability-policy/README.zh.md) | composer 开关的按会话启用状态与实施/审查模型选择 | `ctx.reliabilityPolicy` |
| [`durash-tool-reliability`](durash-tool-reliability/README.zh.md) | 受会话策略门控的模型工具 `dsh_reliability_handoff` | — |

-----

<a id="related-documentation"></a>
## 相关文档

- [INTEGRATION_STATUS](../../INTEGRATION_STATUS.md) — 哪些可靠性引擎行为已在本基线迁移并验证，哪些仍属旧分叉历史。
- [Workflow 子系统](../../docs/subsystems/workflow.zh.md) — 每个阶段执行所依赖的运行 seam。
- [Storage domain 数据形态](../storage/storage-domain/README.zh.md) — 持久记录介质。

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>维护者工作上下文——点击展开</summary>

本 Dev Note 是维护者的工作上下文：尚未决定的方向。它明确不具权威性——已发布的行为、限制与既定依据以上方章节、包源码和链接的 Agent Note 为准。

待定方向：成员级持久进度投影；协调与三路审查阶段；把已保存的思考强度传给阶段子代理；以及 workflow 引擎自身的持久执行（目前仍是进程内的）。

</details>
