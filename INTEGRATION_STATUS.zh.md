# DuraSH 融合状态

[English](INTEGRATION_STATUS.md) | 中文

本文件把当前源码事实与旧 DSH 分叉中曾经验收过的行为分开。历史能力只有在当前上游基线完成融合并通过聚焦回归后，才属于 DuraSH。

## 源码基线

- 主上游：`deepseek-ai/deepseek-harness`
- 分支/标签：`master` / `dsh-v0.1.6-alpha.2`
- 精确版本：[`UPSTREAM_SOURCES.json`](UPSTREAM_SOURCES.json)
- 2026-09-21 已拉取基线、与 DuraSH 产品叠加层完成协调，并和 `durash-upstream/master` 比对

## 能力矩阵

| 能力 | 当前状态 | 证据/边界 |
| --- | --- | --- |
| 最新 DSH 源码基线 | 已实现 | 源码已整合记录的上游基线 |
| 独立 DuraSH 品牌与 Web profile | 已实现 | 产品自有品牌包与增量 `durash` profile；上游官方品牌包保持不变 |
| DuraSH 源码构建与浏览器实际组合 | 已实现 | `build:durash`、DuraSH 浏览器组合回归及其 PR workflow 会独立于官方客户端构建验证产品 profile |
| workflow 脚本、资源上限、取消、成员生命周期事件 | 继承最新 DSH | `@deepseek-ai/dsh-workflow` 及其 Node PTC 引擎；DuraSH 为可靠性闭环启用引擎，通用 workflow 与 Ralph 工具保持禁用 |
| 主上游与依赖漂移检测 | 已运行 | 定时 workflow 检测到本次上游发布、创建了冲突 Issue，并持续审计 vendored 与 registry 依赖 |
| 受 CI 门禁保护的上游自动合并 | 已运行，冲突需人工门禁 | 无冲突的上游变更会准备同步 PR；产品叠加层冲突会停止而不覆盖 DuraSH 行为，并要求执行本次基线采用的协调流程 |
| 旧分叉中的独立持久化 Run store | 有界闭环已实现 | `@durash/dsh-reliability-loop` 在 `reliability-loop` storage domain 中为每个循环保留一条持久记录；旧分叉的通用 RunStore 控制面仍未对齐 |
| 固定“实施 → 协调 → 三路审查 → 汇总”流水线 | 未迁移 | 最新 DSH 提供通用 workflow 接口，不提供这项产品策略；已发布的循环只有一个实施者加一个审查者 |
| 带持久 blocker 停机的有界自动返工 | 有界闭环已实现 | 一轮返工，以携带最终审查反馈的持久 `blocked` 停机收尾；旧分叉在该停机之外的 `needs_replan` 轮次词汇未迁移 |
| 重启后恢复与独立取消/quiescence | 有界闭环已实现 | `resume()` 只重跑记录中第一个未完成阶段；取消与运行时拆卸都收敛到持久终态记录，不遗留后台写入者（聚焦回归在循环包内） |
| 旧分叉的 token 剪枝/压缩与溢出重试策略 | 未迁移 | 当前 DSH 有通用 compaction/token-meter 服务，但尚未证明与旧 workflow 专用策略等价 |
| DuraSH Desktop Harness | 支持本地 macOS 打包 | 应用包含产品 bundle、复用现有 Harness 数据，并独立保存 Desktop 可执行包；参见[本地打包](apps/desktop/README.zh.md#local-durash-macos-application) |
| DuraSH npm 发行版 | 未准备 | 源码运行已支持；DuraSH 自有包已标记为 private 并从继承的 DSH release family 排除，因此既不宣传 npm 包，也不会被意外发布 |

## 合并覆盖缺口

`dsh-v0.2.1-rc.2` 合并移除了产品此前依赖的上游包。此处记录由此产生的变化，而不是默默吸收：

- **运行时模型目录按配置写入刷新。** 上游删除了 `@deepseek-ai/dsh-settings-file`，把 `settings.yaml` 的处理移入 `@deepseek-ai/dsh-settings`，因此 `llm-pi-ai` 的同步器不再观测到某个 provider。现在它按根 context 各保留一份目录状态，在每次 `internal/config` 写入时重新同步，并且只在事实发生变化时发布 provider、model 与 source；被注册表拒绝的单条路由会被单独丢弃，而不是撤下整个集合。
- **预设作用域的全局规则走注册表。** 上游用 `agent-preset-registry` 取代了 `agent-presets`；settings 控制器现在通过 `agentPresets.serviceForPreset` 解析随包发布的 Host `AGENTS.md`，因为随包发布的 Web profile 会关闭根指令行并把它挂载到每个预设内部。
- **Invariant 伴随包已消失。** 上游删除了 `invariants` 服务、`sdk-minimal` 挂载以及每个包的 `./invariant` 伴随入口。可靠性相关的包现在依赖持久写入路径上的 `assertReliabilityLoopRecord`，而不再依赖独立观测者。
- **`dsh web --lan` 被上游选项取代。** 上游启动器提供 `--public-url` 与 `--tls-cert`/`--tls-key`；DuraSH 独有的 `--lan` 自签名 LAN 路径及其证书辅助模块随启动器重写一并移除，因此 LAN HTTPS 现在需要显式证书对。
- **Agent 预设改为声明式。** `agent-presets` 包及其预设作用域的服务查找已移除，针对全局规则的预设隔离测试也随之移除。
- **ralph 工具改为按需启用。** 上游把 `tool-ralph` 及其隔离的 workflow 引擎移入 `@deepseek-ai/dsh-experimental-ralph-bundle`，因此随包发布的 base、web 与 DuraSH profile 都不再包含 `tool-ralph` 行；产品 profile 仍保持面向模型的 `tool-workflow` 行关闭，只重新启用 workflow 引擎。

## 当前上游漂移

主源码版本与 vendored snapshot 记录在 [`UPSTREAM_SOURCES.json`](UPSTREAM_SOURCES.json) 中。定时审计报告相对于这些记录的变化。Vendored 包更新必须遵循 [`vendor/README.md`](vendor/README.md) 中的兼容性流程；存在更新的公共包发行版，不代表其源码已经完成整合。

## 融合结论

最新上游迁移与产品外壳都是真实落地，但可靠性引擎**尚未完全融合**。复用当前 DSH workflow 接口与 UI 是正确方向；把旧的约 1.8 万行编排栈直接复制到一个领先一千多个上游提交的新基线上，会重新制造硬分叉，因此明确拒绝。

可靠性引擎的第一个纵向切片已经落地：`@durash/dsh-reliability-loop` 在当前 workflow 生命周期之上维护产品自有的持久循环状态，完成一轮有界审查返工，重启后不重跑已完成尝试即可恢复，取消后收敛，并配有基于真实引擎与真实存储后端的聚焦回归。`durash` profile 上的 composer 工作流开关也已落地：按会话策略、`conversation.input.left` 芯片与 `dsh_reliability_handoff` 会按所选实施/审查模型启动一次闭环。引擎整体仍未迁移：没有成员级持久进度、没有协调或三路审查阶段、已保存的思考强度尚未传给阶段子代理，workflow 引擎自身也依旧没有日志。

## Core-fork 例外

当前没有。此次迁移的所有 DuraSH runtime 新增都是 overlay 或 plugin。未来如果能力必须修改上游包，合入前必须在这里记录缺失的扩展接口、涉及文件、回归与退出条件。
