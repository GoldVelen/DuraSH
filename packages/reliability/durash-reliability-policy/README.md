---
description: "Per-session reliability-loop policy: exact implementation/review models and adapter-owned reasoning efforts, validated against the live Host catalog."
kind: "package-reference"
---

# @durash/dsh-reliability-policy

English | [中文](README.zh.md)

## Summary

`dsh-reliability-policy` is the Host service behind the composer workflow switch. One durable row per Session stores enablement plus exact implementation/review models and reasoning efforts. Policy-panel reads rebuild the directory from `ctx.llm.listModels()` and `resolveModelInfo()`, in parallel across providers and models. Each model therefore exposes only its adapter-declared effort ids, names, descriptions, and default. Catalog drift preserves the saved row and returns a concrete `validationError`; an invalid row cannot enable or start a loop and is never silently downgraded.

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

Mount this plugin with `ctx.storageDomain` and `ctx.llm`. The composer switch calls `policy`, `ensurePolicy`, and `configure` over the generated Remote. `workflowEnabled(sessionId)` is a synchronous prompt gate; asynchronous `enabledRoutes(sessionId)` revalidates only the selected provider/model routes and returns immutable provider/model/reasoning-effort lane snapshots for the handoff tool. A handoff therefore does not wait for unrelated providers or models.

Enabling requires both lanes to name current catalog models. A model with reasoning controls requires one listed effort; a model without them requires `null`. A stale saved selector or effort remains visible for correction but blocks start.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The `reliability_policy` storage domain holds one `sessions` row keyed by Session id. Catalog membership and display metadata are not stored. Mutations queue per Session. Selectors are `provider/model` strings split on the first slash; effort ids are opaque adapter-owned values.

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

- **No live catalog event** — the client re-reads on open; a provider added while the panel is open does not appear until the next ensure.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
