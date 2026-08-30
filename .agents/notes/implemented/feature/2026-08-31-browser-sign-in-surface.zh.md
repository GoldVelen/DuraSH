# Agent Note: Browser sign-in surface for authorization flows

Status: implemented

[English](2026-08-31-browser-sign-in-surface.md) | 中文

## 问题

authorization 能力交付时接缝完整、消费方缺位。`llm-pi-ai` 为每个内置登录的目录提供方注册了登录流——ChatGPT Plus/Pro（Codex）、Grok/X、Claude Pro/Max、Kimi Code、OpenRouter 等——但没有任何 bundle 挂载 `authorization` 服务，也没有任何界面能启动尝试。持订阅账号的用户进不了自己的提供方：模型页只提供 API 密钥，而旧 pi-agent 时代的登录属于本仓库不发布的产品线。缺的是一条 wire 契约和一个页面区域，不是一套新的认证系统。

## 决策

`authorization` 服务在基础组合中挂载于凭据提供方旁，pi-ai 的登录流随之在适配器存在的每个组合中注册。网页模型页新增**账号登录**区域，背后是 `@deepseek-ai/dsh-api-settings-controller` 里新的 `authorization` Remote 命名空间。

wire 采用轮询形态，因为 `AuthorizationService.begin()` 要等一个人几分钟：`describe()` 在一份快照里同时应答登录流列表与宿主跟踪的尝试；`begin` 以控制器持有的交互启动尝试并立即应答；`respond` 回答唯一的待答提问（作答或拒绝）；`cancel` 撤回。尝试状态存于宿主——第二个浏览器标签页或重新加载的页面重新加入正在进行的尝试而不是另开一份；已结束的尝试保持可见，直到该 key 的下一次 begin。区域挂载时以 1.5 秒节奏轮询，每次动作后立即刷新一次；本次改动不新增事件词汇，也不新增流。

登录提交后，提供方走普通的添加流程且密钥留空：无引用的 pi-ai profile 把认证让给 provider 原生发现，后者解析已存储的授权。登录与建 profile 保持两步，因为仅凭授权不注册路由——存在哪些适配器是组合的事，哪些提供方运行是用户设置文档的事。

## 考虑过的替代方案

**用实时事件通道推送通知与提问。** 对这个界面而言被否决：它要为设置页新增事件词汇、一条转发事件白名单和 RPC 载荷上的答题管道，而 1.5 秒轮询与推送在体感上无法区分。轮询契约还能存活于只应答请求的传输。

**在每个 OAuth 提供方的添加流程里放一张登录卡。** 被否决：登录在任何路由存在之前就有意义（登录正是让路由值得添加的前提，见 pi-ai 流注册契约），而添加卡已是页面上信息最密的界面。平铺的流列表从一份宿主快照渲染每个已注册登录——包括用户尚未决定添加的提供方。

**复用已退役的 pi-agent 提供方登录。** 被否决：那个运行时属于另一条产品线，不在本仓库的发布组合内；pi-ai 适配器已把相同提供方的 OAuth 流作为已注册的授权流携带。

## 后果

订阅用户现在端到端可达自己的提供方：登录、以空白密钥添加提供方、选择模型。已知目录集合取决于 pi-ai 的版本——本仓库 pi-ai 没有登录的提供方（Cursor 在内）只作为 API 密钥提供方出现。尝试状态以流数量为界；每次尝试的通知上限 50 条。轮询的代价是每个打开的模型页每个节奏一次小型已认证请求。

## 测试

`authorization-controller.host.spec.ts` 钉住命名空间注册、服务缺失拒绝、流列表、非法/未知 key 与 method 拒绝、通知与提问投影、respond 完成与拒绝、cancel 撤回、prompt-signal 清理与过期 id 拒绝、二次 begin 冲突，以及 NOT_COMMITTED 失败视图。`sign-in-store.client.spec.ts` 钉住轮询生命周期、轮询失败时的最后良好快照、动作拒绝的呈现，以及 wire 参数透传。宿主没有提供登录流时，区域不渲染。
