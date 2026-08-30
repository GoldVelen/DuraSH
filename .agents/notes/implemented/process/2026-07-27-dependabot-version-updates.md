# Agent Note: Dependabot updates for latest verified dependencies

Status: implemented

English | [中文](2026-07-27-dependabot-version-updates.zh.md)

## Problem

Maintained registry and GitHub Actions dependencies need a regular update path. Leaving updates manual lets dependency drift accumulate, while delivering untested releases directly to users confuses freshness with compatibility. Vendored Cordis sources cannot be treated like registry dependencies, and workspaces sharing one lockfile must be updated through the same package tree.

## Decision

The default branch carries [`.github/dependabot.yml`](../../../../.github/dependabot.yml) with daily version-update checks for the root pnpm workspace, the `python/sdk` uv project, and GitHub Actions. Every entry sets `cooldown.default-days` to `0`, so DuraSH adds no intentional age quarantine before Dependabot proposes a release. The [DuraSH product and upstream decision](../feature/2026-08-30-durash-product-overlay-and-upstream-sync.md) owns the user-facing latest-verified promise and primary-source synchronization.

The root pnpm scan includes the shared `native/landlock-run` workspace and excludes `vendor/**`, whose source and manifests move only through the [vendoring procedure](../../../../vendor/README.md). GitHub applies `exclude-paths` only to version updates; a security pull request that touches a vendored manifest is replaced through the vendoring procedure instead of being merged as generated. Dependabot pull requests receive the repository's `kind/dependency` and `area/infra` labels and run the normal pull-request checks.

Dependency auto-merge is disabled by default. The separate `pull_request_target` workflow performs no checkout and enables GitHub auto-merge only for a same-repository `dependabot[bot]` pull request when `DURASH_ENABLE_DEPENDABOT_AUTOMERGE=true`; branch protection and required checks still decide whether the merge can occur. A failing or incomplete check leaves the update open for diagnosis.

The pnpm entry keeps the unified workspace on its pinned pnpm 11 instead of introducing an automation-only downgrade. The provider-run update job remains the integration check for the root lockfile format and workspace closure.

## Alternatives considered

- **A fixed 30-day quarantine.** Rejected for DuraSH because the product promise requires prompt access to compatible upstream features; compatibility checks and a visible blocked pull request carry the acceptance decision.
- **Unconditional automatic merging.** Rejected because detection cannot prove compatibility; auto-merge remains opt-in and subordinate to required checks.
- **A separate native npm scan.** Rejected because the Landlock manifests belong to the root workspace and lockfile; splitting their update would recreate an ownership boundary the package manager does not have.
- **Renovate or a scheduled agent.** Rejected because Dependabot already covers every registry and Actions manifest in scope, while source-vendored projects require their own update procedure.

## Consequences

- New dependency releases can produce pull requests on the next daily run instead of waiting for an age threshold.
- Required checks, not release age, prevent incompatible updates from reaching the verified branch.
- Vendored source updates remain explicit reviews that preserve the local-modification log.
- Enabling auto-merge is an operational repository decision made only after public branch protection names the DuraSH product check and the ordinary compatibility checks as required.
