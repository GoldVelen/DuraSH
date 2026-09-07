# Agent Note: Persistent upstream-sync blocks, Client reliability Remote, and DuraSH tool catalog

Status: implemented

English | [中文](2026-09-06-durash-sync-block-reliability-remote-catalog.zh.md)

## Problem

Whole-tree `git merge` of DeepSeek Harness `master` remains the DuraSH sync mode. The six-hour workflow retried that merge, then treated every non-zero `git merge` as a text conflict, commented again, and failed the cron. Identical overlay conflicts therefore produced repeated failure mail. Upstream `dsh-api-remotes` also compiled in the DuraSH reliability Remote, so every remotes assembly change collided with a product-owned namespace. The shared tool-catalog generator mixed DuraSH `durash-tool-*` boot recipes into the upstream default list, so upstream exact-name tests and DuraSH product docs shared one hotspot.

## Decision

Keep primary-merge, the six-hour schedule, `automation/upstream-sync`, and opt-in auto-merge. Classify a non-zero merge as a text conflict only when git records unmerged paths. Persist the block on the dedicated conflict issue as a machine-readable HTML comment keyed by a fingerprint of those paths. The first report comments or creates the issue and fails the job. An unchanged fingerprint updates the issue body and run summary, does not comment, and does not fail the cron. A new fingerprint reports again. Network, permission, install, and merge errors without unmerged paths stay visible. Closing the issue happens when the merge is clean; a prepared PR is not a product-check pass.

Mount `@durash/dsh-reliability-policy/remote` from `@durash/dsh-client-ui-reliability`: plugin `inject` waits on `remote`, `apply` mounts the generated contribution, then `ctx.inject(['remote.reliabilityPolicy', ...])` creates the UI. Upstream remotes keep every other Remote. DuraSH consumers import `/remote` directly.

Keep `scripts/gen-tool-catalog.ts` as the upstream `packages/*/tool-*` generator. DuraSH tools use `scripts/gen-durash-tool-catalog.ts` and `docs/durash-tool-catalog.md`. Completeness still fails when a package with `package.json` is missing from the matching boot list, and harvest still fails when a listed plugin registers no tool. Expected tool names stay authored in tests, not copied from the same harvest.

## Alternatives considered

- Lowering cron frequency, or treating every merge non-zero as a known conflict. Rejected: monitoring must keep retrying, and non-conflict failures must stay visible.

- A runner cache or extra database for block state. Rejected: the dedicated issue already outlives a job.

- Moving the Remote mount into the Host profile entry. Rejected: the Client assembly owns generated `/remote` contributions.

- Copying the whole catalog generator, or deriving expected names from one harvest. Rejected: upstream default range must stay upstream, and DuraSH acceptance must be independently authored.

## Consequences

Identical text conflicts stop repeating comments and cron failure mail. The issue and job summary still say the tree is blocked, not that product checks passed. Target-branch commits that do not change unmerged paths keep the fingerprint. Resolution-logic changes still retry because every run merges again.

`dsh-api-remotes` no longer depends on `@durash/dsh-reliability-policy`. The composer chip still injects `remote.reliabilityPolicy` after mount. Host policy, the `durash` profile, and `INERT_LEGACY_EVENT_TYPES` are unchanged.

`docs/tool-catalog.md` no longer lists `dsh_reliability_handoff`. `docs/durash-tool-catalog.md` does. Package READMEs that document that schema link the DuraSH catalog.

## Verification

- `scripts/upstream-sync-block.spec.ts`: real git text conflict, target-branch update with the same files, a new conflicting file, a non-conflict merge object, first/known/changed GitHub decisions, resolve, and CLI report/resolve.

- `packages/client/ui-reliability/tests/browser-plugin.client.spec.ts`: mount, UI registration, dispose, registration failure rollback, remount without duplicate namespace.

- `packages/core/tools/tests/gen-tool-catalog.spec.ts` and `packages/reliability/durash-tool-reliability/tests/gen-durash-tool-catalog.spec.ts`: independent expected names; empty DuraSH glob names `durash-tool-reliability`; empty upstream glob names `tool-bash` and not the DuraSH package.

- Existing reliability-loop, policy persistence, and session-format suites remain the owners of handoff, restart reads, and v0/v1/v2 plus inert legacy events. Live GitHub issue/comment mail, a headed browser against this GUI, and paid model calls are not claimed by those suites.
