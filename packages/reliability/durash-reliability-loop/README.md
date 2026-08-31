---
description: "The Host-owned DuraSH reliability loop: fast durable handoff, one bounded implement-review-rework cycle, restart recovery, Session status, and explicit cancellation over ctx.workflowEngine."
kind: "package-reference"
---

# @durash/dsh-reliability-loop

English | [中文](README.zh.md)

## Summary

`dsh-reliability-loop` owns one bounded background reliability cycle: a fresh implementation child, a fresh independent review child, and — when requested — exactly one rework and re-review. `startDetached()` persists an `accepted` record and returns before a stage settles. The Host then owns execution independently of the initiating model turn, tool signal, and browser connection. One version-2 record in the `reliability_loop` storage domain is the execution truth; `reliability-loop/change` events are whole-value Session projections for the status dock and one terminal Conversation result. Host teardown suspends work for recovery; only explicit authenticated cancellation writes `cancelled`.

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

Start a loop when work must be certified by an independent review before it counts, and the certification policy — one rework, bounded handoffs, durable progress — should be deployment-owned rather than left to a script or the model. The runtime is a composition plugin on the `durash` profile: it needs `ctx.workflowEngine`, `ctx.storageDomain` (the storage family), and a parent agent supplied by the caller.

### Starting, observing, and cancelling

`ctx.reliabilityLoopRuntime.startDetached({ parent, objective, implementation, review })` validates the exact live root Agent, persists the complete lanes at revision 1 and stage `accepted`, claims the single driver, publishes Session status, and returns `{ loopId, revision, status: 'accepted' }`. A concurrent start for that Session returns the existing active ref instead of creating a second writer.

`details`, `cancel`, and `dismiss` are authenticated Typert Remotes. Each checks the exact live Agent, Session ownership, and loop id. Mutating `cancel` and `dismiss` additionally require the current revision; read-only `details` returns the latest owned record so a terminal Conversation node still works after its dock is dismissed. Cancellation waits for workflow worker and child disposal before returning the terminal view; dismissal hides only the currently visible terminal record and never deletes history.

### Restart recovery

The record is the single authoritative execution state. When a root Agent is created, the runtime adopts its one non-terminal record, republishes any missing derived Session state, and re-runs only the first unsettled stage. Settled reports are retained. Host or Agent teardown suspends the current run without changing the non-terminal stage; it never impersonates user cancellation.

### Stages and the bounded rework

Each stage is one workflow run with a fixed script and one fresh child. The implementer returns `{ summary }`; the reviewer returns `{ verdict, feedback }`. A `changes-requested` verdict on round one starts the rework: the rework implementer receives the reviewer's feedback, and a round-two reviewer verifies exactly that feedback. Round two still requesting changes stops the loop `blocked`, with the final feedback as the durable blocker. A child failure, an unusable report, or a run failure stops the loop `failed`; `cancelled` is reserved for an actual cancellation.

### The handoff bound

`maxHandoffChars` (default 16384) bounds every artifact crossing a stage boundary — the objective, an implementation summary, reviewer feedback. An oversized artifact fails the stage loud instead of being truncated or accumulated into the next stage's context: each stage child starts fresh and receives only the bounded handoff, never the parent conversation or prior stage transcripts.

### Config

| Field | Default | Meaning |
|---|---|---|
| `maxHandoffChars` | `16384` | Cross-stage artifact bound in characters; oversized artifacts fail the stage loud. |

The generated [configuration catalog](../../../docs/config-catalog.md#durashdsh-reliability-loop) is the exhaustive source for every accepted field.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains how the state machine, durability, and lifecycle are split; observable behavior is fully covered in [Use this package](#use-this-package).

### Design concept

One loop is one version-2 record: the `loops` table of the `reliability_loop` domain holds Session ownership, a positive revision, both immutable lanes, both rounds, stage, and lifecycle times. Every transition replaces that record once. `workflow/*` events stay observe-only; the driver derives transitions from its `run.result`. The Session event is a derived display projection and is never read to advance execution.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Host runtime: detached start, adoption, Remotes, projection publication, teardown ordering |
| [`src/types.ts`](src/types.ts) | Client-safe identity, lanes, records, status, details, and terminal notice vocabulary |
| [`src/spec.ts`](src/spec.ts) | The `defineDomain` declaration and zod schemas |
| [`src/scripts.ts`](src/scripts.ts) | Fixed stage scripts, prompt builders, report validation |
| [`src/driver.ts`](src/driver.ts) | The per-loop writer: stage machine, terminal/suspended settlement, run lifecycle |
| [`src/projection.ts`](src/projection.ts) | Whole-value Session projection with revision rollback rejection |
| [`src/client.ts`](src/client.ts) | Browser-safe Typert Remote declaration |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion: stage/round coherence |

### Lifecycle and ownership

One live driver owns one loop. The runtime observes every driver result before starting it, so stage, provider, worker, and storage failures cannot become unhandled rejections that terminate the Host. Explicit user cancellation and Host suspension are different settlement modes: cancellation writes one terminal after quiescence; suspension disposes the current run and leaves its durable stage recoverable. Teardown stops all drivers and drains mutations before the domain closes.

### Failure discipline

Every loop-internal failure lands in the record as `failed`, including child failure, workflow error, worker death, invalid reports, and provider cancellation without a local stop request. A derived Session append failure cannot roll back the already committed domain record; Agent adoption reconciles the missing projection later.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Reliability group map](../README.md) — the family this package starts.
- [Workflow subsystem](../../../docs/subsystems/workflow.md) — the run seam every stage executes on.
- [Storage domain form](../../../packages/storage/storage-domain/README.md) — the durable record medium and its write chain.
- [INTEGRATION_STATUS](../../../INTEGRATION_STATUS.md) — the migration state of the reliability engine on this baseline.
- [Reliability loop Agent Note](../../../.agents/notes/implemented/feature/2026-08-30-durash-reliability-loop-first-slice.md) — the design decisions behind the first slice.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the workflow engine and subagent providers that assemble every stage child request; the runtime contributes no prompt, schema, or result rendering of its own.

#### KV Cache effect

No direct invalidation; the workflow engine and the subagent providers own any request-prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No model-facing entry in this package** — the composer switch, Session policy, and `dsh_reliability_handoff` tool live in sibling packages in this group.
- **No member-level durable progress** — the record persists stage transitions, not per-child progress inside a stage run; the workflow engine journals nothing, so a crash mid-stage re-runs that stage.
- **One implementer, one reviewer** — no coordination stage, three-way review, or per-stage fan-out; those pipeline shapes remain old-fork history on this baseline.
- **Blocked is final** — a `blocked` loop needs a new loop; there is no durable `needs_replan` round vocabulary yet.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open directions that are not decided. It is explicitly non-authoritative — shipped behavior, limits, and accepted rationale live in the sections above, the package code, and the linked Agent Notes.

Deferred directions: member-level durable workflow progress, `needs_replan` vocabulary above the blocked stage, multi-path review aggregation, and multi-attempt records if the single rework bound ever generalizes.

</details>
