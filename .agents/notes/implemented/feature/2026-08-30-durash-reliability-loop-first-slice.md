# Agent Note: DuraSH reliability loop — first vertical slice

Status: implemented

English | [中文](2026-08-30-durash-reliability-loop-first-slice.zh.md)

## Problem

DuraSH inherited the current DeepSeek Harness workflow seam, which executes orchestration scripts but journals nothing: a run's progress dies with the process, and no product-level state machine exists on top of it. The old downstream fork had solved this with its own ~18k-line orchestration stack (a persistent Run store, a fixed implement/coordinate/three-way-review pipeline, and bounded rework with a durable `needs_replan` stop), and copying that stack onto the new baseline would have recreated a hard fork a thousand upstream commits behind. The reliability engine therefore needed a first vertical slice that proves durable product state, one bounded review-rework cycle, restart recovery without task duplication, and cancellation quiescence — without rebuilding the old orchestration layer or modifying upstream packages.

## Decision

`@durash/dsh-reliability-loop` (packages/reliability/durash-reliability-loop, composed only into the `durash` profile) implements one bounded implement-review-rework cycle over `ctx.workflowEngine`:

- **One loop is one durable record.** The `reliability_loop` storage domain (opened over the storage family the base bundle already mounts) holds one record per loop in its `loops` table; the record carries the objective, the current stage, and the settled attempt slots. Every stage transition is a single-record durable write, and the record is the only thing recovery reads. The later Session projection is derived display state, never a second execution store.
- **The workflow seam stays the only execution path.** Each stage is one run with a fixed script and one fresh child; the driver derives transitions from the run handle it owns (`run.result`), not from the observe-only `workflow/*` events, so a stage has exactly one live fact source. The runtime contributes no engine, provider, or agent-loop behavior.
- **The rework bound is one.** A round-one `changes-requested` verdict starts exactly one rework pass whose implementer receives the reviewer feedback, verified by a round-two reviewer. Round two still requesting changes stops the loop `blocked` with the feedback as the durable blocker; any other failure stops it `failed`.
- **Recovery re-runs only the unsettled stage.** Agent adoption drives the machine from the record's current stage; settled summaries and verdicts are never re-run, and single ownership makes re-execution once for the unsettled attempt. Adoption always uses the exact live owning Agent — the runtime never fabricates one.
- **Cancellation converges and differs from suspension.** Explicit user cancellation cancels the in-flight run, disposes it, writes the terminal record, and settles. Service or Agent teardown suspends the run without a false terminal, then awaits every driver before the domain closes.
- **Bounded handoffs answer the old overflow failure.** `maxHandoffChars` bounds every artifact crossing a stage boundary (objective, implementation summary, reviewer feedback); oversized artifacts fail the stage loud, and each stage child starts fresh — the parent conversation and prior transcripts never accumulate into a reviewer's context.

`INTEGRATION_STATUS.md` records the migrated rows and their remaining boundaries honestly.

## Alternatives considered

- **Persist execution state as session events in the parent log.** Rejected because it couples recovery to model-history storage and creates a second execution source. The later `reliability-loop/change` event is intentionally a whole-value display projection derived from the domain, never the state machine.
- **Copy the old fork's RunStore and pipeline.** Rejected before design began: it would have reintroduced an 18k-line orchestration stack, a parallel execution model, and a hard fork against the current baseline. The slice reuses the workflow engine for execution and rebuilds only the durable control plane the fork's store provided.
- **Resume at plugin mount without a live owning Agent.** Rejected because it would fabricate attribution. The later Host-owned runtime adopts only after the exact root Agent exists, which provides automatic recovery without violating this constraint.
- **Derive transitions from `workflow/*` events.** Listening to the event bus as the transition source would duplicate the run handle's settlement fact and re-introduce exactly the two-sources-for-one-truth problem the record is meant to end. The events remain available to UI listeners; the loop does not consume them.

## Consequences

The later [Host-owned reliability-loop decision](2026-08-31-host-owned-reliability-loop.md) supersedes this slice's caller-owned handle, explicit-resume, teardown-cancellation, and no-Session-projection details. This note continues to own the fixed-stage, one-domain-record, bounded-handoff, and no-old-executor decisions.

The baseline now ships a verified durable control plane for bounded certification work: focused regressions cover the durable stage machine, the single rework, restart recovery, repeated-interruption idempotence, cancellation quiescence, and runtime teardown ordering — all over the real worker-thread engine, the real JSON storage backend, and a crash simulated by an injected durable-write failure. What this slice deliberately does not provide inside the loop package: member-level durable progress inside a stage run (the engine journals nothing, so a mid-stage crash re-runs that stage), coordination or three-way review stages, a `needs_replan` round vocabulary beyond the blocked stage, and durable execution for the workflow engine itself. The model-facing consumer — composer switch, Session policy, and `dsh_reliability_handoff` — is the later [workflow-switch note](2026-08-31-durash-composer-workflow-switch.md).

## Testing

`packages/reliability/durash-reliability-loop/tests/loop.spec.ts` runs the real composition (worker-thread engine + storage family + runtime) with a manual child provider and asserts: the end-to-end approved path, the single bounded rework to `completed` and to `blocked`, loud `failed` stops, restart recovery without re-running settled work, repeated interruption never duplicating attempts, cancellation and teardown quiescence, start/resume refusal rules, and the record invariant's rejection of incoherent stored states.
