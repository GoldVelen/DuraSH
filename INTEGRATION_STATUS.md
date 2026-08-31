# DuraSH integration status

English | [中文](INTEGRATION_STATUS.zh.md)

This document separates current source truth from the older DSH fork's accepted behavior. A historical feature is not part of DuraSH until it is integrated on the current upstream baseline and its focused regression passes.

## Verified baseline

- Primary upstream: `deepseek-ai/deepseek-harness`
- Branch/tag: `master` / `dsh-v0.1.2-alpha.2`
- Commit: `0a53fb55bea101816fa226bb964ae2bed71c343b`
- Baseline fetched, reconciled with the DuraSH product overlay, and compared with `origin/master` on 2026-08-31

## Capability matrix

| Capability | Current state | Evidence / boundary |
| --- | --- | --- |
| Latest DSH source baseline | Implemented | This branch starts at the verified commit above |
| Independent DuraSH brand and Web profile | Implemented | Product-owned brand package and additive `durash` profile; upstream official brand package is unchanged |
| DuraSH source build and assembled browser composition | Implemented | `build:durash`, the DuraSH browser-composition regression, and its pull-request workflow verify the product profile independently of the official client build |
| Workflow scripts, resource caps, cancellation, member lifecycle events | Inherited from latest DSH | `@deepseek-ai/dsh-workflow`, worker-thread engine, workflow tool, and workflow-run UI |
| Primary-upstream and dependency drift detection | Operational | The scheduled workflow detected this upstream release, opened the conflict issue, and continues to audit vendored and registry dependencies |
| CI-gated automatic upstream merge | Operational with a manual conflict gate | Clean upstream changes prepare a synchronization PR; product-overlay conflicts stop without overwriting DuraSH behavior and require the reconciliation performed for this baseline |
| Independent durable Run store from the older fork | Implemented for the bounded loop | `@durash/dsh-reliability-loop` keeps one durable record per loop in the `reliability-loop` storage domain; the old fork's general RunStore control plane remains unmatched |
| Fixed implementation → coordinator → three reviews → aggregation pipeline | Not migrated | Latest DSH provides a general workflow seam, not this product policy; the shipped loop is one implementer plus one reviewer |
| Bounded automatic rework with persistent-blocker stop | Implemented for the bounded loop | One rework round with a durable `blocked` stop carrying the final reviewer feedback; the old fork's `needs_replan` round vocabulary beyond that stop is not migrated |
| Restart-safe resume and independent cancel/quiescence | Implemented for the bounded loop | `resume()` re-runs only the record's first unsettled stage; cancellation and runtime teardown reach durable terminal records with no background writer (focused regressions in the loop package) |
| Older fork's token pruning/compaction and overflow retry policy | Not migrated | Current DSH has generic compaction/token-meter services; equivalence with the old workflow-specific policy is not established |
| DuraSH npm distribution | Not prepared | Source execution is supported; DuraSH-owned packages are marked private and excluded from the inherited DSH release family, so no npm package is advertised or accidentally published |

## Current upstream drift

The live 2026-08-31 audit confirms that the primary DSH branch is current after this reconciliation. It also detects four newer public vendored-package releases: Cordis `4.0.0-rc.9`, Cordis Loader `1.0.0-rc.6`, Cordis Include `1.0.5`, and Cordis Timer `1.1.3`. The latest official DSH baseline still carries the recorded older snapshots plus local modifications. DuraSH reports this drift and requires the vendored compatibility runbook before accepting it; detection is not evidence that these releases are already integrated.

## Fusion assessment

The latest-upstream migration and product shell are real, but the reliability engine is **not yet fully fused**. Reusing the current DSH workflow seam and UI is the correct direction; copying the older 18k-line orchestration stack onto a baseline more than one thousand upstream commits newer would recreate a hard fork and is explicitly rejected.

The first vertical slice of the reliability engine is now real: `@durash/dsh-reliability-loop` keeps product-owned durable loop state over the current workflow lifecycle, runs one bounded review/rework round, recovers from restart without re-running settled attempts, and converges after cancellation, with focused regressions over the real engine and storage backend. The composer workflow switch is also real on the `durash` profile: a per-session policy, the `conversation.input.left` chip, and `dsh_reliability_handoff` admit one loop with selected implementation and review models. The engine as a whole is not migrated: there is no member-level durable progress, no coordination or three-way review stages, stored thinking effort is not yet applied to stage children, and the workflow engine itself still journals nothing.

## Core-fork exceptions

None currently. Every DuraSH-owned runtime addition in this migration is an overlay or plugin. If a future capability requires editing an upstream package, record the exact missing extension seam, affected files, regression, and exit condition here before merging it.
