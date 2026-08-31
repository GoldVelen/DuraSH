---
description: "Model-facing reliability-loop handoff tool, gated by the per-session composer workflow switch."
kind: "package-reference"
---

# @durash/dsh-tool-reliability

English | [中文](README.zh.md)

## Summary

`dsh-tool-reliability` registers `dsh_reliability_handoff`. The tool is present process-wide and fails closed unless this Session's composer switch is on. When enabled, it persists one reliability loop with the Session's exact implementation and review lanes and returns its durable acceptance receipt immediately; the Host continues implementation and review in the background.

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

Compose this plugin in the `durash` profile with `ctx.reliabilityPolicy` and `ctx.reliabilityLoopRuntime`. The guidance section is assembled only for a root agent whose Session policy is enabled.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The tool requires the exact live root Agent inside its active driver and verifies that the current open turn originated from direct human input. It trims and validates the objective, revalidates both policy lanes against the live model catalog, calls `startDetached()`, and returns `{ loopId, revision, status: 'accepted' }`. The tool signal, turn ending, browser disconnect, and outer code-runtime timeout do not cancel the loop. Progress comes from the Session status projection; cancellation is an explicit authenticated Remote action.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Reliability policy](../durash-reliability-policy/README.md) — the switch's Host truth that gates this tool.
- [Reliability loop](../durash-reliability-loop/README.md) — the engine this tool starts.
- [Tool catalog](../../../docs/tool-catalog.md) — generated schema for `dsh_reliability_handoff`.

-----

<a id="model-experience"></a>
## Model Experience

### Request context and condition

#### What the model sees

The `tool:reliability-handoff` system-prompt section is assembled for a root agent whose Session policy is enabled. Disabled Sessions receive no section.

##### Reliability handoff guidance

```markdown
For this Session the reliability workflow is enabled. Analyze the direct human request, present a concise implementation plan in the same Step, then call dsh_reliability_handoff once with the complete objective. The call returns a durable acceptance receipt; implementation and review continue under Host ownership after this model turn ends. Do not poll, repeat the handoff, or narrate live telemetry. The composer status bar shows progress and the conversation receives one persistent terminal result. Ordinary questions and read-only review stay on this Session and do not hand off.
```

#### Token effect

Conditional: the section is present only while the Session policy is enabled.

#### KV Cache effect

Enabling or disabling the composer switch adds or removes this section from the request prefix.

### Tool schema

#### What the model sees

The generated [tool catalog](../../../docs/tool-catalog.md#durashdsh-tool-reliability) owns the `dsh_reliability_handoff` schema. This package's description tells the model to present a plan first, then call with the complete objective. The model sees the catalog entry for `dsh_reliability_handoff`.

#### Token effect

The tool schema is always registered; guidance that names it is conditional as above.

#### KV Cache effect

Schema membership is process-wide; only the guidance section moves with the Session policy.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No first-turn intake contract check** — the 3081-era required field labels in the visible plan are not re-enforced here; guidance asks for a plan, and the Host only attests a live root human turn.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
