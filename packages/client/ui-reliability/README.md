---
description: "Composer workflow switch: the conversation.input.left chip that enables the reliability loop and picks implementation and review models."
kind: "package-reference"
---

# @durash/dsh-client-ui-reliability

English | [中文](README.zh.md)

## Summary

This package renders the composer **Workflow** on/off chip. Opening it shows the next-workflow settings: implementation model and effort, review model and effort, over the Host reliability-policy catalog. The chip occupies `conversation.input.left` and writes only through the generated `reliabilityPolicy` Remote. It composes only into the `durash` client profile.

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

Mount this plugin with the conversation input-left list and the reliability-policy Remote. The chip is always visible in a Session composer. Off is the default; turning it on requires both lanes to name catalog models.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

A process-wide controller caches per-Session snapshots. The dock loads on mount, ensures the catalog when the panel opens, and refuses to enable an incomplete selection. The panel is body-portaled and anchored above the composer through the shared positioning primitives; effort uses the shared portaled `Menu`, and the model directory has its own body portal so the panel's scroll region cannot clip either choice surface. The panel and model picker use the shared prominent elevation stroke, neutral control outlines use the shared 0.5px hairline, and the status pill keeps circular corners. Model listing is grouped by provider; a Cursor channel switch appears only when a `cursor` provider is in the catalog.

No runtime invariant companion is published because the Host policy service owns the authoritative state; this browser projection has no independent durable event stream or second state source.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Reliability policy](../../reliability/durash-reliability-policy/README.md) — Host row the chip reads and writes.
- [Reliability handoff tool](../../reliability/durash-tool-reliability/README.md) — model-facing entry the switch gates.
- [ui-conversation](../ui-conversation/README.md) — declares `conversation.input.left`.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the reliability-policy Remote the chip writes: the handoff tool owns the model-visible guidance and schema that follow from enablement.

#### KV Cache effect

Enabling or disabling the switch changes whether the handoff guidance section is assembled into the request prefix; the chip itself adds no prompt content.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No Runs console** — 3081's sidebar Runs history is not part of this switch; diagnostics stay in the reliability-loop records.
- **Effort is stored, not applied** — the panel records thinking levels that the current workflow engine does not yet pass to stage children.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
