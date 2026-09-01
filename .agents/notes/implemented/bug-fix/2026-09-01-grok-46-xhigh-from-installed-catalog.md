# Agent Note: Grok 4.6 offers xhigh from the installed catalog

Status: implemented

English | [中文](2026-09-01-grok-46-xhigh-from-installed-catalog.zh.md)

## Problem

Signing into xAI and selecting Grok 4.6 never offered `xhigh` in the composer effort picker, even though the xAI API accepts `reasoning_effort: "xhigh"` on that model.

The installed `@earendil-works/pi-ai` 0.84.2 catalog described `grok-4.6` as `openai-completions` with `compat.supportsReasoningEffort: false` and no `thinkingLevelMap`. `getSupportedThinkingLevels` treats `xhigh` and `max` as opt-in: without a non-null map entry they are hidden. The five base levels still appeared, but `supportsReasoningEffort: false` also kept `reasoning_effort` off the wire, so even High did not reach the provider. `grok-4.5` correctly omits `xhigh`; the gap is `grok-4.6` and later.

## Decision

The adapter depends on `@earendil-works/pi-ai` `^0.84.4`. That catalog puts `grok-4.6` on `openai-responses` with `thinkingLevelMap.xhigh: "xhigh"`, so a blank native-auth xAI profile — the document the Models page writes after sign-in — offers Low/Medium/High/Xhigh and dispatch sends `reasoning.effort`. `grok-4.5` still pins `xhigh: null`.

`thinkingTokenBudgetField` is offered, because a private vLLM, Qwen/DashScope/SGLang, or llama.cpp gateway must name the cap field and the catalog does not set it; `allowedFallbackModels` is withheld, because Anthropic fallback ids and their prices belong on the installed catalog entry. `thinking.budget` joins the chat-template placeholder set because that union widened in the same pi-ai release.

## Alternatives considered

- **Shipping `modelOverrides` for `grok-4.6` from the composition or a settings default.** Rejected: an override lands in the user's `settings.yaml` and then shadows later catalog corrections; the layered merge cannot delete a dict key the base declared.
- **Patching `thinkingLevelMap` inside `resolveRouteModels` when the provider is `xai`.** Rejected: it copies catalog facts this package does not own, and the next pi-ai catalog bump would fight the overlay instead of replacing it.
- **Leaving 0.84.2 and documenting a hand-written override.** Rejected: the shipped picker would still hide `xhigh` for every sign-in that does not already know the workaround.

## Consequences

`grok-4.6` requests travel the Responses protocol rather than Chat Completions. A deployment that pointed an xAI route at a completions-only proxy must name that protocol on the route. Mixed-protocol resolution tests no longer use xAI as the mixed catalog, because this catalog's xAI models are Responses-only; they take any remaining installed provider that still ships both protocols.

## Testing

`catalog.spec.ts` pins `getSupportedThinkingLevels` for the installed `grok-4.6` entry at `['low', 'medium', 'high', 'xhigh']` through a blank `xai` profile, and pins `grok-4.5` without `xhigh`. The mixed-route compat tests fail loud if the installed catalog loses every completions-plus-responses provider.
