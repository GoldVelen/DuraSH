---
description: "The DuraSH reliability loop: one bounded implement-review-rework cycle with product-owned durable state, restart recovery, and cancellation quiescence over ctx.workflowEngine."
kind: "package-reference"
---

# @durash/dsh-reliability-loop

English | [中文](README.zh.md)

## Summary

`dsh-reliability-loop` runs a fresh implementation child and independent review child. A request for changes permits exactly one rework pass and re-review, then stops `completed` or `blocked`. One record in the `reliability-loop` storage domain persists the state machine; stages execute on `ctx.workflowEngine`, while this runtime owns the record, bounds, and sequencing. Restart resumes the first unsettled stage without repeating settled attempts. Cancellation leaves a terminal record and no live owner.

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

`ctx.reliabilityLoopRuntime.start({ parent, objective })` writes the loop's durable record first (stage `implementing`) and returns a handle. The handle's `result` settles with the terminal record; `cancel(reason?)` stops the in-flight stage run and settles `cancelled`; `dispose()` cancels if needed and awaits durable settlement plus run disposal. A settled attempt is kept even when a later cancellation lands.

### Restart recovery

The record is the single authoritative state. After a process restart, `resume(loopId, parent)` drives the state machine from the record's current stage: settled implementation summaries and review verdicts are never re-run; the first unsettled stage re-runs exactly once, because one live driver owns one loop and a second `resume` on the same loop fails loud. `list()` and `get()` project the durable records.

### Stages and the bounded rework

Each stage is one workflow run with a fixed script and one fresh child. The implementer returns `{ summary }`; the reviewer returns `{ verdict, feedback }`. A `changes-requested` verdict on round one starts the rework: the rework implementer receives the reviewer's feedback, and a round-two reviewer verifies exactly that feedback. Round two still requesting changes stops the loop `blocked`, with the final feedback as the durable blocker. A child failure, an unusable report, or a run failure stops the loop `failed`; `cancelled` is reserved for an actual cancellation.

### The handoff bound

`maxHandoffChars` (default 16384) bounds every artifact crossing a stage boundary — the objective, an implementation summary, reviewer feedback. An oversized artifact fails the stage loud instead of being truncated or accumulated into the next stage's context: each stage child starts fresh and receives only the bounded handoff, never the parent conversation or prior stage transcripts.

<a id="task-acceptance-evidence"></a>
### Task acceptance evidence

Declare requirements through [`dsh_acceptance`](../durash-tool-reliability/README.md) before validation. User requirements cite actual human messages; their promised outcome, evidence level, required flag, skip preconditions, logical target constraints and external boundary cannot silently change. Commands, source scopes, per-test skip bindings and target build digests/selectors remain adjustable validation plans: revisions preserve the previous definition and factual reason, invalidate affected receipts, and enter semantic review.

The executor records command, cwd, start/end times, exit status, raw results and artifact hashes. Git identity includes scoped tracked/untracked bytes, deletions and executable modes; HEAD is diagnostic only. Before/after identities must agree. Documentation outside the declared inputs does not invalidate check evidence. Tests can require a build check with `buildCheckId`; its source and `produces` artifact bytes must remain current. A focused pass cannot replace the latest failed required full-suite check.

Pytest JUnit and xcresult summary/test-tree results must parse completely. Commands and report paths contain `{run}` for fresh reports, outside source inputs. Every skip needs a `skipBindings` entry matching its exact observed `testId` and `reason`, linked by `prerequisite` to a check in `allowSkipIf` with current non-skipped passing evidence. Unmatched skips and old totals-only receipts remain unverified. JUnit skip ids encode `[classname || suiteName || "", testcaseName]` as JSON; XCTest uses its test node identifier. Missing or ambiguous identities/reasons remain unverified. UI checks need test results and observable-result attachments; logs and file existence do not qualify. Attachments are rehashed before acceptance. Independent review decides whether the tests and attachments actually establish the user outcome.

