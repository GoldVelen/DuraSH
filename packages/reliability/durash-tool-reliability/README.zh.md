---
description: "面向模型的可靠性闭环交接工具，由会话级 composer 工作流开关门控。"
kind: "package-reference"
---

# @durash/dsh-tool-reliability

[English](README.md) | 中文

## 概述

`dsh-tool-reliability` 注册 `dsh_reliability_handoff`。工具在进程内始终存在，但除非本会话的 composer 开关打开，否则会闭门失败。启用后，它用该会话的精确实施与审查通道持久创建一次可靠性闭环，并立即返回持久接管回执；Host 在后台继续实施与审查。

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

在 `durash` profile 中与 `ctx.reliabilityPolicy`、`ctx.reliabilityLoopRuntime` 一起组合。指导段落只为策略已启用的根代理组装。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

工具要求处在活动驱动中的精确存活根 Agent，并验证当前开放回合由直接人类输入发起。它修剪并校验目标，依据实时模型目录重新校验两条策略通道，调用 `startDetached()`，返回 `{ loopId, revision, status: 'accepted' }`。工具信号、回合结束、浏览器断开与外层代码运行超时都不会取消闭环。进度来自会话状态投影；取消是显式且受鉴权的 Remote 操作。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [可靠性策略](../durash-reliability-policy/README.zh.md) — 门控本工具的开关 Host 真值。
- [可靠性闭环](../durash-reliability-loop/README.zh.md) — 本工具启动的引擎。
- [工具目录](../../../docs/tool-catalog.zh.md) — `dsh_reliability_handoff` 的生成 schema。

-----

<a id="model-experience"></a>
## 模型体验

### 请求上下文与条件

#### 模型看到什么

`tool:reliability-handoff` 系统提示段落只为策略已启用的根代理组装。未启用的会话没有该段落。

##### 可靠性交接指导

```markdown
For this Session the reliability workflow is enabled. Analyze the direct human request, present a concise implementation plan in the same Step, then call dsh_reliability_handoff once with the complete objective. The call returns a durable acceptance receipt; implementation and review continue under Host ownership after this model turn ends. Do not poll, repeat the handoff, or narrate live telemetry. The composer status bar shows progress and the conversation receives one persistent terminal result. Ordinary questions and read-only review stay on this Session and do not hand off.
```

#### Token 影响

有条件：仅当会话策略启用时才有该段落。

#### KV Cache 影响

打开或关闭 composer 开关会把该段落加入或移出请求前缀。

### 工具 schema

#### 模型看到什么

生成的[工具目录](../../../docs/tool-catalog.zh.md#durashdsh-tool-reliability)拥有 `dsh_reliability_handoff` schema。本包的描述要求模型先给出计划，再带着完整目标调用。模型会看到 `dsh_reliability_handoff` 的目录条目。

#### Token 影响

工具 schema 始终注册；点名它的指导段落按上文有条件出现。

#### KV Cache 影响

schema 成员关系是进程级的；只有指导段落随会话策略移动。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **没有首轮 intake 字段检查** — 3081 时代要求可见计划里出现字段标签，这里不再强制；指导要求给出计划，Host 只证明存活的根人类回合。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
