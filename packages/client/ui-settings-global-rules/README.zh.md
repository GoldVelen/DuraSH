---
description: "管理 Host 全局 AGENTS.md 指令文件的设置页面。"
kind: "package-reference"
---

# @durash/dsh-client-ui-settings-global-rules

[English](README.md) | 中文

## 概述

在设置 → 全局规则中编辑跨项目指令，无需打开文件管理器。编辑器显示所连接 Host 上的现有文件，并拒绝基于过期内容的保存。保存后的文件可供后续请求使用；页面会区分保存状态与某次请求已经加载规则的证据。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

此浏览器插件通过现有 `settings.section` 插槽增加 **设置 → 全局规则**。它通过 `remote.settings` 读写所连接 Host 配置的全局指令文件；[agent-instructions 服务](../../context/agent-instructions/README.zh.md)负责路径解析、原子写入、冲突检查和请求刷新。浏览器只保留当前编辑器草稿，不持久化第二份规则正文。

页面显示文件原有正文和实际 Host 路径。文件不存在时，首次保存才会创建。保存保留提交的文本，并携带开始编辑时读到的版本。外部并发编辑会使保存被拒绝，草稿仍被保留；用户可以复制所需修改后明确选择重新读取文件。读写失败会持续显示，保存进行期间编辑器被禁用。

写入成功只显示已保存，不声称已应用。页面说明后续请求核对指令的时机，并指向会话指令注入记录以核对请求证据。指令插件缺失、加载禁用、单文件或上下文预算限制都会明确提示。项目指令优先级仍由指令插件管理。

<a id="model-experience"></a>
## 模型体验

无直接影响，浏览器编辑器将所有模型可见指令内容和刷新交给 Host 指令插件。

#### KV 缓存影响

编辑器不直接改变提供方请求。后续指令替换对缓存的影响由指令插件文档说明。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- 页面报告文件保存状态和加载限制，不报告逐次请求的应用状态。草稿仅在页面挂载期间保留，刷新或关闭页面会丢弃未保存修改。本包不提炼自动记忆，也不持续监听外部文件编辑；版本检查会阻止过期保存。

**运行时不变量：** 不发布配套检查器。页面不拥有独立的跨插件运行时关系；Host 指令服务负责文件一致性，插槽释放和编辑器行为由直接测试覆盖。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