Trusted target adapters register through `registerTargetAdapter`; models cannot submit successful observations. `ios-local-bundle` reads the `appPath` and embedded `widgetPath` metadata, signed identifiers, shared App Groups, version and content identity. Use `dsh_acceptance` action `target` to observe both `identity` and the content digest. Pin stable `target.constraints` such as `appBundleId`, `widgetBundleId` and `appGroups` (a JSON array string); every constraint must match adapter observations. User constraints and adapter stay fixed. After a rebuild, revise `target.expected` and artifact-path `options` with a reason, then rerun affected checks and review; old evidence cannot pass the new plan. Missing tools, metadata, adapters or unsupported files remain unverified.

Reviewers receive a bounded candidate/diff/receipt index including untracked files and test-standard risks. Added skips, removed assertions, early returns, ambiguous matches and internal-state substitutes are hints requiring semantic judgment. Implementers must give old-test failure evidence, the preserved visible outcome and a negative control with the original defect. Bound workflows require both program checks and independent approval on the same candidate; one unsuccessful rework yields a diagnostic handoff without an automatic escalation model.

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

One loop is one record: the `loops` table of the `reliability-loop` domain holds the whole state machine, so every transition is a single-record durable write and the record is the only thing recovery reads. The `workflow/*` events stay observe-only; the driver derives transitions from the run handle it owns (`run.result`), so a stage has exactly one live fact source. The record's stage and its settled attempt slots are asserted by the `./invariant` companion at every read and write site.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Service entry: start/resume single ownership, config, teardown ordering |
| [`src/types.ts`](src/types.ts) | Vocabulary: loop id, stages, attempt slots, record, handle |
| [`src/spec.ts`](src/spec.ts) | The `defineDomain` declaration and zod schemas |
| [`src/scripts.ts`](src/scripts.ts) | Fixed stage scripts, prompt builders, report validation |
| [`src/driver.ts`](src/driver.ts) | The per-loop owner: stage machine, run lifecycle, cancel, quiescence |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion: stage/slot coherence |

### Lifecycle and ownership

One live driver owns one loop; the runtime enforces it and refuses double ownership loud. Effects unwind in reverse registration order, so teardown awaits every live driver's quiescence before the domain closes — no terminal write lands on a closed medium. The driver owns no timers and no global listeners: after `result` settles, the last run is disposed and the record is terminal, so cancellation converges instead of leaving a background writer.

### Failure discipline

`result` rejects only when the durable record cannot be maintained (a storage fault or an invariant breach); every loop-internal failure lands in the record as `failed`. A `cancelled` run outcome without a local cancel request is a contract violation and stops the loop `failed` rather than being mistaken for a caller cancellation.

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

Indirectly, through stage prompts carrying short evidence rules and a bounded task index, with raw receipts opened on demand and no model calls during direct evidence collection.

#### KV Cache effect

No direct invalidation; the workflow engine and the subagent providers own any request-prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No model-facing entry in this package** — the composer switch, Session policy, and `dsh_reliability_handoff` tool live in sibling packages in this group.
- **Semantic scope** — omitted requirements, misleading commands or incomplete input scopes still need independent review; executor receipts are not a sandbox against malicious writers.
- **Platform and device limits** — probes use POSIX and reject symlinks/submodules. Directory scopes exclude ignored files; declare each ignored configuration input explicitly. Before/after sampling cannot detect a file modified and restored during execution. The iOS adapter verifies local artifacts, not installed-device behavior, permissions or rendered UI; those require a suitable target adapter and observations.
- **Task lifetime** — one active task per Session; a different objective uses a new Session. Persisted unfinished work is never renamed a human prerequisite.
- **No member-level durable progress** — the record persists stage transitions, not per-child progress inside a stage run; the workflow engine journals nothing, so a crash mid-stage re-runs that stage.
- **One implementer, one reviewer** — no coordination stage, three-way review, or per-stage fan-out; those pipeline shapes remain old-fork history on this baseline.
- **Blocked is final** — a `blocked` loop needs a new loop; there is no durable `needs_replan` round vocabulary yet.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open directions that are not decided. It is explicitly non-authoritative — shipped behavior, limits, and accepted rationale live in the sections above, the package code, and the linked Agent Notes.

Deferred directions: member-level progress projection over `workflow/agent-*`; applying stored thinking effort to stage children; `needs_replan` round vocabulary on top of the blocked stage; and multi-attempt attempt slots if the single rework bound ever generalizes.

</details>
