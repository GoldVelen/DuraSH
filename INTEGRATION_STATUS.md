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
| Fast handoff, composer status, and one terminal delivery | Implemented for the bounded loop | The model-facing call returns after durable `accepted`; a Session projection drives the status dock and one stable terminal Conversation Node without live telemetry in the main chat |
| Restart-safe resume and explicit cancel/quiescence | Implemented for the bounded loop | Host or Agent teardown suspends an active stage without writing `cancelled`; adoption resumes the first unsettled stage, while authenticated user cancellation waits for worker and child quiescence and writes one terminal |
| Generic token pruning, compaction, and overflow recovery in stage children | Verified on the shipped standard composition | Delegated children join the parent's exact preset generation and inherit token meter, tool-result pruner, and compaction; existing replay tests cover oversized tool results and recoverable/unrecoverable provider overflow without restoring the old workflow-specific executor |
| Exact-model reasoning effort | Implemented | Policy reads live adapter capability metadata, rejects stale selections without silently changing them, and the workflow worker forwards the chosen effort to each stage child; Grok 4.6 exposes only low/medium/high/xhigh under pi-ai 0.84.4 |
| DuraSH npm distribution | Not prepared | Source execution is supported. The product profile, brand, and Host loop stay source-only; supporting policy/tool/UI manifests are release-shaped for package integrity, but no DuraSH npm release or tag has been published or accepted |

## Current upstream drift

The live 2026-08-31 audit confirms that the primary DSH branch is current after this reconciliation. It also detects four newer public vendored-package releases: Cordis `4.0.0-rc.9`, Cordis Loader `1.0.0-rc.6`, Cordis Include `1.0.5`, and Cordis Timer `1.1.3`. The latest official DSH baseline still carries the recorded older snapshots plus local modifications. DuraSH reports this drift and requires the vendored compatibility runbook before accepting it; detection is not evidence that these releases are already integrated.

## Fusion assessment

The latest-upstream migration and product shell are real, but the reliability engine is **not yet fully fused**. Reusing the current DSH workflow seam and UI is the correct direction; copying the older 18k-line orchestration stack onto a baseline more than one thousand upstream commits newer would recreate a hard fork and is explicitly rejected.

The bounded reliability slice is now fused with the current Host lifecycle: `@durash/dsh-reliability-loop` owns version-2 durable state, returns a fast acceptance receipt, survives the initiating turn and browser connection, suspends rather than falsifying cancellation during teardown, and publishes a derived per-Session status plus one terminal delivery. The `durash` composer selects exact implementation/review models and supported effort values; the generic worker forwards those values, and stage children inherit the current standard preset's pruning and compaction services. The larger engine is still not migrated: there is no member-level durable progress, coordination stage, multi-path review aggregation, or automatic cost scheduler, and a crash inside one stage re-runs that unsettled stage because the generic workflow engine does not journal script progress.

## Core-fork exceptions

None currently. Every DuraSH-owned runtime addition in this migration is an overlay or plugin. If a future capability requires editing an upstream package, record the exact missing extension seam, affected files, regression, and exit condition here before merging it.
