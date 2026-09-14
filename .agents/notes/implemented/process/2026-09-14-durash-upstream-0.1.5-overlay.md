# Agent Note: Reconcile DeepSeek Harness 0.1.5 onto the DuraSH overlay

Status: implemented

English | [中文](2026-09-14-durash-upstream-0.1.5-overlay.zh.md)

## Problem

The six-hour `Sync verified upstream` workflow could not merge DeepSeek Harness `master` into DuraSH. Each new upstream SHA rotated the unmerged overlay paths, so the persistent-block fingerprint kept changing and GitHub mailed a failure on every cron. Silencing identical fingerprints cannot keep DuraSH on the current DSH line.

## Decision

Merge `c291e7961a515f6d7af9304e7fd1d257929aef26` (`dsh-v0.1.5-rc.2` on `master`) onto the DuraSH overlay in an isolated worktree. Keep the product packages, `durash` profile, Client-mounted reliability Remote, split tool catalogs, `INERT_LEGACY_EVENT_TYPES`, pi-ai `catalogProvider`, and downstream runner prefixes that force `ubuntu-24.04` / `windows-2025` before any Blacksmith or enterprise label. Restore DuraSH project references in the host TypeScript program and list `apps/web/tests/client-build-record.ts` there so overlay HMR e2e type-checks, keep the tool-catalog completeness glob parameter so `gen-durash-tool-catalog` does not scan upstream `tool-*` packages, and rewrite `pnpm-lock.yaml` after taking upstream's lockfile so `@durash/*` packages remain installable. Record the primary baseline in `UPSTREAM_SOURCES.json` and `INTEGRATION_STATUS.md`.

## Alternatives considered

- Pushing only the unpushed sync-block commit. Rejected: a moving upstream SHA still changes conflict files and fails the cron.
- Taking upstream's lockfile, host tsconfig references, and tool-catalog completeness helper unchanged. Rejected: `@durash` packages drop out of install and the host program, and the DuraSH catalog generator then fails against every upstream `tool-*` package.
- Editing the live 3080 working tree. Rejected: that checkout is the running GUI; overlay merge belongs on a separate worktree.

## Consequences

After this lands, the recorded primary SHA matches `durash-upstream/master`. The next scheduled run is in-sync until upstream moves again, and issue #10 can close because the merge is clean rather than because a fingerprint stayed still. Vendored Cordis-family npm drift remains a review issue, not part of this merge.

## Verification

- `scripts/ci-workflow.spec.ts`: downstream `ubuntu-24.04` / `windows-2025` prefixes, Cloudflare skip, and `evaluate()` with `github.repository` set to the canonical name.
- `scripts/check-workspace-constraints.spec.ts` and `scripts/release/families.spec.ts`: `@durash/` packages stay private and off the public release family.
- `packages/llm/llm-pi-ai/tests/catalog.spec.ts`: empty or unavailable `catalogProvider` is refused.
- `packages/core/tools/tests/gen-tool-catalog.spec.ts` and `packages/reliability/durash-tool-reliability/tests/gen-durash-tool-catalog.spec.ts`: upstream completeness names `tool-bash` and not `durash-tool-reliability`; the DuraSH glob names the product tool.
- Session format suites remain the owners of inert legacy event types. The scheduled GitHub mail and the live 3080 GUI are not claimed by those suites.
- `pnpm run typecheck`: host program lists `apps/web/tests/client-build-record.ts` for overlay HMR e2e.
