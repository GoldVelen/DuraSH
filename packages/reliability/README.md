---
description: "The reliability group map: the DuraSH-owned reliability engine family, currently one bounded implement/review loop with product-owned durable state, for users and maintainers navigating the group."
kind: "package-group"
---

# packages/reliability

English | [中文](README.zh.md)

## Summary

The reliability group holds DuraSH-owned orchestration policies that turn raw model work into certified outcomes. Its first member is the bounded implement/review loop: one implementation stage, one review stage, and at most one rework cycle, driven over `ctx.workflowEngine` with the loop's state machine persisted as product-owned records in the storage-domain form. The group composes only into the `durash` profile; it adds no model-facing tool and no agent-loop behavior. Nothing here re-implements a workflow engine or a subagent provider — those seams stay the sole execution path, and this group owns only the durable state machine and its bounds.

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

Deferred directions: a model-facing consumer tool for the loop; member-level durable progress projection; coordination and three-way review stages; and durable execution for the workflow engine itself, which remains process-local.

</details>
