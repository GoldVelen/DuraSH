# Agent Note: Host-owned reliability loop and derived Session status

Status: implemented

English | [中文](2026-08-31-host-owned-reliability-loop.zh.md)

## Problem

The first DuraSH reliability slice made the model-facing tool await the complete implement-review-rework loop. Calls that crossed the code runtime's 600000 ms wall-clock ceiling inherited its abort signal, cancelled the still-running loop, and produced six observed false `cancelled` records. Host and Agent teardown used the same cancellation path, so process lifecycle could also be recorded as user intent. The browser exposed only the policy switch, not durable stage status, and saved reasoning effort stopped at the policy row instead of reaching the workflow child. Provider, stream, worker, and context failures therefore needed a single containment design rather than a larger timeout or another copy of the old 3081 executor.

## Decision

The version-2 reliability loop is Host-owned after a fast durable handoff.

- `startDetached()` authenticates the exact live root Agent, writes a version-2 record at `accepted`, claims its single driver, publishes status, and returns a revisioned acceptance receipt before a stage settles. The tool never awaits the driver or subscribes its abort signal to cancellation.
- The `reliability_loop` domain record is the sole execution truth. It owns Session identity, revision, complete immutable lanes, both rounds, stage, and lifecycle times. Pre-release version-1 media is rejected; it is neither rewritten nor inferred.
- `reliability-loop/change` is a whole-value, log-only Session projection derived after the domain write. It supports reconnectable status and one terminal Conversation Node but never advances execution. Agent adoption repairs a missing projection from the domain.
- User cancellation and Host suspension are separate operations. Authenticated cancellation waits for worker and child quiescence and writes one `cancelled` terminal. Agent or service teardown suspends the active run, preserves its non-terminal stage, and lets later Agent adoption re-run only that first unsettled stage.
- Every driver result is observed before driving starts. Child, provider, workflow-worker, report, and storage faults are contained; when the record remains writable they settle that loop as `failed` without terminating the Web Host.
- Policy uses live exact-model capability metadata, preserves invalid saved values with a validation error, and never silently changes effort. Panel reads resolve the directory concurrently; handoff revalidation touches only the two selected routes so unrelated catalog latency cannot delay durable acceptance. The generic workflow worker carries `reasoningEffort` through its typed protocol into child `AgentOptions`.
- Stage children join the parent's exact preset generation. Token metering, replay-safe tool-result pruning, and compaction therefore remain generic preset capabilities; no workflow-specific timeout, overflow engine, or old 3081 executor is restored.

The browser registers a compact order-`-10` status dock above the composer. It renders the current Session only, covers all stages, loads Session-authenticated details on demand, confirms cancellation, and dismisses one exact terminal revision. Detail reads return the latest owned record rather than using revision as a write guard, so the stable loop-id terminal node remains useful after its dock is dismissed. The node renders once without calling another model or filling the main chat with live telemetry.

## Alternatives considered

- **Raise or remove the 600000 ms code-runtime ceiling.** Rejected because it preserves the wrong owner: turn end, browser disconnect, or any later outer cancellation would still control a durable workflow. The handoff must finish before the ceiling, not redefine the ceiling.
- **Make Session events the execution store.** Rejected because it creates a second state machine or forces control recovery to depend on model-history storage. The domain record remains authoritative; the Session event is explicitly replaceable display state.
- **Poll a status Remote from the browser.** Rejected because it ties updates to connection lifetime and does not provide a replayable once-per-loop terminal result. Whole-value events already fit Session refresh and reconnect behavior.
- **Restore the old 3081 workflow executor or special-case Grok.** Rejected because both create duplicate policy. Current preset composition already owns context resilience, and adapter metadata already owns exact-model effort capability.

## Consequences

A successful handoff no longer consumes the outer tool's long-running interval. Host teardown is no longer falsely visible as user cancellation, and a workflow failure remains scoped to one durable loop. Refresh and restart can rebuild the status dock and terminal result from persisted facts. The cost is an explicit version-2 on-disk break during pre-release, a derived Session event that must remain synchronized with SDK consumers, and a stage-level recovery granularity: because the generic workflow engine does not journal script-internal progress, a crash still re-runs the first unsettled stage.

The current product remains one implementer, one independent reviewer, and at most one rework. Planning coordination, multi-path review aggregation, member-level durable progress, and automatic cost scheduling remain outside this decision.

## Testing

Focused tests pin fast acknowledgement, duplicate-start ownership including a terminal-write/index race, both rounds, explicit cancellation, suspension and adoption, terminal de-duplication, stale writes and cross-Session reads, persistent terminal details after dismissal, projection rollback rejection, storage and child-failure containment, selected-route-only handoff validation, workflow `reasoningEffort` transport, exact-model policy drift, Grok 4.6 low/medium/high/xhigh capability, all status stages, slot order, terminal-only Conversation nodes, and standard-preset inheritance of token meter, tool-result pruner, and compaction.
