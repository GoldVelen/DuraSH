# Agent Note: 协调 Cordis rc.9 vendored 更新

Status: implemented

[English](2026-09-01-cordis-rc9-vendor-sync.md) | 中文

## 问题

依赖审计发现了四个版本更高的 Cordis 家族发布：Cordis `4.0.0-rc.9`、Loader `1.0.0-rc.6`、Include `1.0.5` 与 Timer `1.1.3`，它们都来自上游提交 `ed8a7755c26a27a72064a21dea036ad1d1d6833c`。如果直接整体替换 vendored 目录，也会删除 `vendor/README.md` 已记录的 Loader、Include、HMR、打包和 rescope 本地修改。

## 决策

将四个包固定到同一个上游提交，并逐项对照现有产品叠加层审查源码变化。本次同步接受支持 symbol 的事件存储与分发、继承属性查找与感知调用方的 service proxy、wrapped fiber 的权威 restart 和 update、正确的日志级别与 exporter 释放、exact optional property 类型修正，以及并发 interval 读取的 FIFO 结算。动态 symbol 事件使用后备 overload，不让上游 symbol index 把已声明的字符串事件返回类型削弱为 `any`。`EventsService.dispatch()` 继续受支持，因为 agent 通知使用它筛选后的 callback 集合来分别隔离失败。插件 callback 失败采用上游的“仅在 update 后恢复”规则；配置解析失败在注入 provider 变化时仍可重试，因为原始表达式属于新的注入 epoch。

所有仍适用的本地修改继续保留。唯一退休的是 Include `writeTask` 的 exact optional property 类型扩宽，因为上游已经包含同一项类型修正。包名、内部 import、发布源码覆盖、Loader 配置惰性解析、Loader 与 Include 的事务行为、Include 持久写入、HMR 防护、entry 插值、Node loader 识别，以及 manifest 中其余条目仍是 DuraSH 持有的差异。

## 验证

`scripts/vendor-cordis-updates.spec.ts` 固定本次接受的事件、fiber、logger、service 调用方与 timer 行为。vendoring manifest、上游源码登记、rescope 文档、rescope 生成器和 lockfile 指向相同的包版本与上游提交。现有 owner tests 继续覆盖保留的 Loader 与 Include 行为。

## 曾考虑的替代方案

- **用发布 tarball 整体替换各目录**：否决，因为这会静默丢弃上游版本尚未包含、但 DuraSH 已登记的行为。
- **保留旧 snapshot，只关闭审计 issue**：否决，因为事件、生命周期、日志、proxy 与 timer 修复都与运行时相关，并且可以在不丢失产品叠加层的前提下接受。
- **只复制发布版本字段**：否决，因为这会宣称一个实际行为并未落地的源码基线。

## 后果

四个包现在共享一个可审计的源码基线，本地修改日志仍保持完整。后续依赖审计可以从该精确提交继续比较，不再重复报告这一组发布。仓库仍需自行审查后续 Cordis 发布的兼容性；版本号相同本身仍不授权替换 vendored 源码。
