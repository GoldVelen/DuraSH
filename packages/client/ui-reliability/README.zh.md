---
description: "Composer 工作流开关：conversation.input.left 上启用可靠性闭环并选择实施/审查模型的芯片。"
kind: "package-reference"
---

# @durash/dsh-client-ui-reliability

[English](README.md) | 中文

## 概述

本包渲染 composer 上的 **工作流** 开/关芯片。打开后显示下一次工作流的设置：实施模型与思考强度、审查模型与思考强度，目录来自 Host 可靠性策略。芯片占据 `conversation.input.left`，只通过生成的 `reliabilityPolicy` Remote 写入。只组合进 `durash` 客户端 profile。

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

与 conversation 的 input-left 列表以及可靠性策略 Remote 一起挂载。芯片在会话 composer 里始终可见。默认关闭；打开前两条通道都必须点名目录中的模型。

已记录任务的验收状态显示在开关旁，关闭工作流时仍然可见。它分别显示检查通过、独立审查与验收状态，展开后显示未完成原因与测试变化风险。控制器在工具结果和轮次结束后刷新；Host 读取失败时显示未核验。没有验收任务的会话不显示验收标记。读取状态不会调用另一模型。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

进程级控制器缓存每个会话的快照。芯片在挂载时加载，打开面板时 ensure 目录，并拒绝启用不完整的选择。面板通过 body portal 挂载，并借助共享定位 primitive 锚定在 composer 上方；思考强度使用共享的 portaled `Menu`，模型目录拥有自己的 body portal，因此面板滚动区不会裁剪任一选择界面。面板和模型选择器使用共享的突出层级描边，中性控件轮廓使用共享的 0.5px 发丝线，状态圆点保持圆形圆角。模型按提供方分组；只有目录里存在 `cursor` 提供方时才出现 Cursor 通道切换。

本包不发布运行时 invariant companion，因为 Host 策略服务拥有权威状态；该浏览器投影没有独立的持久事件流或第二状态源。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [可靠性策略](../../reliability/durash-reliability-policy/README.zh.md) — 芯片读写的 Host 行。
- [可靠性交接工具](../../reliability/durash-tool-reliability/README.zh.md) — 开关门控的模型入口。
- [ui-conversation](../ui-conversation/README.zh.md) — 声明 `conversation.input.left`。

-----

<a id="model-experience"></a>
## 模型体验

间接地，通过芯片写入的可靠性策略 Remote：交接工具拥有随启用而来的模型可见指导与 schema。

#### KV Cache 影响

打开或关闭开关会改变交接指导段落是否进入请求前缀；芯片本身不添加提示内容。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **没有 Runs 控制台** — 3081 的侧栏 Runs 历史不属于本开关；诊断留在可靠性闭环记录里。
- **思考强度只记录、不生效** — 面板会记下思考强度，当前 workflow 引擎还不会把它传给阶段子代理。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

源码插件测试在 import 处替换生成的 `/remote` 描述符，并通过测试载体验证挂载和卸载。描述符属于 Host 构建产物；这些测试不验证生成的传输编解码器。

</details>
