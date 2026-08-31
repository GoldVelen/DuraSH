---
description: "Per-session reliability-loop policy: the composer switch's Host truth for enablement and implementation/review model selection."
kind: "package-reference"
---

# @durash/dsh-reliability-policy

English | [中文](README.zh.md)

## Summary

`dsh-reliability-policy` is the Host service behind the composer workflow switch. One durable row per Session stores whether the reliability loop is on and which implementation and review models the next handoff will use. Every read rebuilds the model directory from `ctx.llm`, so a route that left the catalog cannot stay enabled. The service composes only into the `durash` profile.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this plugin with `ctx.storageDomain` and `ctx.llm`. The composer switch calls `policy`, `ensurePolicy`, and `configure` over the generated Remote. `workflowEnabled(sessionId)` and `enabledRoutes(sessionId)` are same-process reads for the model-facing handoff tool.

Enabling a Session requires both lanes to name catalog models. A missing or invalid selector cannot stay enabled: the next read turns the row off.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The `reliability_policy` storage domain holds one `sessions` row keyed by Session id. Catalog membership is not stored. Mutations queue per Session. Selectors are `provider/model` strings split on the first slash.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Reliability loop](../durash-reliability-loop/README.md) — the engine the enabled policy starts.
- [Reliability handoff tool](../durash-tool-reliability/README.md) — the model-facing consumer gated by this policy.
- [Composer switch](../../client/ui-reliability/README.md) — the Web chip that writes this policy.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the reliability handoff tool: this package stores enablement and lane selectors; the tool owns the prompt section and schema.

#### KV Cache effect

Turning the policy on or off changes whether the handoff guidance section is assembled into the request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Effort is stored, not applied** — the switch records implementation and review thinking levels; the worker-thread engine still defers `effort` on `agent()`, so stage children inherit the parent's reasoning settings.
- **No live catalog event** — the client re-reads on open; a provider added while the panel is open does not appear until the next ensure.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
