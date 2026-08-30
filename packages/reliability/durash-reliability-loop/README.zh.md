---
description: "DuraSH 可靠性闭环：一个带产品自有持久状态、重启恢复与取消静止的有界实施-审查-返工闭环，跑在 ctx.workflowEngine 之上。"
kind: "package-reference"
---

# @durash/dsh-reliability-loop

[English](README.md) | 中文

## 概述

`dsh-reliability-loop` 运行一个有界的可靠性闭环：一个全新的实施子代理、一个全新的审查子代理，以及——当审查者要求修改时——恰好一轮返工与复审，之后循环以 `completed` 或 `blocked` 停止。这是 DuraSH 可靠性引擎的第一个产品自有切片：状态机是 `reliability-loop` storage domain 中的一条持久记录，每个阶段都作为 `ctx.workflowEngine` 上的普通 run 执行，运行时只拥有记录、边界与排序。重启后从记录的第一个未完成阶段恢复，不重跑已完成的尝试；取消后达到静止，留下终态记录且不再有存活的所有者。

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

`ctx.reliabilityLoopRuntime.start({ parent, objective })` 先写入循环的持久记录（阶段 `implementing`），然后返回句柄。句柄的 `result` 以终态记录结算；`cancel(reason?)` 停止在途阶段 run 并以 `cancelled` 结算；`dispose()` 在需要时取消，并等待持久结算与 run 释放。已结算的尝试会被保留，即使取消在其之后到来。

### 重启恢复

记录是唯一权威状态。进程重启后，`resume(loopId, parent)` 从记录的当前阶段驱动状态机：已结算的实施摘要与审查裁决绝不重跑；第一个未完成阶段恰好重跑一次，因为一个循环只有一个存活驱动者，对同一循环的第二次 `resume` 会响亮失败。`list()` 与 `get()` 投影持久记录。

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

一个循环就是一条记录：`reliability-loop` domain 的 `loops` 表承载整个状态机，因此每次转换都是一次单记录持久写入，恢复也只读取记录。`workflow/*` 事件保持只读观察；驱动者从它拥有的 run 句柄（`run.result`）推导转换，所以一个阶段只有一个存活事实来源。记录的阶段与其已结算尝试槽位由 `./invariant` 伴随在每个读写点断言。

### 源码映射

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 服务入口：start/resume 单一所有权、配置、拆卸顺序 |
| [`src/types.ts`](src/types.ts) | 词汇：循环 id、阶段、尝试槽位、记录、句柄 |
| [`src/spec.ts`](src/spec.ts) | `defineDomain` 声明与 zod 模式 |
| [`src/scripts.ts`](src/scripts.ts) | 固定阶段脚本、提示构建、报告校验 |
| [`src/driver.ts`](src/driver.ts) | 每循环所有者：阶段机、run 生命周期、取消、静止 |
| [`src/invariant.ts`](src/invariant.ts) | 不变量伴随：阶段/槽位一致性 |

### 生命周期与所有权

一个存活驱动者拥有一个循环；运行时强制这一点并对重复所有权响亮失败。Effect 按注册的逆序展开，因此拆卸先等待每个存活驱动者静止，再关闭 domain——终态写入绝不会落在已关闭的介质上。驱动者不拥有定时器，也不注册全局监听器：`result` 结算后，最后一个 run 已释放、记录已终态，取消因此收敛，而不是留下一个后台写入者。

### 失败纪律

只有当持久记录无法维护时（存储故障或不变量破坏）`result` 才 reject；每个循环内部失败都以 `failed` 落入记录。没有本地取消请求却出现 `cancelled` 的 run 结局属于契约破坏，循环以 `failed` 停止，而不是误认为调用方取消。

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

- **无面向模型入口** — 循环目前只是程序化服务；面向模型的工具或命令延期到下一个切片。
- **无成员级持久进度** — 记录持久化阶段转换，而不是阶段 run 内的每子代理进度；workflow 引擎没有日志，阶段中途崩溃会重跑该阶段。
- **一个实施者、一个审查者** — 没有协调阶段、三路审查或阶段内扇出；这些流水线形态在本基线上仍属旧分叉历史。
- **blocked 即终态** — `blocked` 的循环需要新循环；尚无持久的 `needs_replan` 轮次词汇。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

本 Dev Note 是维护者的工作上下文：尚未决定的方向。它明确不具权威性——已发布的行为、限制与既定依据以上方章节、包源码和链接的 Agent Note 为准。

待定方向：面向模型的消费者及其 UI 呈现；基于 `workflow/agent-*` 的成员级进度投影；在 blocked 阶段之上的 `needs_replan` 轮次词汇；以及如果单轮返工边界将来泛化，所需的多尝试槽位。

</details>
