# Open-source attribution

English | [中文](OPEN_SOURCE_ATTRIBUTION.zh.md)

## Product lineage

DuraSH is an independent downstream distribution built on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It is not an official DeepSeek distribution and is not endorsed by DeepSeek. The DuraSH name and geometric brand assets are downstream-owned; the DeepSeek Harness name and official assets remain the property of their respective owners.

The current verified primary baseline is DeepSeek Harness `dsh-v0.1.2-alpha.1`, commit `cd5ef8148158c3a752a658978873241fdf8e2bbc`, licensed under the [MIT License](LICENSE).

## Source-level upstreams

| Project | Role in this repository | Recorded source | Update boundary |
| --- | --- | --- | --- |
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) | Primary application, CLI, workflow, plugin, and Web baseline | [`UPSTREAM_SOURCES.json`](UPSTREAM_SOURCES.json) | Merged through the automated primary-upstream PR and accepted only after compatibility checks |
| [Cordis](https://github.com/cordiverse/cordis) | Plugin runtime plus loader/include/group/timer/HMR and console-logger packages in the vendored framework layer | [`vendor/README.md`](vendor/README.md) and [`UPSTREAM_SOURCES.json`](UPSTREAM_SOURCES.json) | Public package releases are audited; source synchronization follows the vendored-package runbook and preserves the local modification log |
| [Cosmokit](https://github.com/shigma/cosmokit) | Vendored utility foundation | [`vendor/README.md`](vendor/README.md) and [`UPSTREAM_SOURCES.json`](UPSTREAM_SOURCES.json) | Same vendored-package boundary |
| [Schemastery](https://github.com/shigma/schemastery) | Vendored schema foundation | [`vendor/README.md`](vendor/README.md) and [`UPSTREAM_SOURCES.json`](UPSTREAM_SOURCES.json) | Same vendored-package boundary |

The inherited vendor manifest records exact snapshot commits from DSH forks. Some historical fork repositories are no longer public, so DuraSH preserves those commit identifiers as provenance while update detection uses the current public package and repository owners above.

The latest DSH baseline also uses [`@earendil-works/pi-ai`](https://github.com/earendil-works/pi) through the registry. Its version is owned by the relevant package manifest and lockfile, and Dependabot monitors it with the rest of the registry dependency graph.

## Complete dependency notices

[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) is generated from workspace, vendored, JavaScript, Python, and native dependency metadata. It is the complete packaged dependency notice; this page explains only the major source lineage and sync ownership. Never edit the generated notice by hand.

## Attribution rule

Whenever DuraSH incorporates code, documentation, assets, or vendored sources from another project, preserve its license and copyright notices, add or update the source of truth above, and regenerate the complete notices when dependency metadata changes. Downstream changes must never be presented as evidence that DeepSeek or another upstream project endorses DuraSH.
