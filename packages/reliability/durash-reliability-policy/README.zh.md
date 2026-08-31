---
description: "按会话保存的可靠性闭环策略：依据 Host 实时目录校验精确实施/审查模型与 adapter 自有思考强度。"
kind: "package-reference"
---

# @durash/dsh-reliability-policy

[English](README.md) | 中文

## 概述

`dsh-reliability-policy` 是 composer 工作流开关背后的 Host 服务。每个会话一行持久记录保存启用状态、精确实施/审查模型及各自的思考强度。策略面板读取会通过 `ctx.llm.listModels()` 与 `resolveModelInfo()` 并行重建各提供方和模型目录，因此每个模型只公开 adapter 声明的档位 id、名称、说明与默认值。目录漂移会保留原记录并返回具体 `validationError`；无效记录不能启用或启动闭环，也不会被静默降档。

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

与 `ctx.storageDomain` 和 `ctx.llm` 一起挂载。composer 开关通过生成的 Remote 调用 `policy`、`ensurePolicy` 和 `configure`。`workflowEnabled(sessionId)` 是同步提示门禁；异步 `enabledRoutes(sessionId)` 只重新校验已选择的 provider/model 路由，并为交接工具返回不可变的 provider/model/reasoning-effort 通道快照。因此一次交接不会等待无关提供方或模型。

启用要求两条通道都点名当前目录模型。有 reasoning 控件的模型必须选择目录中的档位；没有此控件的模型必须保存 `null`。失效的既有选择器或档位会继续显示以便修正，但会阻止启动。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

`reliability_policy` storage domain 以会话 id 为键保存 `sessions` 表中的一行。目录成员关系与显示元数据不落盘。变更按会话排队。选择器是 `provider/model` 字符串，在第一个斜杠处切开；档位 id 是不透明的 adapter 自有值。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [可靠性闭环](../durash-reliability-loop/README.zh.md) — 启用策略后启动的引擎。
- [可靠性交接工具](../durash-tool-reliability/README.zh.md) — 受本策略门控的模型交接入口。
- [Composer 开关](../../client/ui-reliability/README.zh.md) — 写入本策略的 Web 芯片。

-----

<a id="model-experience"></a>
## 模型体验

间接地，通过可靠性交接工具：本包保存启用状态与通道选择器；提示段落与 schema 由工具拥有。

#### KV Cache 影响

打开或关闭策略会改变交接指导段落是否进入请求前缀。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **没有实时目录事件** — 客户端在打开时重读；面板打开期间新增的提供方要等到下一次 ensure 才出现。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
