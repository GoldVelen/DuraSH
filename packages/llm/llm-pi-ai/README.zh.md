---
description: "通过 pi-ai 发送多提供方模型请求、同步账号模型目录、使用 OAuth 登录，并配置手工声明的网关。"
kind: "package-reference"
---

# @deepseek-ai/dsh-llm-pi-ai

[English](README.md) | 中文

## 概述

`@deepseek-ai/dsh-llm-pi-ai` 把模型请求路由到多个提供方、OpenAI 兼容网关或自托管服务器。已安装的 pi-ai 元数据提供初始默认值；ChatGPT/Codex、OpenCode Go 与 xAI 的账号目录会自动刷新模型元数据。配置中的模型列表既可限制可选模型，也可只定制对应账号模型，同时接纳新的模型 id。profile 与凭据按请求解析，配置变更无需重启即可生效。受支持的登录流程会存储 OAuth 或交互式密钥凭据，并通过跨进程锁刷新。

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

当组合需要通过 pi-ai 提供方目录或其已安装目录未描述的网关发送模型请求时，挂载本插件。`providers` 的每个键都是请求通过 `GenerateOptions.provider` 选择的路由；根级计时字段控制原生目录同步。

### 何时选择

当同一组合服务多个提供方、某条路由需要 pi-ai 目录默认值并修正少数字段、或必须通过自有端点与协议到达手工声明网关时，选择本适配器。当部署不需要其他提供方时，选择 `dsh-llm-deepseek` 直连 DeepSeek 路由。两个适配器可以同时挂载，因为它们的路由名不冲突；注册其他适配器已拥有的路由会导致插件加载失败。

### 配置提供方路由

每个 profile 都可以设置 `retryPolicy`；省略时使用 normal mode、最多重试五次。`apiKeyEnv` 是按请求经 harness 凭据 seam 解析的凭据引用，因此配置文件绝不包含密钥；解析为空的引用会让请求以 `MISSING_CREDENTIAL` 失败。省略它会让路由保持已配置但无密钥（configured-but-keyless）状态，对已安装目录路由而言即交由 pi-ai 提供方原生的环境发现。

