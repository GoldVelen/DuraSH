---
description: "DuraSH 叠加在当前 DeepSeek Harness Web profile 之上的增量产品层；供维护者在不分叉上游 UI 包的前提下组合品牌发行版。"
kind: "package-bundle"
---

# @durash/dsh-web-profile

[English](README.md) | 中文

## 概述

本包是应用在当前上游 `dsh-base` 与 `dsh-web-app` bundle 之后的 DuraSH 产品叠加层。它加入产品自有的浏览器品牌插件，并保持上游官方品牌包不变。这样可以缩小后续合并上游时的冲突，并让所有下游自有 row 都集中显示在一个 patch 层中。

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

`cordis.patch.yml` 插入一行 `@durash/dsh-client-ui-brand`。产品层保持增量：只有不存在兼容的上游扩展点时才允许替换上游 row，并且必须先在仓库融合状态文档中记录精确例外。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [DuraSH 浏览器品牌](../../client/ui-brand-durash/README.zh.md)——本 bundle 插入的产品自有槽位填充包。
- [Profile 组合](../../boot/app-boot/README.zh.md#profiles)——启动时采用的有序 bundle 与 patch 语义。
- [融合状态](../../../INTEGRATION_STATUS.md)——产品的已实现、继承与未迁移边界。

-----

<a id="model-experience"></a>
## 模型体验

无，因为本 overlay 只添加浏览器身份，不贡献提示词段落、工具、消息或模型请求字段。

#### KV Cache 影响

无；本包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **只负责品牌与组合**——持久 workflow 可靠性仍是独立的产品插件里程碑，不能从本 profile 推断其已经完成。
- **目前仅支持源码发行**——DuraSH npm 可执行文件与发布 family 尚未设计，也未对外宣传。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

只要上游扩展点能够承载下游 row，就应把它保留在本包中。任何核心包修改都必须在 `INTEGRATION_STATUS.zh.md` 中记录明确例外，包括缺失的扩展点、回归与退出条件。

</details>
