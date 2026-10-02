# DuraSH 融合状态

[English](INTEGRATION_STATUS.md) | 中文

本文件把当前源码事实与旧 DSH 分叉中曾经验收过的行为分开。历史能力只有在当前上游基线完成融合并通过聚焦回归后，才属于 DuraSH。

## 源码基线

- 主上游：`deepseek-ai/deepseek-harness`
- 分支/标签：`master` / `dsh-v0.2.0-rc.2`
- 精确版本：[`UPSTREAM_SOURCES.json`](UPSTREAM_SOURCES.json)
- 2026-10-02 已在独立 clone 的 `codex/upstream-integration-20261002` 分支准备升级候选。合并尚未提交，不代表发布验收或部署。

## 能力矩阵

以下实现清单描述保留的能力；只有“本地验证”中列出的检查构成本次升级候选的证据。

| 能力 | 当前状态 | 证据/边界 |
| --- | --- | --- |
| DSH 源码升级 | 本地验证通过的候选 | 记录的上游版本已整合到隔离工作区，尚未提交；发布验收仍未完成 |
| 独立 DuraSH 品牌与 Web profile | 已实现 | 产品自有品牌包与增量 `durash` profile；上游官方品牌包保持不变 |
| DuraSH 源码构建与浏览器实际组合 | 本地已验证 | `build:durash` 及品牌、PWA、工作流浏览器检查通过；不代表发布验收 |
| workflow 脚本、资源上限、取消、成员生命周期事件 | 继承最新 DSH | `@deepseek-ai/dsh-workflow` 及其 Node PTC 引擎；DuraSH 为可靠性闭环启用引擎，通用 workflow 与 Ralph 工具保持禁用 |
| 主上游与依赖漂移检测 | 已运行 | 定时 workflow 检测到本次上游发布、创建了冲突 Issue，并持续审计 vendored 与 registry 依赖 |
| 受 CI 门禁保护的上游自动合并 | 已运行，冲突需人工门禁 | 无冲突的上游变更会准备同步 PR；产品叠加层冲突会停止而不覆盖 DuraSH 行为，并要求执行本次基线采用的协调流程 |
| 旧分叉中的独立持久化 Run store | 有界闭环已实现 | `@durash/dsh-reliability-loop` 在 `reliability-loop` storage domain 中为每个循环保留一条持久记录；旧分叉的通用 RunStore 控制面仍未对齐 |
| 固定“实施 → 协调 → 三路审查 → 汇总”流水线 | 未迁移 | 最新 DSH 提供通用 workflow 接口，不提供这项产品策略；已发布的循环只有一个实施者加一个审查者 |
| 带持久 blocker 停机的有界自动返工 | 有界闭环已实现 | 一轮返工，以携带最终审查反馈的持久 `blocked` 停机收尾；旧分叉在该停机之外的 `needs_replan` 轮次词汇未迁移 |
| 重启后恢复与独立取消/quiescence | 有界闭环已实现 | `resume()` 只重跑记录中第一个未完成阶段；取消与运行时拆卸都收敛到持久终态记录，不遗留后台写入者（聚焦回归在循环包内） |
| 旧分叉的 token 剪枝/压缩与溢出重试策略 | 未迁移 | 当前 DSH 有通用 compaction/token-meter 服务，但尚未证明与旧 workflow 专用策略等价 |
| DuraSH 桌面发行版 | 已评估，未实现 | 可复用继承的 Electron 外壳与 Host；产品 profile、私有包闭包、client 身份、数据隔离和独立更新服务仍需接入 |
| DuraSH npm 发行版 | 未准备 | 源码运行已支持；DuraSH 自有包已标记为 private 并从继承的 DSH release family 排除，因此既不宣传 npm 包，也不会被意外发布 |

## 本地验证

2026-10-02 升级候选已完成下列本地检查。跳过的平台用例仍未验证。最终审查报告记录完整文档门禁与保全后的暂存树；未记录部署或发布验收。

