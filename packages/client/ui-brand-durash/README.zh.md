---
description: "面向侧栏与会话首屏的 DuraSH 品牌填充，仅在 DuraSH 构建中生效；供组合产品身份的用户与维护者阅读。"
kind: "package-reference"
---

# @durash/dsh-client-ui-brand

[English](README.md) | 中文

## 概述

本包以原创 DuraSH 标志与名称填充 `sidebar.brand.mark`、`sidebar.brand.name` 和 `conversation.hero.brand.mark`。它只在客户端以 `DSH_CLIENT_BUILD_PROFILE=durash` 构建时注册，其他 profile 完全不受影响。标志采用不依赖字体的几何 D 与前进箭头，并使用 DuraSH 的午夜色、琥珀色和浅色配色；名称则保留为可访问文本。本包不保留运行时状态，也不向模型请求贡献任何内容。

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

在 DuraSH 浏览器插件名单中挂载本插件，并以 `durash` profile 构建客户端。这三个填充会替换通用外壳回退，而不修改上游官方品牌包。

### 选择 profile

`DSH_CLIENT_BUILD_PROFILE` 是构建期身份选择器。只有精确取值 `durash` 时才安装本包的填充。`official`、本地或未设置的取值都会让本包的三个槽位保持空置，从而允许相应发行版提供自己的身份。

### 品牌图形

SVG 标志只使用几何路径，因此不依赖已安装或远程托管的字体。紧凑轮廓在侧栏的 16–24 px 尺寸下仍可识别。`DuraSHBrandName` 渲染普通的本地化文本节点，而不把名称转换成 SVG 轮廓；各宿主表面继续负责外围的可访问标签。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

嵌套的 `ctx.slots.inject()` 调用会等待三个槽位声明全部就绪，再注册整组填充。任一声明消失时都会撤回完整集合，重新声明后再恢复，因此 HMR 期间不会留下混合品牌。浏览器半部位于 [`src/client/index.ts`](src/client/index.ts)；node 半部是一个惰性的 Loader 座位。浏览器标题、favicon、manifest 与仓库字标素材仍是本包之外的发行版级职责。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [ui-sidebar](../ui-sidebar/README.zh.md)——声明侧栏标志与名称槽位。
- [ui-conversation](../ui-conversation/README.zh.md)——声明会话首屏标志槽位。
- [Web 客户端槽位](../../../docs/subsystems/slots.zh.md)——定义声明感知注册与生命周期行为。

-----

<a id="model-experience"></a>
## 模型体验

无，因为本包只贡献浏览器呈现；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；本包既不组装也不发送提供方请求。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

以下限制指出本包有意不负责的发行版表面。

- **浏览器素材独立**——favicon、PWA manifest、仓库社交分享图与浏览器标题属于 DuraSH 发行版。
- **固定单一身份**——其他名称、标志或配色应进入另一个槽位填充包，而不是运行时配置。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本包必须与 `@deepseek-ai/dsh-client-ui-brand-official` 保持分离。上游同步必须能够更新或替换官方包，而不会在这里产生品牌合并冲突。

</details>
