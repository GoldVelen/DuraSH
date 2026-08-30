# DuraSH integration status

English | [中文](INTEGRATION_STATUS.zh.md)

This document separates current source truth from the older DSH fork's accepted behavior. A historical feature is not part of DuraSH until it is integrated on the current upstream baseline and its focused regression passes.

## Verified baseline

- Primary upstream: `deepseek-ai/deepseek-harness`
- Branch/tag: `master` / `dsh-v0.1.2-alpha.1`
- Commit: `cd5ef8148158c3a752a658978873241fdf8e2bbc`
- Baseline fetched and compared with `origin/master` on 2026-08-30

## Capability matrix

| Capability | Current state | Evidence / boundary |
| --- | --- | --- |
| Latest DSH source baseline | Implemented | This branch starts at the verified commit above |
| Independent DuraSH brand and Web profile | Implemented | Product-owned brand package and additive `durash` profile; upstream official brand package is unchanged |
| DuraSH source build and assembled browser composition | Implemented | `build:durash`, the DuraSH browser-composition regression, and its pull-request workflow verify the product profile independently of the official client build |
| Workflow scripts, resource caps, cancellation, member lifecycle events | Inherited from latest DSH | `@deepseek-ai/dsh-workflow`, worker-thread engine, workflow tool, and workflow-run UI |
| Primary-upstream and dependency drift detection | Implemented locally | Scheduled sync workflow, source manifest, drift script, and zero-cooldown Dependabot configuration; becomes operational after the public repository enables Actions |
| CI-gated automatic upstream merge | Prepared, not active | Requires public repository branch protection and the opt-in repository variable documented in `UPSTREAM.md` |
| Independent durable Run store from the older fork | Not migrated | Latest DSH records workflow lifecycle in the parent Session, but does not provide the old independent RunStore control plane |
| Fixed implementation → coordinator → three reviews → aggregation pipeline | Not migrated | Latest DSH provides a general workflow seam, not this product policy |
| Bounded automatic rework with persistent-blocker `needs_replan` stop | Not migrated | Historical behavior exists only in the older fork and must be reimplemented as a product-owned plugin over the current workflow seam |
| Restart-safe resume and independent cancel/quiescence | Not migrated | Current engine cancellation is bounded; durable post-restart orchestration recovery remains open |
| Older fork's token pruning/compaction and overflow retry policy | Not migrated | Current DSH has generic compaction/token-meter services; equivalence with the old workflow-specific policy is not established |
| DuraSH npm distribution | Not prepared | Source execution is supported; DuraSH-owned packages are marked private and excluded from the inherited DSH release family, so no npm package is advertised or accidentally published |

## Current upstream drift

The live 2026-08-30 audit confirms that the primary DSH branch is current. It also detects four newer public vendored-package releases: Cordis `4.0.0-rc.9`, Cordis Loader `1.0.0-rc.6`, Cordis Include `1.0.5`, and Cordis Timer `1.1.3`. The latest official DSH baseline still carries the recorded older snapshots plus local modifications. DuraSH reports this drift and requires the vendored compatibility runbook before accepting it; detection is not evidence that these releases are already integrated.

## Fusion assessment

The latest-upstream migration and product shell are real, but the reliability engine is **not yet fully fused**. Reusing the current DSH workflow seam and UI is the correct direction; copying the older 18k-line orchestration stack onto a baseline more than one thousand upstream commits newer would recreate a hard fork and is explicitly rejected.

The next implementation milestone is one vertical slice: durable product-owned workflow state over the current lifecycle events, one bounded review/rework round, restart recovery, and focused recovery regressions. Only then may DuraSH claim that durable convergence is available on the new base.

## Core-fork exceptions

None currently. Every DuraSH-owned runtime addition in this migration is an overlay or plugin. If a future capability requires editing an upstream package, record the exact missing extension seam, affected files, regression, and exit condition here before merging it.
