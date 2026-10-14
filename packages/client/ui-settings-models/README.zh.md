---
description: "dsh Web 客户端的模型设置与产品引导插件：提供方行、API 密钥管理、模型列表与 DeepSeek 首次运行弹窗。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-models

[English](README.md) | 中文

## 概述

在模型页面配置提供方 API 密钥、登录订阅账号、跟随账号模型名单、保存模型定制，或声明自定义 pi-ai 路由。API 密钥始终只写，不会回显。每个提供方有独立编辑卡片，共享的设置与凭据状态让模型行在重新加载后保持最新。首次运行弹窗展示内部测试声明，并仅在没有可用提供方时询问官方 DeepSeek 密钥。

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

从设置导航打开 Models 页面，即可看到每个已配置的提供方都有一行。其配置键未在任何位置配置的整分节提供方会渲染为其展开的设置卡片而非一行，但仅限首次运行姿态，且仅持续到用户关闭该卡片为止。每一类卡片各自持有自己的展开状态，因此关掉其中一张绝不会丢弃另一张里的草稿。

存在已存储目录错误的提供方仍显示诊断以及编辑、删除入口。添加操作只面向已注册的 settings 命名空间，因此不可用的命名空间不会留下无法打开编辑器的按钮。保存被拒绝时，编辑器保持打开并展示 Host 诊断。

### API 密钥

Host 提供 OAuth 登录流程且未配置 API 密钥引用的路由，通过账号认证发送模型请求和同步模型。编辑器仅在明确点击「改用 API 密钥」后才挂载密码输入框。「使用账号登录」立即通过带版本校验的 settings 修改移除用户层 `apiKeyEnv`，保留凭据、已保存的模型与端点，以及卡片中其他未保存的编辑。部署配置中的引用会阻止该切换并显示原因。未配置密钥引用且登录能力尚未确定时，也只有明确选择 API 密钥才挂载密码输入框。API 密钥编辑器只显示一个只写的 **API 密钥**输入框，从不询问环境变量名。键入的密钥经 `credentials.set` 以**只写**方式存入 profile 的引用之下，profile 没有引用时便派生 `<ROUTE>_API_KEY`，pi-ai profile 会把这次派生记录为 `apiKeyEnv`，因此 `settings.yaml` 从不携带密钥值。为新的 pi-ai 提供方留空密钥会保存一个不带引用的 profile，从而保留提供方原生认证（例如 Bedrock 凭据链或 Vertex ADC）。只有确认引用的凭据已配置时，行才会以绿色实心点标示 API 密钥状态；只有确认具名引用缺失时，才会以红色实心点标示。「应用」成功后会发出本地无障碍状态消息，且绝不回显任何机密内容。

### 编辑提供方

收起的「自定义设置」折叠区承载精选的额外字段：两个家族都有 `baseURL`（deepseek 的占位符显示公共端点）、各适配器自己的模型目录，以及适配器未提供的 pi-ai 路由的**显示名称**与 **API 协议**。Profile `headers` 仍是 `settings.yaml` 或 Cordis 配置中的部署配置，Models 页面不提供编辑器。Provider ID 保持固定：它是 settings 的键、其他每个 namespace 与每一条已记录会话引用的名字，也是页面读不回、因而搬不走的凭据引用词干。推理等级刻意不在可编辑字段之列：它是按模型的能力，提供方级的控件只可能被设成某些模型会拒绝的值。每个模型行可编辑 `id`、可选显示 `name`、可选 `contextWindow`/`maxTokens` 和输入类型；无关的模型字段在编辑后仍会保留。

`llm-deepseek` 的 DeepSeek 卡片编辑共用的端点、凭据和模型目录，不提供协议选择器。Cordis YAML 选择 Messages 时，官方端点占位符为 `https://api.deepseek.com/anthropic`；保存卡片不会改写协议配置。

展开**自定义设置 → 模型选项**编辑模型。两个提供方家族共用相同布局：上下文窗口与最大输出 token 数分为两列，**输入类型**提供**文本**与**图片**。未声明的输入列表依次继承 Host 当前模型元数据、提供方默认值，再回退为文本。打开编辑器只读取这些元数据，不自行请求端点。显式勾选会覆盖继承，且至少保留一种类型。DeepSeek 写入 `inputModalities`，pi-ai 写入 `input`。DeepSeek 取消勾选图片时还会移除 `imagePixelBudget` 与 `imageMaxBytes`。清除输入字段可恢复继承；**恢复默认值**移除已保存的模型定制。仅声明上游模型支持的输入类型。

