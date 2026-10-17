# Agent Note: Reliability handoff deadline ownership

Status: implemented

[English](2026-10-17-reliability-handoff-deadline-ownership.md) | 中文

## 问题

PTC 会话只能在 `run_code` 内调用 `dsh_reliability_handoff`。该程序的经过时间截止默认 120 秒、上限 600 秒，并且计入嵌套工具等待。截止触发后，`run_code` 中止嵌套调用。交接把这次中止当成取消，写入终态 `cancelled`，并杀掉在途阶段。模型随后看到 `execution deadline reached`，就在本会话里自己实施。可靠性循环无法在该预算内完成实施和审查，因此每个已开启的工作流都在审查前停止。

## 决策

可靠性循环由 `ctx.reliabilityLoopRuntime` 拥有，不由外层 `run_code` 截止时间拥有。`dsh_reliability_handoff` 设置 `runCodeDeadline: 'excluded'`。`run_code` 在这次等待期间暂停调用方的 `deadlineControl`，暂停时间不计入预算，同一次调用可以返回终态记录。截止时间中止被识别为 `run_code settled` 或 `execution deadline reached`，不会取消循环。`handoff({ parent, objective })` 附上该所有者的存活驱动者，或从最新未完成记录的当前阶段恢复。用户取消仍然取消。崩溃后未完成阶段仍会重跑；已结算尝试不重复。

本记录扩展 [composer 工作流开关](../feature/2026-08-31-durash-composer-workflow-switch.zh.md)。开关、策略行和路由选择仍由该记录拥有。

## 考虑过的替代方案

**提高 run_code 上限。** 更长的墙钟仍会在 Mac 或键盘实施完成前结束循环，并且会削弱所有其他程序的截止时间。

**要求子代理按节点汇报。** 阅读完毕、理解完毕和想法阶段没有可检查的完成条件。观察到的子代理在 600 秒截止触发时仍在阅读，所以“阅读完毕再汇报”救不了这次运行。在同一次 `run_code` 调用里汇报也不会移动截止时间。

**让父会话编排短阶段。** 这会把顺序交还给超时后离开工作流的会话。循环运行时已经拥有规划、实施、测试和审查。

## 后果

交接可以活过外层程序预算，但只有重建后的运行时加载后才如此。同一目标的重复交接会取回存活循环，或取回截止时间后停放的结果；循环未完成时，不同目标会被拒绝。不是截止时间的程序结束会取消循环。用户停止仍然取消，包括截止时间之后，因为交接跟随回合信号，而不是 run_code 的截止信号。截止时间本身不会把终态记录交回模型：外层 run_code 仍报告超时，下一次同一目标的交接取回停放的结果。阶段内部的子代理进度没有记账，所以崩溃会重跑未完成阶段。打包桌面从应用包解析这些包，不从 profile 副本解析，因此在该包重建之前这些行为都不会运行。
