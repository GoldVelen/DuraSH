# Agent Note: DuraSH composer workflow switch

Status: implemented

English | [中文](2026-08-31-durash-composer-workflow-switch.zh.md)

## Problem

The 3081 product had a composer **Workflow** on/off chip (`WorkflowPolicyDock` in `ui-runs`) that stored per-session implementation and review models and, when enabled, made the conversation hand work to an independent implement/review loop. DuraSH replaced that Pi orchestrator with `@durash/dsh-reliability-loop` and explicitly deferred the model-facing consumer. Open-sourcing DuraSH without the switch left the loop programmatic only: users could not turn it on from the composer, pick the two models, or have a user turn start certified implement/review work. Copying the retired 3081 `workflow-orchestrator` / `executor-pi` / `dsh-runs` stack onto this baseline would recreate the hard fork the first reliability slice rejected.

## Decision

The `durash` profile mounts three sibling packages around the existing loop:

- `@durash/dsh-reliability-policy` (`ctx.reliabilityPolicy`) — one durable `reliability_policy` row per Session: enabled flag plus `provider/model` selectors and stored thinking levels. Every read rebuilds the catalog from `ctx.llm`; an enabled row whose selectors left the catalog turns off.
- `@durash/dsh-client-ui-reliability` — the 3081 composer chip restored onto `conversation.input.left` (`id: workflow`). It talks only to the generated `reliabilityPolicy` Remote.
- `@durash/dsh-tool-reliability` — `dsh_reliability_handoff`, registered process-wide, fails closed unless the Session policy is on, then starts one loop with the stored implementation and review routes.

The dock selectively restores the proven 3081 presentation without restoring its state model. Its settings panel is portaled to `document.body`, fixed above the composer trigger through the shared `useAnchoredPosition` and `useAnchoredMaxHeight` primitives, and constrained to the viewport. Effort choices use the shared portaled `Menu`; the model directory has its own body portal so neither surface is clipped by the panel's scroll region. All values still come from the current `reliabilityPolicy` snapshot and are saved through its generated Remote.

The loop record now persists optional lane provider/model pairs so resume keeps the same children. Thinking effort is stored on the policy row because the worker-thread `agent()` still defers `effort`.

Every catalog option exposes the same public effort roster, so a missing implementation effort defaults to `high` and a missing review effort defaults to `xhigh`. The per-Session write queue retains only settled tails; one rejected policy operation therefore cannot poison the next public operation.

This is the model-facing consumer the [first reliability-loop slice](2026-08-30-durash-reliability-loop-first-slice.md) deferred. It is not a port of the Pi executor, Runs console, or three-review pipeline.

## Alternatives considered

**Port `ui-runs` plus `workflow-orchestrator`, `dsh-runs`, and `executor-pi` from the 3081 worktree.** Rejected: that stack is the 18k-line orchestration the first slice refused to copy, and `executor-pi` is the closed Pi RPC product this open-source line does not ship.

**A dead composer chip with no Host policy or tool.** Rejected: the 3081 switch's job is to make the next user turn run implement/review, not to display a toggle that writes nothing.

**Keep the panel inside the composer and use native selects.** Rejected: the composer's overflow and right-edge placement clip an in-tree absolute panel, while native select chrome does not match the shared menu presentation. Portals and shared positioning fix those presentation failures without importing old orchestration state.

**Put policy and the tool inside `durash-reliability-loop`.** Rejected: the loop package's contract is the durable stage machine over `ctx.workflowEngine`. Session UI policy and a model-facing tool evolve independently and would mix Host Remote, LLM catalog, and prompt-section ownership into the engine.

## Consequences

A `durash` Web session shows 工作流 / Workflow on the composer. Its settings panel, effort menus, and model directory remain inside the viewport even when the composer sits near the bottom or right edge. Turning it on with both models selected injects handoff guidance and lets the model call `dsh_reliability_handoff`, which starts a reliability loop on the selected routes. Off remains the default. Effort levels in the panel are session-persisted and not yet applied to children. The 3081 Runs console and three-review pipeline stay out of this slice.

## Testing

`packages/reliability/durash-reliability-policy/tests/policy.spec.ts` covers default disabled reads, ensure defaults, enable-only-with-both-lanes, and turning an enabled row off when a saved model leaves the catalog. `packages/reliability/durash-tool-reliability/tests/tool-reliability.spec.ts` covers gated guidance, fail-closed execute, and starting the loop with the Session lanes. `packages/client/ui-reliability/tests/` covers controller incomplete-enable refusal, composer chip and slot registration, body portal ownership, outside and Escape dismissal, shared effort menus, the model-directory portal, selection, and saving through the current policy API. `packages/client/ui-primitives/tests/use-anchored-position.client.spec.tsx` pins the shared above-anchor coordinates and resize observation. `apps/web/tests/durash-workflow-settings.e2e.ts` launches the built DuraSH profile in a narrow browser and opens the lower review fields: the panel, effort menu, and model directory use body portals and stay inside the viewport, the panel enters the right-edge clamp, and both choice surfaces match their shared horizontal clamp. `packages/bundle/durash-web-profile/tests/profile.spec.ts` asserts the overlay inserts the three new rows. The per-file V8 lane excludes only the pure `WorkflowPolicyDock.tsx` component until browser-grade coverage can attribute its portal and geometry branches; the controller, package wiring, and all reliability runtime files remain under the 100% gate, while the jsdom and built-browser checks above own the excluded presentation behavior.
