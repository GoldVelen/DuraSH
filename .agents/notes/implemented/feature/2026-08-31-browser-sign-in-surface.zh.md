# Agent Note: Browser sign-in surface for authorization flows

Status: implemented

[English](2026-08-31-browser-sign-in-surface.md) | 中文

## 问题

authorization 能力交付时接缝完整、消费方缺位。`llm-pi-ai` 为每个内置登录的目录提供方注册了登录流——ChatGPT Plus/Pro（Codex）、Grok/X、Claude Pro/Max、Kimi Code、OpenRouter 等——但没有任何 bundle 挂载 `authorization` 服务，也没有任何界面能启动尝试。持订阅账号的用户进不了自己的提供方：模型页只提供 API 密钥，而旧 pi-agent 时代的登录属于本仓库不发布的产品线。缺的是一条 wire 契约和一个页面区域，不是一套新的认证系统。

## 决策

`authorization` 服务在基础组合中挂载于凭据提供方旁，pi-ai 的登录流随之在适配器存在的每个组合中注册。网页模型页新增**账号登录**区域，背后是 `@deepseek-ai/dsh-api-settings-controller` 里新的 `authorization` Remote 命名空间。Models 插件不把 `remote.authorization` 列入必需 inject——否则从未挂载该命名空间的 fixture 会卡住整页——而是用 `ctx.inject` 绑到一条一开始为空的转发 wire。未注入的 `ctx.remote.authorization` 访问器在命名空间已经挂载时也会抛错，因为 Cordis 读取已声明服务必须经过 inject。

wire 采用轮询形态，因为 `AuthorizationService.begin()` 要等一个人几分钟：`describe()` 在一份快照里同时应答登录流列表与宿主跟踪的尝试；`begin` 以控制器持有的交互启动尝试并立即应答；`respond` 回答唯一的待答提问（作答或拒绝）；`cancel` 撤回。尝试状态存于宿主——第二个浏览器标签页或重新加载的页面重新加入正在进行的尝试而不是另开一份；已结束的尝试保持可见，直到该 key 的下一次 begin。当没有被跟踪的尝试占用某个登录流 key 时，`describe()` 也会把已有且已配置的凭据投影为 `authorized`，因此进程重启不会让已经提交的登录显示成缺失；当前被跟踪的尝试始终优先于这项存储投影。区域挂载时以 1.5 秒节奏轮询，每次动作后立即刷新一次；本次改动不新增事件词汇，也不新增流。

失败报告只陈述控制器能观察到的事实：登录流是否已经送达通知或提问，或者 authorization seam 是否以 `NOT_COMMITTED` 拒绝尝试。外层失败消息会脱敏 bearer 与 OAuth token 字段。`fetch failed` 这类传输包装错误最多从其 cause 或 `AggregateError` 追加 4 组白名单网络元数据；任意嵌套消息都不会传到浏览器。

登录提交后，模型页写入与添加卡片相同的空白原生认证 profile（对该登录流的目录路径做 `settings.mutate` 写入 `{}`），catalog 路由随之注册、模型进入对话选择器，并打开该提供方的模型目录编辑器。仅凭授权仍不注册路由——是本页的写入把提供方写进用户设置文档。同一 key 稍后可以再次 begin；已经配置的行不会被改写。

## 考虑过的替代方案

**用实时事件通道推送通知与提问。** 对这个界面而言被否决：它要为设置页新增事件词汇、一条转发事件白名单和 RPC 载荷上的答题管道，而 1.5 秒轮询与推送在体感上无法区分。轮询契约还能存活于只应答请求的传输。

**在每个 OAuth 提供方的添加流程里放一张登录卡。** 被否决：登录在任何路由存在之前就有意义（登录正是让路由值得添加的前提，见 pi-ai 流注册契约），而添加卡已是页面上信息最密的界面。平铺列表渲染每个带 OAuth 方法的宿主登录流，包括用户尚未决定添加的提供方；仅 API 密钥的目录登录留在添加表单。

**复用已退役的 pi-agent 提供方登录。** 被否决：那个运行时属于另一条产品线，不在本仓库的发布组合内；pi-ai 适配器已把相同提供方的 OAuth 流作为已注册的授权流携带。

## 后果

浏览器与宿主现在包含一条受支持路径：从已注册登录流，到已存储凭据、已配置路由，再到模型选择器。本次改动尚未通过真实 xAI 或其他 OAuth 发行方验收：发行方浏览器页面显示成功，并不能证明宿主已经完成 token 交换并提交凭据。已知目录集合取决于 pi-ai 的版本——本仓库 pi-ai 没有登录的提供方（Cursor 在内）只作为 API 密钥提供方出现。尝试状态以流数量为界；每次尝试的通知上限 50 条。轮询的代价是每个打开的模型页每个节奏一次小型已认证请求。

## 测试

`authorization-controller.host.spec.ts` 钉住命名空间注册、服务缺失拒绝、流列表、非法/未知 key 与 method 拒绝、通知与提问投影、respond 完成与拒绝、cancel 撤回、prompt-signal 清理与过期 id 拒绝、二次 begin 冲突、存储凭据投影、`NOT_COMMITTED` 阶段、脱敏、白名单网络元数据及其输出上限。`sign-in-store.client.spec.ts` 钉住轮询生命周期、轮询失败时的最后良好快照、动作拒绝的呈现，以及 wire 参数透传。`sign-in-bind.client.spec.ts` 钉住 `remote.authorization` 出现前的空 wire、provide 之后的转发，以及 dispose 之后再次变空。`sign-in-section.client.spec.tsx` 钉住仅渲染 OAuth，以及尝试已授权时隐藏进行中通知。`enableNativeProviderProfile` 钉住写入空白 `{}` profile。宿主没有 OAuth 登录流时，区域不渲染。本次改动没有用测试运行真实发行方登录或已认证提供方请求；它们仍属于运行时验收。
