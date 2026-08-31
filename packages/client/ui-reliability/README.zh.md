---
description: "DuraSH 可靠性界面：精确模型工作流策略、conversation.input.dock 状态条、受鉴权操作与一次终态 Conversation Node。"
kind: "package-reference"
---

# @durash/dsh-client-ui-reliability

[English](README.md) | 中文

## 概述

本包渲染 DuraSH 可靠性控件。`conversation.input.left` 中的**工作流**芯片选择精确实施/审查模型及各模型支持的思考强度。`ReliabilityStatusDock` 以 order `-10` 占据 `conversation.input.dock`，没有当前 view 时不渲染，并在 composer 上方显示持久阶段。详情、取消与关闭通过生成的 loop Remote 受鉴权调用。稳定的 loop-id Conversation Node 只渲染一次终态结果，不显示实时遥测，也不再调用模型。

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

与 conversation、chat、Session、locale、slots 及生成的策略/loop Remote 一起挂载。策略芯片在会话 composer 里始终可见，默认关闭；启用要求两条通道完整，并且只能选择各精确模型公开的档位。只有会话投影存在当前流程时，状态条才渲染。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

进程级控制器缓存每个会话的策略快照。策略芯片在挂载时加载，打开面板时 ensure 实时目录，保留并明确显示失效选择，同时拒绝启用。模型按提供方分组；只有所选模型公开 reasoning 控件时才显示档位菜单。

状态条从活动 Session 的 `reliabilityLoop` 投影读取，覆盖九个阶段、单行目标摘要、polite live region、键盘焦点、reduced-motion，以及优先隐藏摘要而保留操作的窄屏布局。详情按需加载；取消需要二次确认；关闭使用精确可见 revision。终态定义忽略非终态事件，并按 loop id 建立节点。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [可靠性策略](../../reliability/durash-reliability-policy/README.zh.md) — 芯片读写的 Host 行。
- [可靠性交接工具](../../reliability/durash-tool-reliability/README.zh.md) — 开关门控的模型入口。
- [ui-conversation](../ui-conversation/README.zh.md) — 声明输入 slot 与 Conversation Node 引擎。
- [可靠性闭环](../../reliability/durash-reliability-loop/README.zh.md) — 拥有投影状态与受鉴权操作。

-----

<a id="model-experience"></a>
## 模型体验

间接地，通过芯片写入的可靠性策略 Remote：交接工具拥有随启用而来的模型可见指导与 schema。

#### KV Cache 影响

打开或关闭开关会改变交接指导段落是否进入请求前缀；芯片本身不添加提示内容。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **没有 Runs 控制台** — 3081 的侧栏 Runs 历史不属于本开关；诊断留在可靠性闭环记录里。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
