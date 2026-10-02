# DuraSH integration status

English | [中文](INTEGRATION_STATUS.zh.md)

This document separates current source truth from the older DSH fork's accepted behavior. A historical feature is not part of DuraSH until it is integrated on the current upstream baseline and its focused regression passes.

## Source baseline

- Primary upstream: `deepseek-ai/deepseek-harness`
- Branch/tag: `master` / `dsh-v0.2.0-rc.2`
- Exact revision: [`UPSTREAM_SOURCES.json`](UPSTREAM_SOURCES.json)
- Upgrade candidate prepared on 2026-10-02 in an independent clone on `codex/upstream-integration-20261002`. The merge remains uncommitted; no release acceptance or deployment is claimed.

## Capability matrix

The implementation inventory below describes retained capabilities. Only the checks in Local validation establish evidence for this upgrade candidate.

| Capability | Current state | Evidence / boundary |
| --- | --- | --- |
| DSH source upgrade | Locally validated candidate | The recorded upstream revision is integrated in an isolated, uncommitted worktree; release acceptance remains open |
| Independent DuraSH brand and Web profile | Implemented | Product-owned brand package and additive `durash` profile; upstream official brand package is unchanged |
| DuraSH source build and assembled browser composition | Locally verified | `build:durash` and the brand, PWA, and workflow browser checks pass; this is not release acceptance |
| Workflow scripts, resource caps, cancellation, member lifecycle events | Inherited from latest DSH | `@deepseek-ai/dsh-workflow` and its Node PTC engine; DuraSH enables the engine for reliability while general workflow and Ralph tools remain disabled |
| Primary-upstream and dependency drift detection | Operational | The scheduled workflow detected this upstream release, opened the conflict issue, and continues to audit vendored and registry dependencies |
| CI-gated automatic upstream merge | Operational with a manual conflict gate | Clean upstream changes prepare a synchronization PR; product-overlay conflicts stop without overwriting DuraSH behavior and require the reconciliation performed for this baseline |
| Independent durable Run store from the older fork | Implemented for the bounded loop | `@durash/dsh-reliability-loop` keeps one durable record per loop in the `reliability-loop` storage domain; the old fork's general RunStore control plane remains unmatched |
| Fixed implementation → coordinator → three reviews → aggregation pipeline | Not migrated | Latest DSH provides a general workflow seam, not this product policy; the shipped loop is one implementer plus one reviewer |
| Bounded automatic rework with persistent-blocker stop | Implemented for the bounded loop | One rework round with a durable `blocked` stop carrying the final reviewer feedback; the old fork's `needs_replan` round vocabulary beyond that stop is not migrated |
| Restart-safe resume and independent cancel/quiescence | Implemented for the bounded loop | `resume()` re-runs only the record's first unsettled stage; cancellation and runtime teardown reach durable terminal records with no background writer (focused regressions in the loop package) |
| Older fork's token pruning/compaction and overflow retry policy | Not migrated | Current DSH has generic compaction/token-meter services; equivalence with the old workflow-specific policy is not established |
| DuraSH desktop distribution | Assessed, not implemented | The inherited Electron shell and Host are reusable; a product profile, private package closure, client identity, isolated data, and independent update service still need integration |
| DuraSH npm distribution | Not prepared | Source execution is supported; DuraSH-owned packages are marked private and excluded from the inherited DSH release family, so no npm package is advertised or accidentally published |

## Local validation

The 2026-10-02 candidate has the following completed local checks. Skipped platform cases remain unverified. The final audit report records the complete documentation gate and the protected staged tree; no deployment or release acceptance is recorded.

| Check | Result |
| --- | --- |
| Product build and browser composition | `build:durash` passed; brand, PWA, workflow, policy, and global-rules checks passed across 5 files / 12 tests |
| Complete unit suite | 1,908 files passed; 39,481 tests passed, 1 expected failure, and 239 skipped tests; 21 files skipped |
| Session migration | 40 files / 1,210 focused tests passed, including legacy workflow and acceptance histories across V0–V4 |
| Complete expected-output suite | 18 files / 108 tests passed |
| Complete keyless built Session replay | 8 files passed; 199 tests passed, 2 real PowerShell cases skipped because this Mac has no PowerShell runtime |
| Model discovery and reasoning browser checks | Codex and xAI directory scenarios plus declared reasoning passed: 8 Chromium and 4 WebKit tests; WebKit used a task-owned test runtime |
| Hygiene and lint | All 18 hygiene gates passed; full `lint:contracts-ready` passed |
| Type contracts | Full `typecheck` passed on the current product implementation; later changes only synchronize test compositions and CI ownership evidence |
| CI scheduling conditions | 58 focused tests passed, including DuraSH, the public upstream repository, and the inherited in-house runner identifier; no remote platform job was triggered |
| Desktop | Source assessment and inherited package unit tests only; no desktop application launch, packaging, signing, or update smoke |

## Current upstream drift

The primary source revision and vendored snapshots are recorded in [`UPSTREAM_SOURCES.json`](UPSTREAM_SOURCES.json). The scheduled audit reports changes against those records. Vendored package updates require the compatibility procedure in [`vendor/README.md`](vendor/README.md); a newer public package release does not establish that its source is integrated.

## Fusion assessment

The product shell is retained in this upgrade candidate, while the reliability engine is **not yet fully fused**. Reusing the current DSH workflow seam and UI is the correct direction; copying the older 18k-line orchestration stack onto a baseline more than one thousand upstream commits newer would recreate a hard fork and is explicitly rejected.

The first vertical slice of the reliability engine is now real: `@durash/dsh-reliability-loop` keeps product-owned durable loop state over the current workflow lifecycle, runs one bounded review/rework round, recovers from restart without re-running settled attempts, and converges after cancellation, with focused regressions over the real engine and storage backend. The composer workflow switch is also real on the `durash` profile: a per-session policy, the `conversation.input.left` chip, and `dsh_reliability_handoff` admit one loop with selected implementation and review models. The engine as a whole is not migrated: there is no member-level durable progress, no coordination or three-way review stages, stored thinking effort is not yet applied to stage children, and the workflow engine itself still journals nothing.

## Core-fork exceptions

This candidate retains downstream edits inside upstream packages as well as product plugins:

- [Global rules](packages/context/agent-instructions/README.md#editing-global-rules) use the retained `agent/request-context` hook in `core/agent` and `core/agent-loop` to refresh saved Host instructions before request admission.
- [Settings Remote](packages/api/settings-controller/README.md) follows upstream volatile Config forms while retaining authorization and global-rule editing. [`serviceForScope`](packages/preset/agent-preset-registry/README.md) resolves the global-rule service through an `acquireScope` revision lease, retained until the operation settles.
- [pi-ai discovery](packages/llm/llm-pi-ai/README.md) retains authenticated xAI and Codex directory refresh, offline passive metadata, and explicit user adoption; this is not evidence of a successful real-provider model call.
- [Legacy Session handling](.agents/notes/implemented/architecture/2026-08-30-retain-ignorable-external-session-events.md) preserves only the named inert workflow records, without admitting arbitrary unknown events or rewriting historical formats.

Keep these edits bounded to their documented behavior and regression coverage. Retire each downstream delta when an upstream implementation supplies the same behavior and those regressions pass; none expands the older fork's unmigrated workflow capabilities.
