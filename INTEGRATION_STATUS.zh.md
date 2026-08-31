# DuraSH 融合状态

[English](INTEGRATION_STATUS.md) | 中文

本文件把当前源码事实与旧 DSH 分叉中曾经验收过的行为分开。历史能力只有在当前上游基线完成融合并通过聚焦回归后，才属于 DuraSH。

## 已验证基线

- 主上游：`deepseek-ai/deepseek-harness`
- 分支/标签：`master` / `dsh-v0.1.2-alpha.2`
- 提交：`0a53fb55bea101816fa226bb964ae2bed71c343b`
- 2026-08-31 已拉取基线、与 DuraSH 产品叠加层完成协调，并和 `origin/master` 比对

## 能力矩阵

| 能力 | 当前状态 | 证据/边界 |
| --- | --- | --- |
| 最新 DSH 源码基线 | 已实现 | 当前分支从上面的已验证提交开始 |
| 独立 DuraSH 品牌与 Web profile | 已实现 | 产品自有品牌包与增量 `durash` profile；上游官方品牌包保持不变 |
| DuraSH 源码构建与浏览器实际组合 | 已实现 | `build:durash`、DuraSH 浏览器组合回归及其 PR workflow 会独立于官方客户端构建验证产品 profile |
| workflow 脚本、资源上限、取消、成员生命周期事件 | 继承最新 DSH | `@deepseek-ai/dsh-workflow`、worker-thread engine、workflow tool 与 workflow-run UI |
| 主上游与依赖漂移检测 | 已运行 | 定时 workflow 检测到本次上游发布、创建了冲突 Issue，并持续审计 vendored 与 registry 依赖 |
| 受 CI 门禁保护的上游自动合并 | 已运行，冲突需人工门禁 | 无冲突的上游变更会准备同步 PR；产品叠加层冲突会停止而不覆盖 DuraSH 行为，并要求执行本次基线采用的协调流程 |
| 旧分叉中的独立持久化 Run store | 有界闭环已实现 | `@durash/dsh-reliability-loop` 在 `reliability-loop` storage domain 中为每个循环保留一条持久记录；旧分叉的通用 RunStore 控制面仍未对齐 |
| 固定“实施 → 协调 → 三路审查 → 汇总”流水线 | 未迁移 | 最新 DSH 提供通用 workflow 接口，不提供这项产品策略；已发布的循环只有一个实施者加一个审查者 |
| 带持久 blocker 停机的有界自动返工 | 有界闭环已实现 | 一轮返工，以携带最终审查反馈的持久 `blocked` 停机收尾；旧分叉在该停机之外的 `needs_replan` 轮次词汇未迁移 |
| 快速交接、输入框上方状态与一次终态交付 | 有界闭环已实现 | 面向模型的调用在持久写入 `accepted` 后返回；会话投影驱动紧凑状态条与稳定终态对话节点，主对话不承载实时遥测 |
| 重启后恢复与显式取消/quiescence | 有界闭环已实现 | Host 或 Agent 拆卸会暂停活动阶段而不写 `cancelled`；重新接管后从第一个未完成阶段恢复，只有受鉴权的用户取消才等待 worker/子代理静止并写入一次终态 |
| 阶段子代理中的通用 token 剪枝、压缩与溢出恢复 | 已在发布的 standard 组合上验证 | 委派子代理加入父代理的精确 preset generation，继承 token meter、工具结果裁剪与压缩；既有可回放测试覆盖超大工具结果、可恢复和不可恢复的 provider 超限，不恢复旧 workflow 专用执行器 |
| 精确模型思考强度 | 已实现 | 策略读取 adapter 的实时能力元数据，对失效选择明确报错而不静默改档；workflow worker 把所选档位传给每个阶段子代理；pi-ai 0.84.4 下 Grok 4.6 只提供 low/medium/high/xhigh |
| DuraSH npm 发行版 | 未准备 | 源码运行已支持。产品 profile、品牌与 Host 闭环仍只随源码提供；策略/工具/UI 的 manifest 为保证包完整性保持可发行结构，但尚未发布或验收任何 DuraSH npm 版本或标签 |

## 当前上游漂移

2026-08-31 实时审计确认本次协调后主 DSH 分支已是最新，同时检测到四个更高版本的公共 vendored 包：Cordis `4.0.0-rc.9`、Cordis Loader `1.0.0-rc.6`、Cordis Include `1.0.5` 与 Cordis Timer `1.1.3`。最新官方 DSH 基线仍携带已记录的旧 snapshot 与本地修改。DuraSH 会暴露这项漂移，并要求先执行 vendored 兼容性 runbook 才能接受；检测到新版本不等于这些版本已经完成融合。

## 融合结论

最新上游迁移与产品外壳都是真实落地，但可靠性引擎**尚未完全融合**。复用当前 DSH workflow 接口与 UI 是正确方向；把旧的约 1.8 万行编排栈直接复制到一个领先一千多个上游提交的新基线上，会重新制造硬分叉，因此明确拒绝。

有界可靠性切片现在已经接入当前 Host 生命周期：`@durash/dsh-reliability-loop` 拥有版本 2 持久状态，快速返回接管回执，不受发起回合和浏览器连接生命周期支配；拆卸时暂停而不伪造取消，并发布派生的会话级状态与一次终态结果。`durash` composer 选择精确的实施/审查模型及其支持档位，通用 worker 传递这些值，阶段子代理也继承当前 standard preset 的裁剪与压缩服务。更大的引擎仍未迁移：没有成员级持久进度、协调阶段、多路审查汇总或自动成本调度；由于通用 workflow 引擎不记录脚本内部进度，阶段中途崩溃仍会重跑该未完成阶段。

## Core-fork 例外

当前没有。此次迁移的所有 DuraSH runtime 新增都是 overlay 或 plugin。未来如果能力必须修改上游包，合入前必须在这里记录缺失的扩展接口、涉及文件、回归与退出条件。