| 检查 | 结果 |
| --- | --- |
| 产品构建与浏览器组合 | `build:durash` 通过；品牌、PWA、工作流、策略与全局规则检查共 5 个文件、12 项测试通过 |
| 完整单测套件 | 1,908 个文件通过；39,481 项测试通过、1 项预期失败、239 项跳过；21 个文件跳过 |
| 会话迁移 | 40 个文件、1,210 项聚焦测试通过，包含 V0–V4 旧 workflow 与验收历史 |
| 完整预期输出套件 | 18 个文件、108 项测试通过 |
| 完整无密钥 built 会话回放 | 8 个文件通过；199 项测试通过，本机没有 PowerShell 运行时，2 项真实 PowerShell 用例跳过 |
| 模型发现与推理档位浏览器检查 | Codex、xAI 目录场景及声明式推理检查通过：Chromium 8 项、WebKit 4 项；WebKit 使用任务自有测试运行时 |
| Hygiene 与 lint | 全部 18 项 hygiene 门禁通过；完整 `lint:contracts-ready` 通过 |
| 类型约定 | 当前产品实现的完整 `typecheck` 通过；后续仅同步测试组合与 CI 归属证据 |
| CI 调度条件 | 58 项聚焦测试通过，覆盖 DuraSH、公开上游仓库及继承的内部运行器标识；未触发远端平台作业 |
| 桌面端 | 仅源码评估与继承包的单测；未启动、打包、签名桌面应用，也未实测更新 |

## 当前上游漂移

主源码版本与 vendored snapshot 记录在 [`UPSTREAM_SOURCES.json`](UPSTREAM_SOURCES.json) 中。定时审计报告相对于这些记录的变化。Vendored 包更新必须遵循 [`vendor/README.md`](vendor/README.md) 中的兼容性流程；存在更新的公共包发行版，不代表其源码已经完成整合。

## 融合结论

本次升级候选保留了产品外壳，可靠性引擎**尚未完全融合**。复用当前 DSH workflow 接口与 UI 是正确方向；把旧的约 1.8 万行编排栈直接复制到一个领先一千多个上游提交的新基线上，会重新制造硬分叉，因此明确拒绝。

可靠性引擎的第一个纵向切片已经落地：`@durash/dsh-reliability-loop` 在当前 workflow 生命周期之上维护产品自有的持久循环状态，完成一轮有界审查返工，重启后不重跑已完成尝试即可恢复，取消后收敛，并配有基于真实引擎与真实存储后端的聚焦回归。`durash` profile 上的 composer 工作流开关也已落地：按会话策略、`conversation.input.left` 芯片与 `dsh_reliability_handoff` 会按所选实施/审查模型启动一次闭环。引擎整体仍未迁移：没有成员级持久进度、没有协调或三路审查阶段、已保存的思考强度尚未传给阶段子代理，workflow 引擎自身也依旧没有日志。

## Core-fork 例外

本候选除产品插件外，还保留上游包内的下游修改：

- [全局规则](packages/context/agent-instructions/README.zh.md#editing-global-rules)使用 `core/agent` 与 `core/agent-loop` 保留的 `agent/request-context` 钩子，在请求准入前刷新已保存的 Host 指令。
- [Settings Remote](packages/api/settings-controller/README.zh.md)采用上游 volatile Config 表单，同时保留授权与全局规则编辑。[`serviceForScope`](packages/preset/agent-preset-registry/README.zh.md)通过 `acquireScope` 修订租约解析全局规则服务，并将租约保留到操作结束。
- [pi-ai 发现](packages/llm/llm-pi-ai/README.zh.md)保留经认证的 xAI 与 Codex 目录刷新、离线被动元数据和用户显式采纳；这不代表已成功调用真实提供方模型。
- [旧会话处理](.agents/notes/implemented/architecture/2026-08-30-retain-ignorable-external-session-events.zh.md)仅保留具名的惰性 workflow 记录，不放行任意未知事件，也不改写历史格式。

这些修改只覆盖各自文档与回归约束的行为。上游提供相同行为且对应回归通过后，应移除相应下游差异；它们不扩展旧分叉尚未迁移的工作流能力。