```yaml
- name: '@deepseek-ai/dsh-llm-pi-ai'
  config:
    providers:
      openai:
        apiKeyEnv: OPENAI_API_KEY
        baseURL: https://proxy.example.com:8443
        reasoning: high
        requestImagePixelBudget: 4194304 # total pixels; 2048 by 2048 default
        requestImageMaxBytes: 1048576    # raw bytes before base64 expansion
        maxRequestImageBytes: 20971520   # accumulated base64 payload
        retryPolicy:
          mode: normal
          maxRetries: 3
      anthropic:
        apiKeyEnv: ANTHROPIC_API_KEY
        models:
          - id: claude-sonnet-4-5
            contextWindow: 200000
      acme-gateway:
        displayName: Acme Gateway
        apiKeyEnv: ACME_GATEWAY_API_KEY
        api: openai-completions
        baseURL: https://gateway.acme.example/v1
        compat:
          thinkingFormat: deepseek
        models:
          - id: acme-think
            name: Acme Think
            contextWindow: 262144
            reasoningEfforts:
              off:
              high: high
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `apiKeyEnv` | 无 | 按请求解析的凭据引用；省略时交由 pi-ai 环境发现 |
| `displayName` | 提供方名 | 选择器界面显示的标签 |
| `catalogProvider` | 提供方名 | 提供目录、协议、端点与 auth 默认值的已安装提供方，不改变路由键 |
| `api` | 目录中各模型的协议 | 覆盖每个模型的协议；手工声明的路由必须设置 |
| `baseURL` | 目录中各模型的端点 | 覆盖每个模型的端点 |
| `models` | 当前有效目录 | 选择模型 id；`modelCatalogMode` 为 live 时只定制同 id 的模型 |
| `modelCatalogMode` | 未设置 | `live` 跟随目录 id；`configured` 或省略时保留显式模型名单 |
| `codexDirectoryClientVersion` | `0.162.1` | Codex 目录兼容版本；影响账号模型可见性，与 SDK 或本机 CLI 版本独立 |
| `modelOverrides` | 无 | 未设置 `models` 列表时，定制当前有效目录中的个别模型 |
| `compat` | 目录检测 | 无法识别端点的协议兼容开关 |
| `defaultContextWindow` | `262,144` | 未描述模型的容量回退 |
| `defaultMaxTokens` | `32,768` | 未描述模型的输出上限回退 |
| `requestImagePixelBudget` | `4,194,304` | 每张确定性请求图片的总像素预算 |
| `requestImageMaxBytes` | `1 MiB` | 每张请求图片在 base64 扩展前的编码字节目标 |
| `maxRequestImageBytes` | `20 MiB` | base64 图片载荷总上限，保留图片超过时请求以 `IMAGE_OFFLOAD_REQUIRED` 失败 |
| `retryPolicy` | normal，5 次重试 | 由 `dsh-llm-retry` 执行的提供方自有重试策略 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-llm-pi-ai)是每个受支持字段及其 JSDoc 的穷尽式真源。

### 登录提供方

pi-ai 提供登录的提供方可以通过 harness 授权 seam 登录：流程提供 OAuth 或交互式密钥提示（密钥键入 pi-ai 自己的登录提示，而非设置表单），得到的凭据存储在 harness 凭据存储的 `llm-pi-ai/<provider id>` 记录中。存储的登录在其路由的 `apiKeyEnv` 覆盖之下完成认证，并在存储的跨进程锁下自行刷新；退出登录即删除存储记录。落在记录文法之外——小写连字符标识符——的手工声明路由键无法登录，因为对它的记录写入会以 `LlmError('UNSTORABLE_PROVIDER_ID')` 拒绝；这类路由改用 `apiKeyEnv` 或提供方 ambient 设置认证。

OpenCode Go 提供 [Console 浏览器登录](https://opencode.ai/v2/docs/console/api/#device-flow)和原生 API key 方式。设备授权流程使用本客户端标识 `durash`，绑定用户在浏览器选定的工作区，并采用服务端返回的轮询间隔和过期时间。访问令牌的有效期存为过期时间戳，不受设备授权定时器上限限制。轮换后的令牌保存在 `llm-pi-ai/opencode-go`；pi-ai 在凭据存储锁内刷新，再生成 bearer 请求头。取消请求时调用方立即返回，已开始的刷新仍完成并保存替换令牌；提供方 profile 的 `oauthRefreshTimeoutMs` 限制这次交换的时长（默认值与上限均为 15,000 毫秒）。启用不含 `apiKeyEnv` 覆盖的 `opencode-go` 提供方 profile，即可使用已存储的登录。

Go 从经过认证的 Console 配置读取当前工作区的模型清单：请求使用的模型 id、协议、各模型端点和上限来自该账号目录。Go 目录提供 Chat Completions、Responses、Anthropic Messages 和 Google Generative AI 四类原生协议。Gemini 使用已安装 SDK 和 Console 提供的完整 `/inference/go/google/v1beta` 端点；Go bearer 认证与 SDK 额外附加的 `x-goog-api-key` 请求头只发送到该 Go 端点。公开的 `models.dev` 元数据补充模型能力与推理设置；已安装的同协议元数据补充其他已知兼容信息。目录只接受 Go 提供方，并要求公布的推理端点位于 OpenCode 的 HTTPS Go 路径内。所有 OpenCode 请求保留 Harness User-Agent，并从持久化会话 id 生成 `x-opencode-session`；没有 id 的请求不会凭空生成一个。客户端遭到拒绝后不会切换到按量计费端点。OpenCode 的 [Use balance 设置](https://opencode.ai/v2/docs/console/go/#usage-beyond-limits)仍可能在 Go 额度耗尽后扣除 Console 余额；本适配器不改变该账户设置。

### 解析模型目录

除非 `catalogProvider` 显式点名另一个已安装提供方，否则 profile 的目录来源就是路由键。私有网关以部署专用路由名服务官方提供方模型时可使用前一种方式：路由保留自己的端点、凭据与选择身份，同时继承上下文、模态和推理档位等模型能力。DSH 不会根据模型 id 猜测来源，因为不同网关可能用相同 id 实现不同能力；空值或不存在的来源会被拒绝。

未设置 `modelCatalogMode: live` 时，非空 `models` 列表会替换当前有效目录的模型 id。每个条目从当前同 id 模型继承未设置字段，因此显式子集保留可选范围，更新后的元数据仍能提供协议、端点、模态和能力。`modelCatalogMode: configured` 显式选择该模式；省略时保留相同行为。

设置 `modelCatalogMode: live` 后，当前账号目录提供全部 id，包括新发布的模型。已保存的 `models` 行只定制对应 id，不限制名单。已保存行的 id 离开目录时仍可编辑并显示诊断，但不会提供该模型，也不会阻止其他模型。`modelOverrides` 仅在没有 `models` 列表时定制目录条目；未知的覆盖 id 仍属无效配置。

### 带推理（reasoning）与协议兼容运行

`reasoningEfforts` 声明可选推理档位：键是选择器提供的档位，值是请求中发送的拼写。省略时保留当前有效目录的能力；`false` 声明非推理模型。`compat` 按路由或模型调整受支持的请求字段。配置与目录都没有提供容量时，模型使用 `defaultContextWindow` 与 `defaultMaxTokens`。目录中的输出容量不会成为请求上限；只有显式配置的模型 `maxTokens` 会成为请求上限。

对于自托管 Chat Completions 端点，`thinkingTokenBudgetField` 选择推理预算参数，`vllmPriority` 在服务端启用优先级调度时设置整数调度优先级。模板参数接受 `$var: thinking.budget`。`openai-responses` 网关可设置 `supportsMaxOutputTokens: false` 来省略 `max_output_tokens`；Azure 与 Codex 传输会忽略这个共享兼容字段。这些控制均需显式启用；目录拥有的 Anthropic effort 和回退能力不是可配置开关。

### 运行时更改配置

profile 通过可选 settings seam 每次操作重新读取：base 与用户的 `llm-pi-ai:` 设置分节按提供方合并，因此用户可以新增路由、覆盖组合路由的一个字段或把路由指向另一个代理，全部在下一个请求生效、无需重启。适配器无法服务的分节会在写入处被拒绝——`settings.mutate` 回答 `settings-rejected`——之后失效的已存储分节会保留 namespace 最后有效值。当路由集合或某路由的重试策略变化时，插件会原子地重新注册：冲突路由会让此前路由继续服务。

<a id="synchronize-account-model-directories"></a>
### 同步账号模型目录

已配置的 ChatGPT/Codex、OpenCode Go 与 xAI 路由在 Host 启动、登录成功或凭据来源变化、定时以及显式刷新时同步目录。凭据服务完成首次加载、被替换或移除时，Host 立即使此前凭据来源的目录失效并发起同步。路由必须保留原生 API；私有端点通过 `modelCatalogMode: live` 明确启用同步。在账号目录首次读取成功前，已安装目录提供初始元数据。

Host 在内存中保存完整模型描述，按路由及当前账号或端点隔离。模型列表、解析和分派使用同一份元数据。同一来源刷新失败时保留最后一次有效目录并显示诊断。账号或来源变化会清空旧目录，直到新来源读取成功；不会暴露另一个账号的模型。重启 Host 后重新从已安装元数据开始。

以下字段位于插件配置根级，与 `providers` 并列；均接受大于零且不超过 `2,147,483,647` 的有限毫秒数。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `modelCatalogRefreshMs` | `60,000` | 原生目录的刷新间隔 |
| `modelCatalogTimeoutMs` | `15,000` | 一次共享原生目录请求的截止时间 |

### 从端点发现模型

被动发现优先读取 Host 当前的账号元数据，否则读取已安装目录，不自行发起网络请求。显式刷新已存储的原生来源还会更新运行时目录，无需写入设置。未保存的端点、协议或密钥探测只返回编辑器候选，不能替换该目录。xAI 按 id 合并经过认证的 `GET /models` 与 `GET /language-models`，由语言目录选择聊天模型，两份响应共同提供能力信息。草稿密钥或已配置的凭据引用优先于订阅认证。刷新失败会直接报错，不会把旧名单当作成功结果返回。

Codex 默认使用当前订阅凭据与账号 id 请求 `GET {baseURL}/codex/models?client_version=0.162.1`；根地址已以 `/codex` 结尾时直接使用。profile 的 `codexDirectoryClientVersion` 选择受支持的目录兼容版本，与 SDK 或本机 Codex CLI 版本独立。服务端按该版本控制模型可见性与元数据，因此同一账号使用较旧的固定值也可能返回旧名单。运行时修改此字段会刷新目录，无需升级 SDK。仅提供 `visibility: list` 的条目，包括公共 API 不提供的模型。模型 id、名称、上下文窗口、输入类型与受支持的推理档位进入原生运行时元数据，包含已安装 SDK 尚未收录的 id。编辑器候选中缺失的输出上限保持未指定。刷新不会改写已保存的模型定制。

其他内置提供方保留本地发现；手工声明路由查询其端点。`openai-completions` 与 `openai-responses` 使用带 bearer 认证的 `GET {baseURL}/models`；`anthropic-messages` 使用带 `x-api-key` 与 `anthropic-version` 的 `GET /v1/models?limit=1000`。Anthropic 列表查询归一化末尾 `/v1`，模型请求仍保留配置的 `baseURL`。已存储凭据与部署标头保留在 Host；一次性草稿密钥优先。解析器接受标准 `data` 数组或富信息 `models` 对象，保留对象键作为请求 id，并归一化名称、容量与模态。这些草稿结果保持为候选，直到编辑器采纳并保存。

### 失败与恢复

pi-ai 不提供的路由需要 `api`、`baseURL` 与非空 `models` 列表；显式的 `catalogProvider` 必须点名已安装提供方。无法服务的 profile 会在写入处被拒绝，并点名路由与模型。失败携带稳定 code：无法使用的凭据以 `INVALID_CREDENTIAL` 失败并点名路由与引用，`apiKeyEnv` 引用解析为空的路由以 `MISSING_CREDENTIAL` 失败，未配置模型以 `UNKNOWN_MODEL` 失败，终止性提供方失败则区分 `QUOTA` 与暂时性 `RATE_LIMIT`。`GenerateOptions.stop` 以 `UNSUPPORTED_OPTION` 被拒绝，因为 pi-ai 的通用流式 UI 无法跨提供方保证它。

Settings 写入会在合并组合层与用户层后严格校验每个新增或修改的提供方。命名空间注册时，已存储配置的目录解析错误会保留命名空间与提供方行，并通过 `LlmConfigurableProvider.error` 优先返回首个模型诊断，无模型诊断时返回路由错误；未修改的错误提供方不会阻止其他编辑。可解析的模型仍可选择，无法解析的模型保留在可编辑配置中，直接请求时会在网络 I/O 前以 `INVALID_CONFIG` 失败。修复或删除无效配置会清除诊断；缺失的 live id 再次出现在账号目录中时也会恢复。Schema 与 profile 自身的约束错误仍会拒绝加载。后续外部文件编辑会校验变化的提供方，失败时保留最后一次接受的分节。

已选模型的配置无效时，只修改 `displayName`、`apiKeyEnv` 或 `baseURL` 的保存仍会被拒绝。例如，OpenRouter 模型 `111` 没有可解析的 `api` 时，必须在同一草稿中修复或移除。live 定制的 id 不在账号目录中时会保留诊断，但不阻止其他模型。中间修复保留在草稿中，直到已选模型通过校验；其他提供方仍可独立保存。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释适配器背后的设计；可观察行为已在[使用本包](#use-this-package)中完整说明。

### 设计理念

每次操作在首次 `await` 前捕获不可变的 profile 与模型快照。配置变化或原生目录发布成功后，会为后续操作创建新的集合，因此进行中的请求保留启动时的模型描述。profile 凭据按请求解析；已存 OAuth 记录与环境认证跨目录版本共享。Host 拥有当前原生模型描述，刷新协调器负责并发请求、截止时间、来源失效与等待退出。运行时通过 pi-ai 的专用提供方、API 和工具入口导入；`src/models.ts` 提供模型辅助函数，不执行总入口。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：profile 解析、settings 接线、目录与路由注册 |
| [`src/auth.ts`](src/auth.ts) | 覆盖 harness 凭据平面的凭据存储与 ambient auth context |
| [`src/login.ts`](src/login.ts) | 面向提供登录的已安装提供方的授权流程 |
| [`src/config.ts`](src/config.ts) | Profile schema、解析与可服务性校验 |
| [`src/catalog.ts`](src/catalog.ts) | 运行时或已安装模型默认值、选择模式与兼容校验 |
| [`src/models.ts`](src/models.ts) | 基于 pi-ai 窄入口的 model collection、静态 provider 与 reasoning level |
| [`src/provider.ts`](src/provider.ts) | 受支持协议表与提供方构建 |
| [`src/context.ts`](src/context.ts) | Harness 到 pi-ai 的上下文转换、图片处理、回放恢复 |
| [`src/stream.ts`](src/stream.ts) | 把 pi-ai 事件转换为 harness `StreamChunk` 值 |
| [`src/replay.ts`](src/replay.ts) | 带版本的 `ReplayEnvelope` 存储与校验 |
| [`src/discovery.ts`](src/discovery.ts) | 原生目录读取与编辑器元数据发现 |
| [`src/opencode-go-catalog.ts`](src/opencode-go-catalog.ts) | 合并 Console Go 路由与公开模型能力 |
| [`src/live-catalog-sync.ts`](src/live-catalog-sync.ts) | 合并刷新、来源版本、截止时间与等待退场 |

### 注册与目录

插件会在可配置提供方目录中声明它能认证的每个已安装目录提供方，并加入当前 profile 声明的每条路由，因此配置界面可以在任何路由存在之前提供完整目录。每个条目都携带 `declared`——pi-ai 是否在该键下不提供任何内容——因为只有适配器能区分手工声明路由与收窄目录路由。路由注册具有原子性：与其他适配器冲突的候选集合会让此前路由继续服务。零路由的裸挂载即休眠姿态：settings 分节提供 profile 前不注册任何内容，分节清空时路由随之消失。

### 回放与词汇

成功 assistant 响应会存储带版本的、无损 JSON 回放状态，与产生它们的提供方和模型放在一起——响应级事实加每个流式块一条逐块条目。请求时，`LlmRuntime` 仅当同一适配器实例拥有两条路由时才传递回放状态；适配器校验它并恢复原生响应 id、提供方签名与可选的 `providerThinkingLevel` effort 元数据，缺失的 effort 元数据仍保持缺失。回放会对照 assistant 来源校验请求模型身份，并在提供方解析别名或回退时单独恢复 Anthropic 响应模型。无法使用的状态会降级为提供方无关内容而不是让请求失败。pi-ai 工具调用参数是解析后的对象，因此适配器解析输入并重新字符串化输出，以符合 harness 原始 JSON 约定；pi-ai 流内错误事件映射为终止 `finish` 分片。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级约定不够用时阅读以下页面。它们从服务约定逐步进入孪生适配器与共享类型。

- [dsh-llm 服务](../llm/README.zh.md)——本适配器注册其上的提供方无关服务。
- [llm-deepseek 适配器](../llm-deepseek/README.zh.md)——`deepseek-official` 路由的 DeepSeek 直连孪生。
- [LLM 流式子系统](../../../docs/subsystems/llm-streaming.zh.md)——`StreamChunk` 协议与适配器约定。
- [llm-retry](../llm-retry/README.zh.md)——应用每个 profile `retryPolicy` 的重试执行器。
- [孪生 LLM 适配器](../../../.agents/notes/implemented/architecture/2026-06-13-twin-llm-adapters.zh.md)——为什么 DeepSeek 路由交付两个结构不同的适配器。
- [生成配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-llm-pi-ai)——每个受支持配置字段及其源声明。

-----

<a id="model-experience"></a>
## 模型体验

### 经 pi-ai 的提供方请求

#### 模型看到什么

所选目录模型会收到一条系统提示词（`GenerateOptions.system`，否则取历史中首条 `system` 消息的文本；首条 system 消息文本为空时不发送系统提示词）、其余历史、工具与 pi-ai 通用流式 API 支持的采样字段。每张保留图片前都会有文本，注明其完整附件 id 与实际请求尺寸。当前执行文件系统可以映射附件提供方的宿主对象时，该文本还会携带只读规范化对象路径，并警告规范化或请求投影可能缩放或重新编码上传内容。日志中的图片省略决策选中的每个出现位置都会在替换文本中保留自己的身份与当前已解析访问方式，其规范化附件不会读取或变换。当保留的出现位置按精确 base64 载荷仍超过路由的 `maxRequestImageBytes` 时，调用以 `IMAGE_OFFLOAD_REQUIRED` 失败，由 `dsh-compaction-image-offload` 用 `image/offload` 事件记录所选位置并重试步骤。提供方原生回放元数据只在适配器针对历史内容校验通过后恢复。

#### Token 影响

提供方分词决定精确输入。保留图片会添加稳定的附件与坐标描述符；卸载占位符会替代省略图片的视觉 token。回放元数据可能让原生 API 复用提供方侧状态。

#### KV Cache 影响

转换保持逻辑请求顺序，图片句柄与卸载占位符则会添加模型可见文本。即使附件身份与请求字节保持稳定，执行世界路径变化也会改写历史句柄，并可能从该图片起阻止复用。更换适配器实例、提供方、模型或其他上游 token 具有相同的后缀影响。一次省略决策会把较早图片换成占位文本，因此复用在该消息处结束；省略永不回退，此后前缀保持稳定。

### 提供方响应

#### 模型看到什么

pi-ai 事件变成 harness 的推理、文本、工具调用、用量与 finish 分片。适配器把解析后的工具参数以原始 JSON 字符串传给 harness。

#### Token 影响

生成内容只在 loop 记录后才影响后续输入。提供方未单独报告推理 token 时，pi-ai 会把推理 token 并入输出用量，并原样保留其精确 `totalTokens` 值。

#### KV Cache 影响

已记录的响应内容会追加到下一个请求，不会使其更早可复用前缀失效。未记录的传输元数据与用量计量不影响缓存标识。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制说明适配器在哪里停止、由未来工作接续。它们是当前包约束，不是通用 pi-ai 对比或任务积压。

- **`maxRequestImageBytes` 只计算 base64 图片载荷**，文本、工具、描述符与 JSON 结构在该上限之外，因此它必须留有余量地低于网关请求体上限。
- **登录只存在于发起它的进程中**——授权尝试不持久，因此登录中途重启 Host 会放弃它，用户需要重新开始。退出登录是对已存储记录执行 `deleteRecord`，只在本地忘记它，不会告知签发方。
- **提供方原生发现经本插件的 ambient context 回答**——不点名凭据的路由交由目录提供方自身解析，它会询问环境值（`AZURE_OPENAI_API_KEY`、`AWS_PROFILE` 及各提供方自有集合）与本地凭据文件。两个问题都在这里得到回答：凭据 seam 先于进程环境被查询，文件存在性则针对宿主进程的文件系统以 `~` 展开后检查。它做不到的是*读取*凭据文件内容——自行解析 `~/.aws/credentials` 的提供方会直接读取，不经该 seam。
- **设置可以新增或覆盖路由，不能移除组合路由**——用户层覆盖组合 base，因此删除 `cordis.yml` 提供的提供方属于组合变更。
- **分层合并对字典键没有删除**——base 声明的 `reasoningEfforts` 等级、`modelOverrides` 条目或 `compat` 字段可以被用户层覆盖，但不能被移除。
- **`headers` 可以携带 redactor 永远看不到的凭据**——profile 解析会拒绝 Fetch 无法表示的名称与值，但该字典仍是纯字符串；以 `apiKeyEnv` 引用存储凭据。
- **原生目录只保留在进程内**——重启会丢失最后一次有效的账号元数据，在同步成功前从已安装目录开始。
- **Anthropic 模型发现最多读取 1,000 个模型**——请求使用 API 的最大页大小，但不会遍历 `has_more`；第一页之外的条目需要手工添加。
- **配置的 `api` 覆盖每个模型**——手工声明路由使用同一种协议，原生目录路由则可以保留各模型不同的协议与端点。
- **模态声明不受校验**——声明 `image` 而其网关不支持的模型会在提示词准入后被提供方拒绝。持久图片仍留在历史中，同一误声明模型可能再次失败；切换到纯文本模型仍然可行，因为共享 LLM 运行时会针对该请求把图片引用投影为稳定文本。
- **未认证路由取决于其协议**——不点名凭据的路由解析为已配置但无密钥，但 pi-ai 的 OpenAI 兼容实现仍要求 API 密钥或 `Authorization` 标头，因此无密钥本地服务器需要由 `apiKeyEnv` 引用或 `headers` 中的 `Authorization` 条目提供的占位凭据。
- **不支持 `GenerateOptions.stop`**——pi-ai 的通用流式选项无法跨提供方保证停止序列行为。
- **只有历史中首条 `system` 消息会成为 pi-ai 的 `systemPrompt`**——pi-ai 只有一个系统槽位，因此后续的 `system` 消息，或在同时设置了 `GenerateOptions.system` 时的首条消息，会在原位置折叠为 `user` 消息；系统提示词的提供方专属放置遵循 pi-ai，而非 harness 自有的协议覆盖。system 或 assistant 历史中的图片（包括首条系统消息中的图片）在两条转换路径上都会以 `UNSUPPORTED_CONTENT` 失败。
- **提供方 HTTP 状态不可用**——pi-ai 错误事件不跨提供方暴露稳定 HTTP 状态。
- **重试策略由提供方自有，而非 SDK 重试**——pi-ai SDK 重试保持禁用，因此持久 agent（智能体）步骤与 `llm/retry` 事件拥有每个可见尝试，直接 `ctx.llm.stream()` 调用仍是单次尝试。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本开发备注是不具权威性的工作上下文：尚未决定的探索方向与维护者备注。已交付的行为与既定理由以上文、包代码和相关 Agent Note 为准。

- 提供的协议集合刻意比 pi-ai 的完整 API 集合更窄：Bedrock、Vertex、Azure 与 Codex 通过 profile 无法以密钥、端点与标头完整描述的流程认证；目录路由仍可经自有提供方到达它们，只有显式覆盖会被拒绝。Codex 可经授权流程的 OAuth grant 登录。
- `compat` 开关集合由漂移门禁钉在 pi-ai 的 compat 类型上；上游升级若新增字段、为更多协议赋予 compat 类型或扩大值联合，会在有人分类前让构建失败。

</details>

**运行时不变式：** 不发布伴生入口。本包没有独立事件序列或可变数据关系，相关约定在所属 seam 强制执行。
