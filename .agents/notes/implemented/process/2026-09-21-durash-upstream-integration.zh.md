# Agent Note: 整合上游机制并保留 DuraSH 所有权

Status: implemented

[English](2026-09-21-durash-upstream-integration.md) | 中文

## Problem

DuraSH 在持续变化的上游旁维护应用组合、发布保护和生成文档。仅解决文本冲突可能保留过时的启动选项、遗漏私有包，或让可靠性闭环重新依赖已删除的工作流引擎。重复的冲突通知反映整合尚未完成；抑制通知并不会更新产品。

## Decision

先整合上游源码、包 manifest 和启动组合，再重新生成派生目录、依赖记录和双语配对记录。保留仅限源码的 `durash` 模板、客户端构建身份检查和私有包发布保护。上游 profile 语法和 YAML 所有的 HMR 继续作为共享机制；DuraSH 增加自己的产品层，不保留已经退出的启动器选项。

CLI 插件管理使用上游包操作及其共享 profile 写锁。启动器在初始化缺失的 profile 时显式提供安装方拥有的模板；已有 manifest 保留其选定的组合包。另设下游包管理路径会重复实现锁和初始化行为。

DuraSH 覆盖层在 base 提供的 Node PTC 运行时之上启用上游 `workflow-ptc` 条目。可靠性闭环保留其持久阶段所有权，并通过该工作流引擎执行。通用 workflow 和 Ralph 工具在产品组合中继续禁用；启用可靠性引擎不会同时启用这些工具。

[既有冲突分类与去重](2026-09-06-durash-sync-block-reliability-remote-catalog.zh.md)保持不变。绿色的 `blocked-known` 运行表示记录了未变化的冲突，不表示上游已合并或产品检查已通过。新的冲突和非冲突失败继续可见。本整合策略补充[产品覆盖层与发布所有权](../feature/2026-08-30-durash-product-overlay-and-upstream-sync.zh.md)；这些决策继续有效。

`UPSTREAM_SOURCES.json` 在合法 GitHub `sources[]` 条目的 `baseline` 与 `snapshotBaseline` 字段中保留完整提交标识，供机器比较更新。仓库引用检查仅豁免这些精确 JSON 字段；普通文档链接该来源记录。整个 manifest 与普通叙述均不获得豁免。

CI 从 Ubuntu 官方日期快照下载固定校验值的 bubblewrap 包；滚动归档目录会移除被替代的包版本。仓库策略检查保留 DuraSH 的私密安全报告入口，并排除仅适用于上游组织的工作流。浮层观察器检查覆盖面板及其锚点，与已有的尺寸变化处理一致。

## Alternatives considered

**全部冲突统一选择某一侧。** 全选上游会删除下游所有权，全选下游则会保留已删除的 API 并遗漏新的启动行为。必须先协调源码消费者，再重建生成产物。

**把未变化的冲突当作同步成功。** 现有去重已经限制重复通知。产品保持最新仍需要完成合并，并验证最终组合。

**保留已经删除的 worker-thread 引擎或独立插件命令实现。** 两者都会为上游现在拥有的机制建立永久下游副本。适配消费者能在保留产品行为的同时，减少独立维护的实现。

## Consequences

上游机制变化要求同步更新下游消费者，产品身份和私有分发仍保持显式。生成记录描述整合后的源码，不掩盖尚未解决的源码冲突。这些要求不声称本地合并、已准备的 PR 或绿色监控运行能够证明部署服务已是最新。

## Verification

以下文件负责相关检查；此列表记录覆盖责任，不表示本次整合中已成功执行。

- `scripts/upstream-sync-block.spec.ts` 覆盖真实 Git 冲突、未变化与变化的指纹，以及没有未合并路径的合并失败。
- `apps/cli/tests/source-build-profile.spec.ts`、`scripts/check-workspace-constraints.spec.ts` 和 `scripts/release/families.spec.ts` 覆盖仅限源码的模板、客户端构建身份和私有包分发。
- `packages/boot/plugin-manager/tests/operations.spec.ts` 覆盖持锁初始化 profile、显式安装方模板，以及保留已有组合包选择。
- `packages/bundle/durash-web-profile/tests/profile.spec.ts` 覆盖组合后启用 PTC 而不启用通用工作流工具；`packages/reliability/durash-reliability-loop/tests/loop.spec.ts` 负责通过真实 PTC 引擎和受控子提供方验证持久阶段、恢复与取消。
