# DuraSH 融合状态

[English](INTEGRATION_STATUS.md) | 中文

本文件把当前源码事实与旧 DSH 分叉中曾经验收过的行为分开。历史能力只有在当前上游基线完成融合并通过聚焦回归后，才属于 DuraSH。

## 已验证基线

- 主上游：`deepseek-ai/deepseek-harness`
- 分支/标签：`master` / `dsh-v0.1.2-alpha.1`
- 提交：`cd5ef8148158c3a752a658978873241fdf8e2bbc`
- 2026-08-30 已拉取并与 `origin/master` 比对

## 能力矩阵

| 能力 | 当前状态 | 证据/边界 |
| --- | --- | --- |
| 最新 DSH 源码基线 | 已实现 | 当前分支从上面的已验证提交开始 |
| 独立 DuraSH 品牌与 Web profile | 已实现 | 产品自有品牌包与增量 `durash` profile；上游官方品牌包保持不变 |
| DuraSH 源码构建与浏览器实际组合 | 已实现 | `build:durash`、DuraSH 浏览器组合回归及其 PR workflow 会独立于官方客户端构建验证产品 profile |
| workflow 脚本、资源上限、取消、成员生命周期事件 | 继承最新 DSH | `@deepseek-ai/dsh-workflow`、worker-thread engine、workflow tool 与 workflow-run UI |
| 主上游与依赖漂移检测 | 本地已实现 | 定时同步 workflow、来源 manifest、漂移脚本与零冷却 Dependabot；公共仓库启用 Actions 后才正式运行 |
| 受 CI 门禁保护的上游自动合并 | 已准备，未启用 | 需要公共仓库分支保护与 `UPSTREAM.md` 记录的 opt-in 仓库变量 |
| 旧分叉中的独立持久化 Run store | 有界闭环已实现 | `@durash/dsh-reliability-loop` 在 `reliability-loop` storage domain 中为每个循环保留一条持久记录；旧分叉的通用 RunStore 控制面仍未对齐 |
| 固定“实施 → 协调 → 三路审查 → 汇总”流水线 | 未迁移 | 最新 DSH 提供通用 workflow 接口，不提供这项产品策略；已发布的循环只有一个实施者加一个审查者 |
| 带持久 blocker 停机的有界自动返工 | 有界闭环已实现 | 一轮返工，以携带最终审查反馈的持久 `blocked` 停机收尾；旧分叉在该停机之外的 `needs_replan` 轮次词汇未迁移 |
| 重启后恢复与独立取消/quiescence | 有界闭环已实现 | `resume()` 只重跑记录中第一个未完成阶段；取消与运行时拆卸都收敛到持久终态记录，不遗留后台写入者（聚焦回归在循环包内） |
| 旧分叉的 token 剪枝/压缩与溢出重试策略 | 未迁移 | 当前 DSH 有通用 compaction/token-meter 服务，但尚未证明与旧 workflow 专用策略等价 |
| DuraSH npm 发行版 | 未准备 | 源码运行已支持；DuraSH 自有包已标记为 private 并从继承的 DSH release family 排除，因此既不宣传 npm 包，也不会被意外发布 |

## 当前上游漂移

2026-08-30 实时审计确认主 DSH 分支仍是最新，同时检测到四个更高版本的公共 vendored 包：Cordis `4.0.0-rc.9`、Cordis Loader `1.0.0-rc.6`、Cordis Include `1.0.5` 与 Cordis Timer `1.1.3`。最新官方 DSH 基线仍携带已记录的旧 snapshot 与本地修改。DuraSH 会暴露这项漂移，并要求先执行 vendored 兼容性 runbook 才能接受；检测到新版本不等于这些版本已经完成融合。

## 融合结论

最新上游迁移与产品外壳都是真实落地，但可靠性引擎**尚未完全融合**。复用当前 DSH workflow 接口与 UI 是正确方向；把旧的约 1.8 万行编排栈直接复制到一个领先一千多个上游提交的新基线上，会重新制造硬分叉，因此明确拒绝。

可靠性引擎的第一个纵向切片已经落地：`@durash/dsh-reliability-loop` 在当前 workflow 生命周期之上维护产品自有的持久循环状态，完成一轮有界审查返工，重启后不重跑已完成尝试即可恢复，取消后收敛，并配有基于真实引擎与真实存储后端的聚焦回归。引擎整体仍未迁移：循环还没有面向模型的入口、没有成员级持久进度、没有协调或三路审查阶段，workflow 引擎自身也依旧没有日志。

## Core-fork 例外

当前没有。此次迁移的所有 DuraSH runtime 新增都是 overlay 或 plugin。未来如果能力必须修改上游包，合入前必须在这里记录缺失的扩展接口、涉及文件、回归与退出条件。
