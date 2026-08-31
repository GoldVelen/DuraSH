# Agent Note: DuraSH 可靠性闭环——第一个纵向切片

Status: implemented

[English](2026-08-30-durash-reliability-loop-first-slice.md) | 中文

## 问题

DuraSH 继承了当前 DeepSeek Harness 的 workflow seam：它能执行编排脚本但不记录任何日志——run 的进度随进程一起消亡，其上也不存在任何产品级状态机。旧下游分叉用自己的约 1.8 万行编排栈解决了这个问题（持久 Run store、固定的实施/协调/三路审查流水线、带持久 `needs_replan` 停机的有界返工），而把这套栈复制到新基线上会重新制造一个落后一千多个上游提交的硬分叉。因此可靠性引擎需要一个纵向切片，同时证明：产品自有持久状态、一次有界审查返工、不重复任务的重启恢复，以及取消后的静止——且不重建旧编排层、不修改上游包。

## 决策

`@durash/dsh-reliability-loop`（packages/reliability/durash-reliability-loop，只组合进 `durash` profile）在 `ctx.workflowEngine` 之上实现一个有界的实施-审查-返工闭环：

- **一个循环就是一条持久记录。** `reliability_loop` storage domain（在 base bundle 已挂载的 storage 家族上打开）的 `loops` 表中每个循环一条记录；记录携带目标、当前阶段与已结算的尝试槽位。每次阶段转换都是一次单记录持久写入，恢复也只读取记录。后续会话投影是派生展示状态，绝不是第二执行 store。
- **workflow seam 仍是唯一执行路径。** 每个阶段是一个固定脚本、单个全新子代理的 run；驱动者从它拥有的 run 句柄（`run.result`）推导转换，而不是从只读的 `workflow/*` 事件推导，所以一个阶段只有一个存活事实来源。运行时不贡献任何引擎、提供方或 agent 循环行为。
- **返工边界为一轮。** 第一轮 `changes-requested` 裁决启动恰好一轮返工：返工实施者收到审查者反馈，由第二轮审查者验证。第二轮仍要求修改时循环以 `blocked` 停止，反馈成为持久 blocker；其余任何失败使循环以 `failed` 停止。
- **恢复只重跑未完成的阶段。** Agent 接管从记录的当前阶段驱动状态机；已结算的摘要与裁决绝不重跑，且单一所有权使未完成尝试只重新执行一次。接管始终使用精确存活的所属 Agent——运行时绝不伪造。
- **取消收敛且不同于暂停。** 用户显式取消会取消在途 run、释放它、写入终态记录并结算。服务或 Agent 拆卸会暂停 run 而不写虚假终态，然后在关闭 domain 前等待每个驱动者停止。
- **有界交接回应旧的溢出故障。** `maxHandoffChars` 限制每个跨越阶段边界的产物（目标、实施摘要、审查反馈）；超限产物使阶段响亮失败，且每个阶段子代理全新启动——父对话与先前转录绝不累积进审查者的上下文。

`INTEGRATION_STATUS.zh.md` 如实记录已迁移的行及其剩余边界。

## 已考虑的替代方案

- **把执行状态持久化为父会话事件。** 拒绝，因为这会让恢复耦合到模型历史存储，并创建第二执行来源。后续 `reliability-loop/change` 事件刻意只是从 domain 派生的完整展示投影，绝不是状态机。
- **复制旧分叉的 RunStore 与流水线。** 设计开始前即被拒绝：那会重新引入 1.8 万行编排栈、一个平行执行模型，以及针对当前基线的硬分叉。本切片复用 workflow 引擎执行，只重建旧 store 提供的持久控制面。
- **在没有存活所属 Agent 时于插件挂载阶段恢复。** 拒绝，因为这会伪造归属。后续 Host 持有运行时只在精确根 Agent 已存在时接管，因此在不违反此约束的情况下提供自动恢复。
- **从 `workflow/*` 事件推导转换。** 监听事件总线作为转换来源会复制 run 句柄的结算事实，重新引入记录本要终结的"一个事实两个来源"问题。事件仍可供 UI 监听者使用；循环不消费它们。

## 后果

后续的 [Host 持有可靠性闭环决策](2026-08-31-host-owned-reliability-loop.zh.md)取代了本切片中由调用方持有句柄、显式恢复、拆卸即取消及没有会话投影的细节。本笔记继续拥有固定阶段、单一 domain 记录、有界交接与不恢复旧执行器的决策。

基线现在带有一个经过验证的持久控制面，可承载有界认证工作：聚焦回归覆盖持久的阶段机、单轮返工到 `completed` 与 `blocked`、重启恢复、重复中断的幂等性、取消静止与运行时拆卸顺序——全部跑在真实 worker 线程引擎与真实 JSON 存储后端上，崩溃用注入的持久写入故障模拟。循环包内本切片刻意不提供：阶段 run 内部的成员级持久进度（引擎没有日志，阶段中途崩溃会重跑该阶段）、协调或三路审查阶段、blocked 之外的 `needs_replan` 轮次词汇，以及 workflow 引擎自身的持久执行。面向模型的消费者——composer 开关、会话策略与 `dsh_reliability_handoff`——见后续[工作流开关笔记](2026-08-31-durash-composer-workflow-switch.zh.md)。

## 测试

`packages/reliability/durash-reliability-loop/tests/loop.spec.ts` 运行真实组合（worker 线程引擎 + storage 家族 + 运行时），配合人工子代理提供方，断言：端到端 approved 路径、单轮返工到 `completed` 与 `blocked`、响亮的 `failed` 停止、不重跑已完成工作的重启恢复、重复中断不复制尝试、取消与拆卸静止、start/resume 拒绝规则，以及记录不变量对不一致存储状态的拒绝。
