---
description: "settings 与凭据配置界面的 Host Remote owner，涵盖脱敏读取、写入、凭据引用与原生文档打开。"
kind: "package-reference"
---
# Settings Controller

[English](README.md) | 中文

## 概述

`@deepseek-ai/dsh-api-settings-controller` 为浏览器配置面暴露生成的 `ctx.remote.settings`、`ctx.remote.credentials` 与 `ctx.remote.authorization` 命名空间。它返回脱敏的 settings 与凭据元数据，支持 settings 与凭据写入而不返回密钥值，并在 Host 桌面打开由 provider 持有的 settings 或 Agent preset 位置。provider 缺失时，namespace 仍会注册，并返回可操作的配置错误。

## 目录

- [使用本包](#use-this-package)
- [配置](#configuration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

请把本包作为 Loader entry 挂载到提供浏览器配置的 profile 中。本 entry 不依赖 provider 是否存在而注册两个 namespace，因此缺少 provider 会在调用时产生具名配置错误。它生成的 descriptor 进入严格 Typert registry，而 settings 与凭据 Definition 仍是普通 Cordis Service，自身不承担任何 wire 义务。

`describe(refs)` 以请求的名字为键返回一份 map，因此设置页描述其各行携带的全部引用时，这些行会一起落定。单次调用最多接受 64 个名字，无效名字或空写入值报告为 `bad-request`，并逐字段复制每个答案——provider 返回超出 `CredentialInfo` 声明的内容也无法扩大跨越 wire 的字段。有效的 `set(ref, value)` 与 `unset(ref)` 调用把 provider 拒绝报告为 `credential-rejected`，携带 provider 的消息，details 中只有该引用。密钥值只在这个方向跨越 wire：这里没有任何方法会返回它。

`settings.describe()` 返回部署信息，以及在 `redactSecrets: true` 下读取的所有 namespace。`settings.update`、`settings.replace` 与 `settings.mutate` 暴露 settings service 的三种写入操作，并返回该 namespace 的新脱敏视图；过期写入使用 `settings-conflict`，其他 provider 拒绝使用 `settings-rejected`。

`authorization.describe()` 列出每个已注册的登录流与其被宿主跟踪的尝试，页面轮询一份快照即可同时得到可登录项与尝试进度。登录流没有被跟踪的尝试时，已有且已配置的凭据会被投影为 `authorized`；当前被跟踪的尝试优先。`authorization.begin({ key, method? })` 以宿主持有的交互启动一次尝试并立即应答——尝试会等一个人几分钟，因此没有任何请求保持挂起；`authorization.respond({ key, promptId, value | declined })` 回答待答提问，`authorization.cancel({ key })` 撤回尝试。通知按保留上限累积，同一时刻只有一个待答提问，密钥回答只朝这个方向传输。尝试状态属于宿主：重新加载的页面通过 `describe` 重新加入同一尝试；已有尝试运行时再次 begin 报 `conflict`。失败视图只说明控制器是否已收到通知或提问，或者凭据提交是否失败；外层消息会脱敏 token，嵌套传输错误只能附带有上限的白名单网络元数据。


-----

<a id="configuration"></a>
## 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `nativeOpen` | 平台探测 | Agent preset 目录能否交给原生桌面打开器 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-api-settings-controller)是所有受支持字段及其 JSDoc 的完整来源。

-----

<a id="model-experience"></a>
## 模型体验

无，因为 settings 与凭据配置属于浏览器和 Host 状态，并且不注册提示词、工具或会话事件。

#### KV Cache 影响

无直接影响；读取或写入这些配置值不会改变已经在途的模型请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 批量上限固定为 64 个引用，不是可按部署配置的字段。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。settings 与 credential seam 负责存储和更新事件，本包只把它们的方法投影到 wire。
