---
description: "可靠性组页：DuraSH 自有可靠性引擎家族，目前包含一个带产品自有持久状态的有界实施/审查闭环。"
kind: "package-group"
---

# packages/reliability

[English](README.md) | 中文

## 摘要

可靠性组承载 DuraSH 自有的编排策略，把原始模型工作转化为经过认证的成果。它的第一个成员是有界实施/审查闭环：一个实施阶段、一个审查阶段、至多一轮返工，全部跑在 `ctx.workflowEngine` 之上，循环状态机以产品自有记录的形式持久化在 storage-domain 数据形态中。本组只组合进 `durash` profile；不新增面向模型的工具，也不改变 agent 循环。组内任何内容都不重新实现 workflow 引擎或 subagent 提供方——那些 seam 仍是唯一执行路径，本组只拥有持久状态机及其边界。

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

待定方向：面向模型的循环消费工具；成员级持久进度投影；协调与三路审查阶段；以及 workflow 引擎自身的持久执行（目前仍是进程内的）。

</details>
