---
description: "DuraSH reliability UI: exact-model workflow policy, the conversation.input.dock status bar, authenticated controls, and one terminal Conversation Node."
kind: "package-reference"
---

# @durash/dsh-client-ui-reliability

English | [中文](README.zh.md)

## Summary

This package renders the DuraSH reliability controls. The **Workflow** chip in `conversation.input.left` selects exact implementation/review models and each model's supported reasoning effort. `ReliabilityStatusDock` occupies `conversation.input.dock` at order `-10`, stays absent with no current view, and shows the persisted stage above the composer. Authenticated details, cancel, and dismiss actions use the generated loop Remote. A stable loop-id Conversation Node renders one terminal result without live telemetry or another model call.

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

Mount this plugin with the conversation, chat, Session, locale, slots, and generated policy/loop Remotes. The policy chip is always visible in a Session composer. Off is the default; enabling requires both lanes and only the effort ids offered by each exact model. The status dock renders only while the Session projection has a current loop.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

A process-wide controller caches per-Session policy snapshots. The policy chip loads on mount, ensures the live catalog when its panel opens, preserves invalid saved choices with a visible error, and refuses to enable them. Model listing is grouped by provider; an effort menu appears only when the selected model exposes reasoning controls.

The status dock reads `reliabilityLoop` from the active Session projection. It renders all nine stages, a single-line objective summary, a polite live region, keyboard focus, reduced-motion behavior, and a narrow layout that hides the summary before the actions. Details are loaded on demand. Cancel requires a second confirmation; dismiss uses the exact visible revision. The terminal definition ignores non-terminal events and keys each node by loop id.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Reliability policy](../../reliability/durash-reliability-policy/README.md) — Host row the chip reads and writes.
- [Reliability handoff tool](../../reliability/durash-tool-reliability/README.md) — model-facing entry the switch gates.
- [ui-conversation](../ui-conversation/README.md) — declares the input slots and Conversation Node engine.
- [Reliability loop](../../reliability/durash-reliability-loop/README.md) — owns the projected status and authenticated controls.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the reliability-policy Remote the chip writes: the handoff tool owns the model-visible guidance and schema that follow from enablement.

#### KV Cache effect

Enabling or disabling the switch changes whether the handoff guidance section is assembled into the request prefix; the chip itself adds no prompt content.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No Runs console** — 3081's sidebar Runs history is not part of this switch; diagnostics stay in the reliability-loop records.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
