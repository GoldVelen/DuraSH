# Agent Note: DuraSH product overlay and upstream synchronization

Status: implemented

English | [中文](2026-08-30-durash-product-overlay-and-upstream-sync.zh.md)

## Problem

The existing reliability work lived on an old DeepSeek Harness baseline and mixed downstream presentation with upstream-owned packages. Publishing that tree directly would create trademark ambiguity, make source attribution hard to audit, and turn every upstream update into a broad conflict. The repository also had a thirty-day Dependabot cooldown and no mechanism that could prepare an actual primary-upstream synchronization change.

## Decision

Use DuraSH as a short independent product identity and keep the current official DeepSeek Harness release as the base. Product presentation is supplied by an `@durash` browser-brand plugin and an additive `durash` profile applied after the upstream base and Web bundles; the upstream official brand package remains unchanged.

Record every source-level upstream in `UPSTREAM_SOURCES.json`. A scheduled workflow audits all recorded sources, prepares one automation-owned merge PR for the primary DSH upstream, and maintains one review issue for newer vendored public releases. Registry and Actions dependencies follow the [Dependabot update decision](../process/2026-07-27-dependabot-version-updates.md): daily checks with no intentional cooldown and opt-in auto-merge only after required compatibility checks are configured.

Keep historical reliability behavior out of the implemented claim until it has been rebuilt over the current workflow seam. `INTEGRATION_STATUS.md` is the authority separating inherited, implemented, prepared, and not-migrated states.

## Alternatives considered

- Renaming or editing upstream official packages: rejected because it destroys ownership clarity and raises merge conflicts.
- Copying the older durable workflow stack wholesale: rejected because the base is more than one thousand upstream commits newer and now exposes different workflow and UI seams.
- Blindly merging every detected update: rejected because freshness without compatibility evidence transfers upstream failures directly to users.

## Consequences

The repository has a small, visible downstream ownership surface, a DuraSH-specific build-and-composition check, and a repeatable path to the latest verified upstream. Public Actions and branch protection still require configuration after the GitHub repository is created. The brand/profile migration does not close the reliability-engine migration; that remains the next product milestone and cannot be advertised as complete.
