---
description: "由 Host 持有的 DuraSH 可靠性闭环：快速持久交接、一次有界实施-审查-返工、重启恢复、会话状态与显式取消，运行于 ctx.workflowEngine 之上。"
kind: "package-reference"
---

# @durash/dsh-reliability-loop

[English](README.md) | 中文

## 概述

`dsh-reliability-loop` 持有一个有界后台可靠性闭环：一个全新实施子代理、一个全新独立审查子代理，以及需要时恰好一轮返工与复审。`startDetached()` 先持久写入 `accepted`，再于任何阶段结算前返回。此后执行归 Host 所有，不依赖发起它的模型回合、工具信号或浏览器连接。一条位于 `reliability_loop` storage domain 的版本 2 记录是执行真源；`reliability-loop/change` 只是供状态条与一次终态对话结果使用的完整会话投影。Host 拆卸会暂停以便恢复；只有受鉴权的显式取消才写入 `cancelled`。

## 目录

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

当工作必须经过独立审查认证才算完成，而认证策略——一轮返工、有界交接、持久进度——应当由部署方而非脚本或模型决定时，启动一个循环。运行时是 `durash` profile 上的组合插件：需要 `ctx.workflowEngine`、`ctx.storageDomain`（storage 家族）以及调用方提供的父代理。

### 启动、观察与取消

`ctx.reliabilityLoopRuntime.startDetached({ parent, objective, implementation, review })` 校验精确的存活根 Agent，以 revision 1、`accepted` 阶段和完整通道写入记录，取得唯一驱动者，发布会话状态，然后返回 `{ loopId, revision, status: 'accepted' }`。同一会话的并发启动会返回既有活动 ref，不会创建第二个写入者。

`details`、`cancel` 与 `dismiss` 是受鉴权的 Typert Remote。每次调用都校验精确存活 Agent、会话归属与 loop id。会修改状态的 `cancel` 和 `dismiss` 还要求当前 revision；只读 `details` 返回最新归属记录，因此终态 Conversation Node 在状态条关闭后仍可查看。取消会等待 workflow worker 和子代理释放后返回终态；关闭只隐藏当前可见终态，不删除历史。

### 重启恢复

记录是唯一权威执行状态。根 Agent 创建时，运行时接管其唯一非终态记录，补发缺失的派生会话状态，只重跑第一个未完成阶段；已结算报告保留。Host 或 Agent 拆卸会暂停当前 run 而不改变非终态阶段，绝不冒充用户取消。

### 阶段与有界返工

每个阶段是一个固定脚本的 workflow run 和一个全新子代理。实施者返回 `{ summary }`；审查者返回 `{ verdict, feedback }`。第一轮 `changes-requested` 裁决启动返工：返工实施者收到审查者的反馈，第二轮审查者验证的正是这条反馈。第二轮仍要求修改时循环以 `blocked` 停止，最终反馈成为持久 blocker。子代理失败、不可用报告或 run 失败使循环以 `failed` 停止；`cancelled` 只留给真实取消。

### 交接边界

`maxHandoffChars`（默认 16384）限制每个跨越阶段边界的产物——目标、实施摘要、审查反馈。超限产物使阶段响亮失败，而不是被截断或累积进下一阶段的上下文：每个阶段子代理都全新启动，只收到有界交接，绝不接收父对话或先前阶段的转录。

### 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `maxHandoffChars` | `16384` | 跨阶段产物字符上限；超限产物使阶段响亮失败。 |

