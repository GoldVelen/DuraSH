# Agent Note: DuraSH product overlay and upstream synchronization

Status: implemented

English | [中文](2026-08-30-durash-product-overlay-and-upstream-sync.zh.md)

## Problem

The existing reliability work lived on an old DeepSeek Harness baseline and mixed downstream presentation with upstream-owned packages. Publishing that tree directly would create trademark ambiguity, make source attribution hard to audit, and turn every upstream update into a broad conflict. The repository also had a thirty-day Dependabot cooldown and no mechanism that could prepare an actual primary-upstream synchronization change.

## Decision

Use DuraSH as a short independent product identity and keep the current official DeepSeek Harness release as the base. Product presentation is supplied by an `@durash` browser-brand plugin and an additive `durash` profile applied after the upstream base and Web bundles; the upstream official brand package remains unchanged.

The source distribution treats DuraSH as its default product path. `pnpm run build` selects the DuraSH client identity, and `pnpm start` selects the matching `durash` runtime profile. `pnpm run build:local` retains the neutral upstream development client, while `pnpm run build:official` retains official release artifacts. Source launches reject a DuraSH runtime paired with a non-DuraSH build record and reject the upstream `web` runtime paired with DuraSH client artifacts.

The six DuraSH-owned packages—`@durash/dsh-web-profile`, `@durash/dsh-client-ui-brand`, `@durash/dsh-client-ui-reliability`, `@durash/dsh-reliability-loop`, `@durash/dsh-reliability-policy`, and `@durash/dsh-tool-reliability`—are private source-checkout packages. The source CLI supplies `durash` as an installation-owned template to app boot. Published `@deepseek-ai/dsh` exposes only templates backed by published packages and may reference private workspace packages only from `devDependencies`; the release family rejects `dependencies`, `optionalDependencies`, and `peerDependencies` that point to a private workspace package.

Record every source-level upstream in `UPSTREAM_SOURCES.json`. A scheduled workflow audits all recorded sources, prepares one automation-owned merge PR for the primary DSH upstream, and maintains one review issue for newer vendored public releases. The primary merge explicitly activates the repository's bilingual pairing driver in its temporary checkout, so confirmed sidecar records compose while owner-file conflicts still stop the run. Registry and Actions dependencies follow the [Dependabot update decision](../process/2026-07-27-dependabot-version-updates.md): daily checks with no intentional cooldown and opt-in auto-merge only after required compatibility checks are configured.

The inherited Issue lifecycle and pull-request policy jobs declare `deepseek-harness/deepseek-harness` as their only applicable repository. A downstream repository skips those jobs before checkout, token creation, or policy execution; it does not report a policy pass for Project state that it cannot own. The Python runtime workflow keeps its complete keyless installed-wheel matrix in every repository. Its real-API preflight and live smoke steps apply only to eligible `deepseek-harness/deepseek-harness` CI runs; a missing external key still fails that canonical path, while fork, Dependabot, and downstream runs never request it.

The inherited pull-request CI selects the upstream enterprise or self-hosted failover pools only in `deepseek-harness/deepseek-harness`. Downstream repositories run the same code gates on standard `ubuntu-24.04` and `windows-2025` runners. Their outer gate schedulers, coverage partitions, Vitest processes, snapshots, linters, and package checks use downstream worker budgets instead of the canonical 16-core settings; upstream failover variables neither retarget nor re-expand those jobs. The Cloudflare preview job is canonical-only before checkout or credential access because its Pages project and Access credentials belong to the upstream repository.

The consumer lane also selects the repository-owned client build profile: `official` in `deepseek-harness/deepseek-harness` and `durash` downstream. Node compatibility settles before that repository build because both replace the shared client artifacts. Built Web, HMR, CLI, PWA, and assembled-browser acceptance then read the same verified build record, so runtime composition and product identity cannot silently diverge. Recorded PowerShell tool-turn fixtures preserve the same permission, sandbox, approval, and model-visible runtime-context events as the other shipped-profile snapshots, so replay detects a profile that silently omits those sections.

Keep historical reliability behavior out of the implemented claim until it has been rebuilt over the current workflow seam. `INTEGRATION_STATUS.md` is the authority separating inherited, implemented, prepared, and not-migrated states.

## Alternatives considered

- Renaming or editing upstream official packages: rejected because it destroys ownership clarity and raises merge conflicts.
- Copying the older durable workflow stack wholesale: rejected because the base is more than one thousand upstream commits newer and now exposes different workflow and UI seams.
- Blindly merging every detected update: rejected because freshness without compatibility evidence transfers upstream failures directly to users.
- Publishing the private `@durash` packages or retaining `durash` as an installed template behind optional or development-only package metadata: rejected because the first expands the public release surface and the second leaves a nonfunctional installed command while hiding the pack failure.
- Generalizing the upstream Issue Project policy or requiring its real-API credential in downstream Python matrices: rejected because the App credentials, Project fields, lifecycle actor, and provider account belong to the upstream repository, while downstream repositories own keyless artifact compatibility.
- Retaining upstream enterprise runner labels in downstream CI or moving its Cloudflare deployment onto a standard runner: rejected because the first leaves jobs queued without an eligible runner and the second reaches an upstream-owned deployment with no downstream credentials.

## Consequences

The repository has a small, visible downstream ownership surface, a DuraSH-default source entry, a DuraSH-specific build-and-composition check, and a repeatable path to the latest verified upstream. Source launches retain the private `durash` product composition, while installed `@deepseek-ai/dsh` exposes only profiles whose packages ship in the public release family. Browser profile execution rejects a conflicting recorded client identity, while profile help remains available because it does not launch that client. The automated merge composes only deterministic pairing records; it does not turn semantic conflicts green. Organization-owned Issue and preview-deployment checks are visibly not applicable in DuraSH. Downstream code gates use available standard GitHub runners, and Python artifacts retain cross-platform installed-wheel proof without assuming the upstream provider credential, while the eligible canonical path still rejects a missing external key. The HMR acceptance restores every client artifact and the build record it mutates, so repeated consumer runs start from the same verified artifact set. Upstream development and official artifact commands stay explicit instead of inheriting the product default. Public Actions and branch protection still require configuration after the GitHub repository is created. The brand/profile migration does not close the reliability-engine migration; that remains the next product milestone and cannot be advertised as complete.