提供账号目录的提供方会显示**跟随账号模型列表**。启用后，新账号模型自动进入对话选择器，已保存行只定制对应 id。没有定制行时仍跟随账号目录。关闭后，显式保存的模型列表成为可选名单。「应用」保存模式并保留模型行的调参。适配器负责[目录同步与失败处理](../../llm/llm-pi-ai/README.zh.md#synchronize-account-model-directories)。

### 新增与删除提供方

添加卡片可选择可用提供方，或用唯一的 **Provider ID**、HTTP(S) 端点、协议和至少一个唯一模型 id 声明自定义 pi-ai 路由。localhost、IPv4、IPv6 与自定义端口仍然有效。语法错误会在字段处阻止发现与创建；请求失败仍作为提供方诊断显示。**获取可用模型**刷新显示的来源并打开可搜索候选。刷新已保存的账号来源还会更新运行时目录，无需点击应用；未保存的端点、协议或密钥探测不能替换它。**添加所选**编辑草稿，点击应用或创建后才保存条目。再次采纳已有行时会保留调参。搜索匹配 id 与显示名称，且不清空隐藏勾选；**全选**选择可见结果，**取消全选**清空全部勾选。刷新失败会保留草稿。仅用户层拥有 profile 的提供方可删除，确认框会指名该提供方。

### 账号登录

**账号登录**区域列出宿主中带 OAuth 方法的每个登录流——ChatGPT Plus/Pro、Grok/X、Claude Pro/Max，以及 pi-ai 适配器注册的其他订阅登录。仅 API 密钥的目录项留在添加表单里。**登录**在宿主侧启动尝试，区域渲染其进度：要打开的页面、要输入的设备码，以及每次尝试的待答提问，可就地作答或跳过；**取消登录**撤回尝试。每个流程独立保存答案，并在提问变化或结束时清空。尝试状态存于宿主，重新加载页面会重新加入正在进行的尝试；已结束的尝试保持可见，直到下一次开始。此前未配置的提供方登录成功后，本页启用空白原生认证 profile 并打开其目录编辑器。Host 刷新账号元数据；已有 profile 保留模型模式与定制。没有 OAuth 登录流时此区域不渲染，包括未挂载 authorization 服务的组合。Client 通过 `ctx.inject` 绑定该命名空间，因此从未挂载它的 fixture 仍能加载本页；未注入的 `ctx.remote.authorization` 访问器在命名空间已经存在时也会抛错。

Host 声明两种方法时，OpenCode Go 优先提供**浏览器登录**，并提供**改用 API 密钥**作为备选。API 密钥备选使用同一个只写密码提问。授权成功后启用 `opencode-go` 原生 profile，不创建 OpenCode Zen 路由。该行链接到 [OpenCode Console](https://opencode.ai/console/)，并说明开启 **Use balance** 后，超出订阅额度的使用可能消耗余额。页面不修改计费设置。

### 首次运行弹窗

版本化声明步骤完成后，DeepSeek 步骤从同一份合并快照投影首次运行就绪状态。用户已经能够到达的**任何**提供方都会直接结束该步骤、不做渲染；只有没有任何提供方的用户才会被询问官方 DeepSeek 密钥。「稍后配置」只完成这次协调器遍历；适配器缺失、路由不活动、合并失败、只读部署或能力不可用时，该步骤不渲染即完成——Models 仍是诊断界面。

### 扩展 slot

本分区为仓库外分发的插件声明两个席位，类型定义在 [`src/client/slot-contract.ts`](src/client/slot-contract.ts) 并从 `./client` 导出。`settings.models.provider-card`（keyed）渲染在每张展示目录行的卡片内部——已保存行的卡片、其首次运行 setup 形态、以及「添加提供方」草稿卡——以 `entryKey = settingsNs` 分发，owner props 携带该行的 `ConfigurableProviderView`、其 configured 状态与已确认的 api-key 凭据状态，因此以某适配器家族的 namespace 注册一次即可收到该家族的全部卡片，含手工声明的路由；手工声明的草稿卡尚无目录行，保存之前不分发。`settings.models.footer`（list）渲染在行列表与新增控件之后。注册方通过 `ctx.slots.inject` 激活，并以 type-only import 引入本包 `/client` 入口；没有注册方时两个席位均不渲染任何内容。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

页面只持有脱敏后的描述符，从不持有完整设置分区：因此每次编辑都以 `settings.mutate` 路径操作落到已存分区上——每个改动字段一次 set、每个清除字段一次 unset、删除提供方行则一次 unset。

### 校验

键入的 API 密钥按其自身字段判定：去除首尾空白后必须非空，且每个字符都必须是可打印 ASCII（`[\x21-\x7E]`），这正是 HTTP 头值能够携带的字符集——与 `@deepseek-ai/dsh-llm` 中的 `normalizeApiKey` 互为镜像，此处复刻是因为源平面拆分禁止导入它。与粘贴的 `NAME=value` 环境行一致或包裹在匹配引号内的值，会作为同样的格式失败被拒绝。空 id、重复 id、空显式名称以及不可读、非正数或小数的容量都会在任何写入之前失败。DeepSeek 的 `models` 是一个按值整体替换的数组：编辑器先显示继承的有效行，直到第一次模型编辑把完整数组物化进用户层，重置则取消该覆盖。

### 并发与凭据

每次 settings 写入都携带卡片当前的 `revision`，因此来自另一个标签页或外部 `settings.yaml` 编辑的并发写入会以 `settings/conflict` 被拒绝。settings 提交后，卡片会在存储凭据前采纳返回的脱敏用户子树与 revision，因此失败的凭据阶段只重试该阶段。删除只会在 profile 指名本页派生的 `<ROUTE>_API_KEY` 目标时移除已配置且可写的凭据，然后 unset 该 profile；两个操作都幂等。加载完成后，页面订阅转发的 `settings/document-updated`、`credentials/reference-updated` 与 `llm/adapters-updated` 属主事件，以及本地 `connection/reset`，因此外部编辑无需轮询即可收敛。

### 引导协调器

声明步骤在 `src/client/locales.ts` 中持有精确文案，并在 `src/onboarding-copy.ts` 中持有确认版本；回环时它通过既有 settings API 比较并写入 `ui-onboarding.welcomeNoticeVersion`，且只有显式点击「继续」才会记录当前版本。非回环浏览器无法使用这个仅限宿主的 namespace，因此确认只保留在进程内，刷新后声明会再次出现。DeepSeek 步骤面向 `llm-deepseek` 中的 `deepseek-official`，在共享引导模态框内以仅凭据模式渲染既有 `ProviderEditor`；`credentials.set` 仍是唯一的机密写入，且不改变任何提供方设置。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

以下页面覆盖设置底座、本页所合并的 seam 与设计依据。

- [ui-settings](../ui-settings/README.zh.md)——本页所依赖 scope 与 schema 服务所在的领域底座。
- [settings](../../settings/README.zh.md)——持久化用户设置 seam 及其文件提供方。
- [credentials](../../credentials/README.zh.md)——本页写入密钥所经的凭据引用 seam。
- [llm](../../llm/README.zh.md)——本页所配置提供方所在的适配器注册表。
- [Web 配置平面](../../../.agents/notes/archived/architecture/2026-07-30-web-config-plane.md)——手写编辑器的设计依据。

-----

<a id="model-experience"></a>
## 模型体验

无。该包是浏览器端 UI 插件层，不注册任何面向模型的内容。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制定义编辑器的字段覆盖范围与本页的触达范围；它们是当前包约束，不是设置路线图。

- **卡片上只有 API 密钥与精选折叠字段可编辑**：手写编辑器以 schema 通用字段覆盖换取了 mockup 布局。重试策略、超时、DeepSeek 模型说明及其他进阶字段仍留在 `settings.yaml` 中；编辑器未展示的现有模型字段会予以保留。
- **凭据清理范围刻意保持狭窄**：删除一行时，仅当其引用与页面派生的 `<ROUTE>_API_KEY` 目标完全一致，才会清除已配置且可写的凭据。自定义引用、环境凭据与无法识别的目标会保留，因为该行无法证明自己拥有它们。
- **只有 pi-ai 路由可以手工声明**：自定义提供方卡片写入 `llm-pi-ai`——唯一一个其 profile 描述整个提供方的 namespace。`llm-deepseek` 路由是组合面的事实，不是本页能创建的东西。
- **端点发现受协议限制**——自定义探测支持 OpenAI 兼容与 Anthropic Messages 列表；Codex、xAI 与 OpenCode Go 使用适配器负责的账号目录。其他协议保留已安装元数据，或需要手工填写模型。
- **未声明的存活路由无处渲染**：未附带可配置提供方声明即注册的路由没有 settings 地址；它在各选择器中仍然可见，但不会出现在本页的行里。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变量：** 不发布 companion。本包展示 Host 拥有的设置、凭据与授权状态，不拥有独立的持久化关系。
