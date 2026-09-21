---
description: "面向模型的验收证据工具，以及受策略门控的可靠性闭环交接工具。"
kind: "package-reference"
---

# @durash/dsh-tool-reliability

[English](README.md) | 中文

## 概述

`dsh-tool-reliability` 注册直接验收证据工具 `dsh_acceptance` 和工作流交接工具 `dsh_reliability_handoff`。交接工具在进程内始终存在，但除非本会话的 composer 开关打开，否则会闭门失败。启用后，它用该会话的实施与审查路由启动一次可靠性闭环，并等待终态记录。

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

在 `durash` profile 中与 `ctx.reliabilityPolicy`、`ctx.reliabilityLoopRuntime` 一起组合。交接指导只为策略已启用的根代理组装；证据指导始终可用。

-----

### 直接证据与工作流模式

工作流开关关闭时，请当前模型使用 `dsh_acceptance` 的 `plan` 声明必需检查，以 `run` 执行，再用 `status` 查看。它保留当前模型，包括 Grok，不发起独立模型调用。即使助手文字不同，输入区仍显示宿主检查状态和“未独立审查”。普通问答不需要计划。

工作流开关开启时，选择实施和审查模型，声明同样的任务要求，然后使用 `dsh_reliability_handoff`。它自动绑定活动验收任务。即使模型批准，只要检查或候选、目标身份不符，宿主仍拒绝完成。[运行时参考](../durash-reliability-loop/README.zh.md#task-acceptance-evidence)负责说明收据语义与限制。

使用带 `taskId`、`checkId` 的 `status` 查看检查的已保存定义与原始收据。根会话拥有计划修订权；只有所属根会话及其活动后代能执行或读取任务。变化后的宿主状态会在下一次模型请求前进入已记录的插件上下文。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

交接工具要求存活的根代理、该会话上的直接人类用户消息，以及已启用的策略路由。取消工具信号会取消存活闭环。压缩结果是闭环终态、有界摘要，以及存在时的审查裁决。

本工具不发布运行时 invariant companion，因为它不拥有独立状态或事件流；策略与闭环 companion 负责它所消费的关系。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [可靠性策略](../durash-reliability-policy/README.zh.md) — 门控本工具的开关 Host 真值。
- [可靠性闭环](../durash-reliability-loop/README.zh.md) — 本工具启动的引擎。
- [DuraSH 工具目录](../../../docs/durash-tool-catalog.zh.md) — `dsh_reliability_handoff` 的生成 schema。

-----

<a id="model-experience"></a>
## 模型体验

### 请求上下文与条件

#### 模型看到什么

`tool:reliability-handoff` 系统提示段落只为策略已启用的根代理组装。未启用的会话没有该段落。

##### 可靠性交接指导

```markdown
For this Session the reliability loop is enabled. This tool is the only implementer dispatch path. Never write an execution prompt or copy-paste brief for the human to give to another model or agent. Analyze the human request, present a concise implementation plan in the same Step, then call dsh_reliability_handoff with the complete objective. Ordinary questions and read-only review stay on this Session and do not hand off. The call remains in the current model turn until the loop is completed, blocked, cancelled, or failed; after its compact result arrives, explain that result to the human. If the workflow is disabled, the tool fails closed.
```

#### Token 影响

有条件：仅当会话策略启用时才有该段落。

#### KV Cache 影响

打开或关闭 composer 开关会把该段落加入或移出请求前缀。

### 工具 schema

#### 模型看到什么

生成的[DuraSH 工具目录](../../../docs/durash-tool-catalog.zh.md#durashdsh-tool-reliability)拥有 `dsh_reliability_handoff` schema。本包的描述要求模型先给出计划，再带着完整目标调用。模型会看到 `dsh_reliability_handoff` 的目录条目。

#### Token 影响

工具 schema 始终注册；点名它的指导段落按上文有条件出现。

#### KV Cache 影响

schema 成员关系是进程级的；只有指导段落随会话策略移动。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **没有首轮 intake 字段检查** — 3081 时代要求可见计划里出现字段标签，这里不再强制；指导要求给出计划，Host 只证明存活的根人类回合。
- **思考强度不会传给子代理** — 通道模型会传；思考强度留在策略行上，直到 workflow 引擎支持 `effort`。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
