# Agent Note: Reconcile the Cordis rc.9 vendored updates

Status: implemented

English | [中文](2026-09-01-cordis-rc9-vendor-sync.zh.md)

## Problem

The dependency audit found four newer Cordis-family releases. Cordis `4.0.0-rc.9`, Loader `1.0.0-rc.6`, Include `1.0.5`, and Timer `1.1.3` all came from upstream commit `ed8a7755c26a27a72064a21dea036ad1d1d6833c`. Replacing the vendored directories wholesale would also remove the Loader, Include, HMR, packaging, and rescope changes recorded in `vendor/README.md`.

## Decision

Pin the four packages to that one upstream commit and review the source changes against the existing product overlay. The sync accepts symbol-safe event storage and dispatch, inherited property lookup and caller-aware service proxies, canonical wrapped-fiber restart and update, corrected logger thresholds and exporter disposal, exact-optional-property typing, and FIFO settlement for concurrent interval reads. Dynamic symbol events use fallback overloads rather than weakening declared string-event result types through the upstream symbol index. `EventsService.dispatch()` remains supported because agent notifications use its filtered callback set for independent failure containment. Plugin callback failures adopt upstream's stop-until-update rule; config-resolution failures remain retryable when an injected provider changes because the raw expression belongs to the new injection epoch.

All applicable local modifications remain. The Include `writeTask` exact-optional-property widening is the only retired modification because upstream now contains the same type correction. Package names, internal imports, published-source coverage, lazy Loader config resolution, transactional Loader and Include behavior, durable Include writes, HMR safeguards, entry interpolation, Node loader detection, and the other manifest entries remain DuraSH-owned differences.

## Verification

`scripts/vendor-cordis-updates.spec.ts` pins the accepted event, fiber, logger, service-caller, and timer behavior. The vendoring manifest, upstream-source registry, rescope documentation, rescope generator, and lockfile identify the same package versions and upstream commit. Existing owner tests continue to cover the retained Loader and Include behavior.

## Alternatives considered

- **Replace each directory with the release tarball** — rejected because it would silently discard logged DuraSH behavior that the upstream releases do not contain.
- **Keep the older snapshots and only close the audit issue** — rejected because the event, lifecycle, logging, proxy, and timer fixes are relevant to the runtime and can be accepted without losing the product overlay.
- **Copy only the release version fields** — rejected because it would claim a source baseline whose behavior was not actually present.

## Consequences

The four packages now share one auditable source baseline while the local-modification log remains exhaustive. Future dependency audits can compare from the exact commit instead of repeatedly reporting this release set. The repository continues to own compatibility review for later Cordis releases; a version match alone still does not authorize replacing vendored source.
