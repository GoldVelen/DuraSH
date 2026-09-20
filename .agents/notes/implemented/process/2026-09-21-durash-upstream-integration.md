# Agent Note: Integrate upstream mechanisms while retaining DuraSH ownership

Status: implemented

English | [中文](2026-09-21-durash-upstream-integration.zh.md)

## Problem

DuraSH modifies application composition, release guards, and generated documentation beside a moving upstream. A textual conflict resolution can preserve obsolete launch options, omit private packages, or reconnect the reliability loop to a removed workflow engine. Repeated conflict notifications expose incomplete integration; suppressing notifications does not update the product.

## Decision

Integrate upstream source, package manifests, and launch composition before regenerating derived catalogs, dependency records, and bilingual pairing records. Preserve the source-only `durash` template, its client-build identity check, and the private-package release guard. Upstream profile syntax and YAML-owned HMR remain shared mechanisms; DuraSH adds its product layer without preserving retired launcher options.

CLI plugin management uses upstream package operations and their shared profile write lock. The launcher explicitly supplies installation-owned templates when initializing a missing profile; an existing manifest retains its selected bundles. A separate downstream package-manager path would duplicate locking and initialization behavior.

The DuraSH overlay enables the upstream `workflow-ptc` entry over the Node PTC runtime supplied by base. The reliability loop retains its durable stage ownership and runs through that workflow engine. The general workflow and Ralph tools remain disabled in the product composition; enabling the reliability engine does not enable those tools.

The [existing conflict classification and deduplication](2026-09-06-durash-sync-block-reliability-remote-catalog.md) remain unchanged. A green `blocked-known` run means an unchanged conflict is recorded, not that upstream merged or product checks passed. New conflicts and non-conflict failures remain visible. This integration policy complements the [product overlay and release ownership](../feature/2026-08-30-durash-product-overlay-and-upstream-sync.md); those decisions remain active.

`UPSTREAM_SOURCES.json` retains full commit identifiers in valid GitHub `sources[]` entries’ `baseline` and `snapshotBaseline` fields for machine-driven update comparisons. The repository-reference check exempts those exact JSON fields; ordinary documentation links to that source record. Neither the entire manifest nor ordinary prose receives an exemption.

## Alternatives considered

**Select either side for all conflicts.** Upstream-only resolution removes downstream ownership, while downstream-only resolution retains deleted APIs and misses new startup behavior. Reconcile source consumers before rebuilding generated outputs.

**Treat an unchanged conflict as successful synchronization.** Existing deduplication already limits repeated notifications. Product currency still requires a resolved merge and verification of the resulting composition.

**Retain the removed worker-thread engine or a separate plugin command implementation.** Both create permanent downstream copies of mechanisms now owned upstream. Adapting consumers preserves the product behavior with fewer independently maintained implementations.

## Consequences

Upstream mechanism changes require coordinated downstream consumer updates, while product identity and private distribution stay explicit. Generated records describe the integrated source instead of concealing unresolved source conflicts. These obligations do not claim that a local merge, prepared PR, or green monitoring run proves a deployed service is current.

## Verification

The following files own the relevant checks; this list records coverage responsibilities, not successful execution in this integration.

- `scripts/upstream-sync-block.spec.ts` covers real Git conflicts, unchanged and changed fingerprints, and merge failures without unmerged paths.
- `apps/cli/tests/source-build-profile.spec.ts`, `scripts/check-workspace-constraints.spec.ts`, and `scripts/release/families.spec.ts` cover source-only templates, client-build identity, and private-package distribution.
- `packages/boot/plugin-manager/tests/operations.spec.ts` covers locked profile initialization, explicit installation templates, and preservation of existing bundle selection.
- `packages/bundle/durash-web-profile/tests/profile.spec.ts` covers composed PTC activation without enabling the general workflow tools; `packages/reliability/durash-reliability-loop/tests/loop.spec.ts` owns durable stages, recovery, and cancellation over the real PTC engine with controlled child providers.
