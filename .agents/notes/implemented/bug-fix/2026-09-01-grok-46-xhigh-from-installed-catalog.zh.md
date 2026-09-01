# Agent Note: 已安装 catalog 为 Grok 4.6 提供 xhigh

Status: implemented

[English](2026-09-01-grok-46-xhigh-from-installed-catalog.md) | 中文

## 问题

登录 xAI 并选择 Grok 4.6 时，输入框的推理档位选择器从不提供 `xhigh`，尽管 xAI API 在该模型上接受 `reasoning_effort: "xhigh"`。

当时安装的 `@earendil-works/pi-ai` 0.84.2 catalog 把 `grok-4.6` 写成 `openai-completions`，并带 `compat.supportsReasoningEffort: false`，也没有 `thinkingLevelMap`。`getSupportedThinkingLevels` 把 `xhigh` 和 `max` 当作需显式加入的档位：没有非空 map 条目就不会出现。五个基础档位仍会显示，但 `supportsReasoningEffort: false` 同时让 `reasoning_effort` 不上协议，因此即便选 High 也不会到达提供方。`grok-4.5` 正确地省略 `xhigh`；缺口在 `grok-4.6` 及之后的模型。

## 决策

适配器依赖 `@earendil-works/pi-ai` `^0.84.4`。该 catalog 把 `grok-4.6` 放在 `openai-responses` 上，并设置 `thinkingLevelMap.xhigh: "xhigh"`，因此空白的 native-auth xAI profile——模型页在登录成功后写入的那份文档——会提供 Low/Medium/High/Xhigh，分派发送 `reasoning.effort`。`grok-4.5` 仍将 `xhigh` 固定为 `null`。

`thinkingTokenBudgetField` 对外提供，因为私有的 vLLM、Qwen/DashScope/SGLang 或 llama.cpp 网关必须点名上限字段，而 catalog 不会设置它；`allowedFallbackModels` 予以扣留，因为 Anthropic 回退 id 及其价格属于已安装 catalog 条目。`thinking.budget` 加入 chat-template 占位符集合，因为同一 pi-ai 发行版加宽了该联合。

## 备选方案

- **从组合或 settings 默认值下发 `grok-4.6` 的 `modelOverrides`。** 否决：覆盖会落入用户的 `settings.yaml`，随后挡住日后 catalog 修正；分层合并无法删除 base 已声明的字典键。
- **在 `resolveRouteModels` 里于提供方为 `xai` 时补丁 `thinkingLevelMap`。** 否决：这是复制本包并不拥有的 catalog 事实，下一次 pi-ai catalog 升级会与该覆盖层互相打架，而不是替换它。
- **留在 0.84.2，只文档化一份手写覆盖。** 否决：对每一个还不知道该变通办法的登录，已交付的选择器仍然会隐藏 `xhigh`。

## 影响

`grok-4.6` 请求走 Responses 协议，而不再走 Chat Completions。把 xAI 路由指向仅 Completions 代理的部署必须在路由上点名该协议。混合协议的 resolution 测试不再把 xAI 当作混合 catalog，因为此 catalog 的 xAI 模型全是 Responses；它们改用任何仍同时提供两种协议的已安装提供方。

## 测试

`catalog.spec.ts` 通过空白 `xai` profile 把已安装 `grok-4.6` 条目的 `getSupportedThinkingLevels` 钉在 `['low', 'medium', 'high', 'xhigh']`，并把 `grok-4.5` 钉成没有 `xhigh`。若已安装 catalog 不再有任何同时提供 Completions 与 Responses 的提供方，混合路由 compat 测试会响亮失败。
