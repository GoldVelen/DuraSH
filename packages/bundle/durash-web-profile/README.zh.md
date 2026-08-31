---
description: "DuraSH 叠加在当前 DeepSeek Harness Web profile 之上的增量产品层；供维护者在不分叉上游 UI 包的前提下组合品牌发行版。"
kind: "package-bundle"
---

# @durash/dsh-web-profile

[English](README.md) | 中文

## 概述

本包是应用在当前上游 `dsh-base` 与 `dsh-web-app` bundle 之后的 DuraSH 产品叠加层。它加入产品自有的浏览器品牌插件、可靠性循环运行时、按会话工作流策略、受门控的交接工具与 composer 工作流开关，并重新启用上游 workflow 引擎 row（web app 默认关闭该行），使闭环可以驱动其阶段 run。上游官方品牌包与保持关闭的 `workflow`/`ralph` 工具不变。这样可以缩小后续合并上游时的冲突，并让所有下游自有 row 都集中显示在一个 patch 层中。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

先运行 `pnpm run build:durash` 构建客户端，再以 `pnpm dsh --profile durash` 启动源码 checkout。随仓库提供的 profile 会按顺序应用 `@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app` 与本包。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

`cordis.patch.yml` 插入 DuraSH 品牌行、可靠性循环运行时、按会话策略、受门控的交接工具与 composer 工作流开关。产品层保持增量：只有不存在兼容的上游扩展点时才允许替换上游 row，并且必须先在仓库融合状态文档中记录精确例外。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [DuraSH 浏览器品牌](../../client/ui-brand-durash/README.zh.md)——本 bundle 插入的产品自有槽位填充包。
- [DuraSH 可靠性闭环](../../reliability/durash-reliability-loop/README.zh.md)——本 bundle 组合进 `durash` profile 的宿主侧可靠性运行时。
- [Composer 工作流开关](../../client/ui-reliability/README.zh.md)——composer 上的开/关芯片。
- [Profile 组合](../../boot/app-boot/README.zh.md#profiles)——启动时采用的有序 bundle 与 patch 语义。
- [融合状态](../../../INTEGRATION_STATUS.md)——产品的已实现、继承与未迁移边界。

-----

<a id="model-experience"></a>
## 模型体验

间接地，通过本 overlay 挂载的可靠性交接工具与 composer 开关；模型可见的指导与 schema 由那些包拥有。

#### KV Cache 影响

打开 composer 开关会把交接指导段落加入请求前缀；本 overlay 本身不添加提示内容。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **思考强度只记录、不生效** — 开关会记下通道思考强度；当前 workflow 引擎不会把 `effort` 传给阶段子代理。
- **目前仅支持源码发行**——DuraSH npm 可执行文件与发布 family 尚未设计，也未对外宣传。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

只要上游扩展点能够承载下游 row，就应把它保留在本包中。任何核心包修改都必须在 `INTEGRATION_STATUS.zh.md` 中记录明确例外，包括缺失的扩展点、回归与退出条件。

</details>
