---
description: "Model-facing acceptance evidence and policy-gated reliability-loop handoff tools."
kind: "package-reference"
---

# @durash/dsh-tool-reliability

English | [中文](README.zh.md)

## Summary

`dsh-tool-reliability` registers direct acceptance evidence through `dsh_acceptance` and workflow dispatch through `dsh_reliability_handoff`. The handoff tool is present process-wide and fails closed unless this Session's composer switch is on. When enabled, it starts one reliability loop with the Session's implementation and review routes and waits for a terminal record.

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

Compose this plugin in the `durash` profile with `ctx.reliabilityPolicy` and `ctx.reliabilityLoopRuntime`. Handoff guidance is assembled only for a root agent whose Session policy is enabled; evidence guidance is always available.

-----

### Direct evidence and workflow mode

With the workflow switch off, ask the current model to declare the required checks with `dsh_acceptance` action `plan`, execute them with `run`, and inspect `status`. It keeps the current model, including Grok, and makes no independent model call. The composer displays host checks and “not independently reviewed” even when assistant prose differs. Ordinary questions need no plan.

With the switch on, select implementation and review models, declare the same task requirements, then use `dsh_reliability_handoff`. It automatically binds the active acceptance task. The host rejects completion when checks or candidate/target identities fail despite a model approval. The [runtime reference](../durash-reliability-loop/README.md#task-acceptance-evidence) owns receipt semantics and limits.

Use `status` with `taskId` and `checkId` to inspect a check’s stored definition and raw receipts. Root conversations own plan revisions; only the owning root and its live descendants can run or read a task. Changed host status enters logged plugin context before the next model request.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The tool requires the live root agent, a direct human user message on that Session, and enabled policy routes. Cancellation of the tool signal cancels the live loop. The compact result is the loop's terminal stage, a bounded summary, and the reviewer verdict when one exists.

No runtime invariant companion is published because this tool owns no independent state or event stream; the policy and loop companions own the relationships it consumes.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Reliability policy](../durash-reliability-policy/README.md) — the switch's Host truth that gates this tool.
- [Reliability loop](../durash-reliability-loop/README.md) — the engine this tool starts.
- [DuraSH tool catalog](../../../docs/durash-tool-catalog.md) — generated schema for `dsh_reliability_handoff`.

-----

<a id="model-experience"></a>
## Model Experience

### Request context and condition

#### What the model sees

The `tool:reliability-handoff` system-prompt section is assembled for a root agent whose Session policy is enabled. Disabled Sessions receive no handoff section; evidence guidance remains available.

##### Reliability handoff guidance

```markdown
For this Session the reliability loop is enabled. This tool is the only implementer dispatch path. Never write an execution prompt or copy-paste brief for the human to give to another model or agent. Analyze the human request, present a concise implementation plan in the same Step, then call dsh_reliability_handoff with the complete objective. Ordinary questions and read-only review stay on this Session and do not hand off. The call remains in the current model turn until the loop is completed, blocked, cancelled, or failed; after its compact result arrives, explain that result to the human. If the workflow is disabled, the tool fails closed.
```

#### Token effect

Conditional: the section is present only while the Session policy is enabled.

#### KV Cache effect

Enabling or disabling the composer switch adds or removes this section from the request prefix.

### Tool schema

#### What the model sees

The generated [DuraSH tool catalog](../../../docs/durash-tool-catalog.md#durashdsh-tool-reliability) owns the `dsh_reliability_handoff` schema. This package's description tells the model to present a plan first, then call with the complete objective. The model sees the catalog entry for `dsh_reliability_handoff`.

#### Token effect

The tool schema is always registered; guidance that names it is conditional as above.

#### KV Cache effect

Schema membership is process-wide; only the guidance section moves with the Session policy.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No first-turn intake contract check** — the 3081-era required field labels in the visible plan are not re-enforced here; guidance asks for a plan, and the Host only attests a live root human turn.
- **Thinking effort is not passed to children** — lane models are; effort stays on the policy row until the workflow engine applies `effort`.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
