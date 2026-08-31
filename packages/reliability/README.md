---
description: "The reliability group map: the DuraSH-owned reliability engine family, currently one bounded implement/review loop with product-owned durable state, for users and maintainers navigating the group."
kind: "package-group"
---

# packages/reliability

English | [中文](README.zh.md)

## Summary

The reliability group holds DuraSH-owned orchestration policies that turn raw model work into certified outcomes. Its first member is the bounded implement/review loop: one implementation stage, one review stage, and at most one rework cycle, driven over `ctx.workflowEngine` with the loop's state machine persisted as product-owned records in the storage-domain form. The group composes only into the `durash` profile. The loop runtime still adds no agent-loop behavior; the composer switch, per-session policy, and gated handoff tool are the model-facing consumer of that loop. Nothing here re-implements a workflow engine or a subagent provider — those seams stay the sole execution path, and this group owns the durable state machine, its bounds, and the Session policy that admits a handoff.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`durash-reliability-loop`](durash-reliability-loop/README.md) | One bounded implement-review-rework cycle with durable state, restart recovery, and cancellation quiescence | `ctx.reliabilityLoopRuntime` |
| [`durash-reliability-policy`](durash-reliability-policy/README.md) | Per-session enablement and implementation/review model selection for the composer switch | `ctx.reliabilityPolicy` |
| [`durash-tool-reliability`](durash-tool-reliability/README.md) | Model-facing `dsh_reliability_handoff` tool gated by the Session policy | — |

-----

<a id="related-documentation"></a>
## Related documentation

- [INTEGRATION_STATUS](../../INTEGRATION_STATUS.md) — which reliability-engine behaviors are migrated and verified on this baseline, and which remain old-fork history.
- [Workflow subsystem](../../docs/subsystems/workflow.md) — the run seam every stage executes on.
- [Storage domain form](../storage/storage-domain/README.md) — the durable record medium.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open directions that are not decided. It is explicitly non-authoritative — shipped behavior, limits, and accepted rationale live in the sections above, the package code, and the linked Agent Notes.

Deferred directions: member-level durable progress projection; coordination and three-way review stages; applying stored thinking effort to stage children; and durable execution for the workflow engine itself, which remains process-local.

</details>