生成的[配置目录](../../../docs/config-catalog.zh.md#durashdsh-reliability-loop)是每个已接受字段的穷尽来源。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

本节说明状态机、持久性与生命周期的划分；可观察行为完整覆盖于[Use this package](#use-this-package)。

### 设计概念

一个循环就是一条版本 2 记录：`reliability_loop` domain 的 `loops` 表保存会话归属、正 revision、两条不可变通道、两轮报告、阶段与生命周期时间。每次转换只替换这条记录一次。`workflow/*` 事件只供观察；驱动者从 `run.result` 推导转换。会话事件是派生展示投影，绝不会用来推进执行。

### 源码映射

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | Host 运行时：后台启动、接管、Remote、投影发布、拆卸顺序 |
| [`src/types.ts`](src/types.ts) | 客户端安全的标识、通道、记录、状态、详情与终态通知词汇 |
| [`src/spec.ts`](src/spec.ts) | `defineDomain` 声明与 zod 模式 |
| [`src/scripts.ts`](src/scripts.ts) | 固定阶段脚本、提示构建、报告校验 |
| [`src/driver.ts`](src/driver.ts) | 每循环写入者：阶段机、终态/暂停结算、run 生命周期 |
| [`src/projection.ts`](src/projection.ts) | 拒绝 revision 回退的完整会话投影 |
| [`src/client.ts`](src/client.ts) | 浏览器安全的 Typert Remote 声明 |
| [`src/invariant.ts`](src/invariant.ts) | 不变量伴随：阶段/轮次一致性 |

### 生命周期与所有权

一个存活驱动者拥有一个循环。运行时在启动驱动者之前先观察其结果，因此阶段、provider、worker 与存储故障不会变成终止 Host 的未处理 rejection。用户显式取消与 Host 暂停是两种不同结算：取消在静止后写入一次终态；暂停释放当前 run 并保留可恢复阶段。拆卸先停止所有驱动者并排空变更，再关闭 domain。

### 失败纪律

每个循环内部失败都会以 `failed` 落入记录，包括子代理失败、workflow 错误、worker death、无效报告，以及没有本地停止请求的 provider 取消。派生会话 append 失败不能回滚已经提交的 domain 记录；后续 Agent 接管会补齐缺失投影。

</details>

-----

<a id="further-exploration"></a>
## 进一步阅读

- [可靠性组页](../README.zh.md) — 本包开启的家族。
- [Workflow 子系统](../../../docs/subsystems/workflow.zh.md) — 每个阶段执行所依赖的 run seam。
- [Storage domain 数据形态](../../../packages/storage/storage-domain/README.zh.md) — 持久记录介质及其写入链。
- [INTEGRATION_STATUS](../../../INTEGRATION_STATUS.md) — 可靠性引擎在本基线上的迁移状态。
- [可靠性闭环 Agent Note](../../../.agents/notes/implemented/feature/2026-08-30-durash-reliability-loop-first-slice.zh.md) — 第一个切片背后的设计决策。

-----

<a id="model-experience"></a>
## 模型体验

间接体验：组装每个阶段子代理请求的是 workflow 引擎与 subagent 提供方；运行时自身不贡献任何提示、模式或结果渲染。

#### KV Cache 效应

无直接失效；请求前缀的变化由 workflow 引擎与 subagent 提供方负责。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **本包没有面向模型入口** — composer 开关、会话策略与 `dsh_reliability_handoff` 工具在本组的兄弟包中。
- **无成员级持久进度** — 记录持久化阶段转换，而不是阶段 run 内的每子代理进度；workflow 引擎没有日志，阶段中途崩溃会重跑该阶段。
- **一个实施者、一个审查者** — 没有协调阶段、三路审查或阶段内扇出；这些流水线形态在本基线上仍属旧分叉历史。
- **blocked 即终态** — `blocked` 的循环需要新循环；尚无持久的 `needs_replan` 轮次词汇。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

本 Dev Note 是维护者的工作上下文：尚未决定的方向。它明确不具权威性——已发布的行为、限制与既定依据以上方章节、包源码和链接的 Agent Note 为准。

待定方向：成员级持久 workflow 进度、blocked 之上的 `needs_replan` 词汇、多路审查汇总，以及单轮返工边界泛化时需要的多尝试记录。

</details>
