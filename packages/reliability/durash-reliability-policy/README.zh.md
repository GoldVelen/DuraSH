---
description: "按会话保存的可靠性闭环策略：composer 工作流开关在 Host 上的启用状态与实施/审查模型选择。"
kind: "package-reference"
---

# @durash/dsh-reliability-policy

[English](README.md) | 中文

## 概述

`dsh-reliability-policy` 是 composer 工作流开关背后的 Host 服务。每个会话一行持久记录保存闭环是否开启，以及下一次交接将使用的实施模型与审查模型。每次读取都从 `ctx.llm` 重建模型目录，因此已离开目录的路由不能保持启用。本服务只组合进 `durash` profile。

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

与 `ctx.storageDomain` 和 `ctx.llm` 一起挂载。composer 开关通过生成的 Remote 调用 `policy`、`ensurePolicy` 和 `configure`。`workflowEnabled(sessionId)` 与 `enabledRoutes(sessionId)` 供同进程的模型交接工具读取。

启用一个会话要求两条通道都点名目录中的模型。缺失或无效的选择器不能保持启用：下一次读取会把该行关掉。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

`reliability_policy` storage domain 以会话 id 为键保存 `sessions` 表中的一行。目录成员关系不落盘。变更按会话排队。选择器是 `provider/model` 字符串，在第一个斜杠处切开。

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

- **思考强度只记录、不生效** — 开关会记下实施与审查的思考强度；worker-thread 引擎仍推迟 `agent()` 的 `effort`，阶段子代理继承父代理的推理设置。
- **没有实时目录事件** — 客户端在打开时重读；面板打开期间新增的提供方要等到下一次 ensure 才出现。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
