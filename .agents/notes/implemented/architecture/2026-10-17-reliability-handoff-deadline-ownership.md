# Agent Note: Reliability handoff deadline ownership

Status: implemented

English | [中文](2026-10-17-reliability-handoff-deadline-ownership.zh.md)

## Problem

A PTC Session can call `dsh_reliability_handoff` only from inside `run_code`. That program's elapsed deadline, default 120 seconds and capped at 600 seconds, includes nested tool waits. When the deadline fires, `run_code` aborts the nested call. The handoff treated that abort as cancellation, wrote a terminal `cancelled` record, and killed the in-flight stage. The model then saw `execution deadline reached` and implemented the objective itself. A reliability loop cannot finish implementation and review inside that budget, so every enabled workflow stopped before review.

## Decision

The reliability loop is owned by `ctx.reliabilityLoopRuntime`, not by the enclosing `run_code` deadline. `dsh_reliability_handoff` sets `runCodeDeadline: 'excluded'`. `run_code` pauses the caller's `deadlineControl` for that wait, so paused time is not charged and the same call can return the terminal record. A deadline abort, recognized as `run_code settled` or `execution deadline reached`, does not cancel the loop. `handoff({ parent, objective })` attaches to that owner's live driver or resumes its newest unsettled record from the current stage. User cancellation still cancels. One unsettled stage still re-runs after a crash; settled attempts are not repeated.

This note extends the [composer workflow switch](../feature/2026-08-31-durash-composer-workflow-switch.md). That note still owns the switch, policy row, and route selection.

## Alternatives considered

**Raise the run_code cap.** A longer wall clock still ends the loop before a Mac or keyboard implementation finishes, and it would weaken the deadline for every other program.

**Require milestone reports from the child.** Reading, understanding, and idea phases have no checkable completion. The observed children were still reading when the 600 second deadline fired, so a "finished reading" report would not have saved the run. Reporting inside the same `run_code` call does not move the deadline.

**Let the parent sequence short stages.** That puts ordering back on the Session that left the workflow after the timeout. The loop runtime already owns planning, implementation, testing, and review.

## Consequences

A handoff can outlive the enclosing program budget when the rebuilt runtime is loaded. A repeated handoff with the same objective collects the live loop or the result parked after a deadline; a different objective is rejected while that loop is unfinished. Program settlement that is not a deadline cancels the loop. User stop still cancels, including after a deadline abort, because the handoff follows the turn signal rather than the run_code deadline signal. A deadline does not by itself return the terminal record to the model: the enclosing run_code still reports the timeout, and the next same-objective handoff collects the parked result. Mid-stage child progress is not journaled, so a crash re-runs the unsettled stage. Packaged Desktop resolves these packages from the application bundle, not from a profile copy, so none of this runs until that bundle is rebuilt.
