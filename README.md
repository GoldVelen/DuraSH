# DuraSH

English | [中文](README.zh.md)

DuraSH is an independent reliability distribution built on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`DSH`). It keeps upstream as the base, adds product-owned capabilities through plugins and profile overlays, and makes upstream drift visible instead of silently becoming an old fork.

DuraSH is not an official DeepSeek product and is not endorsed by DeepSeek.

It is built on an **everything-is-a-plugin** architecture and powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512).

The current source base is the latest verified upstream release at the time of this migration: `dsh-v0.1.2-alpha.1` / `cd5ef8148158`. See [upstream policy](UPSTREAM.md), [integration status](INTEGRATION_STATUS.md), and [open-source attribution](OPEN_SOURCE_ATTRIBUTION.md) for the exact boundaries.

## Developer preview

DuraSH is in _developer preview_ and iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

Review the [safety notice](SAFETY.md) before running the project. The independent brand/profile and continuous-update controls are implemented; the older fork's durable review-and-rework engine is still being migrated onto the latest DSH workflow seam. Do not interpret this preview as a claim that every reliability capability is already complete.

<a id="run-from-source"></a>

## Run

### Run the DuraSH profile from source

DuraSH does not yet publish an npm release. From this checkout:

```sh
pnpm install
pnpm run build
pnpm start
```

The default build and start commands select the DuraSH client and `durash` runtime profile together. The Web UI starts at `http://127.0.0.1:3080` by default. Use `pnpm run build:local` before `pnpm dsh web` for the upstream source-development client, or `pnpm run build:official` for official release artifacts; the SDK and headless runtime profiles remain intact.

## What is DuraSH-owned?

- the DuraSH name, mark, favicon, wordmark, and `durash` build/profile;
- the product overlay that composes downstream plugins after the latest DSH Web bundles;
- automated primary-upstream synchronization and dependency freshness policy;
- reliability features explicitly marked `implemented` in [INTEGRATION_STATUS.md](INTEGRATION_STATUS.md).

Everything else retains its upstream ownership and license. In particular, current DSH workflow execution, UI, and plugin infrastructure remain upstream code unless the integration status says otherwise.

## Staying current

The repository checks the official DSH branch every six hours and prepares one CI-gated synchronization pull request when it moves. The same audit checks every vendored public package release and keeps one review issue open while drift exists. Dependabot checks ordinary registry and GitHub Actions dependencies daily with no intentional cooldown. Updates are merged only after the repository's compatibility checks pass; "latest" means latest verified, not untested code delivered directly to users.

## Community and support

- Submit feedback and bug reports through [GitHub Issues](https://github.com/GoldVelen/DuraSH/issues), and use [GitHub Discussions](https://github.com/GoldVelen/DuraSH/discussions) for questions and ideas.
- Report vulnerabilities and confidential conduct concerns through the private process in [SECURITY.md](SECURITY.md).
- All project participation follows the [Code of Conduct](CODE_OF_CONDUCT.md).
- Add the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic to your plugin repository for discoverability.
- Keep [OPEN_SOURCE_ATTRIBUTION.md](OPEN_SOURCE_ATTRIBUTION.md) current whenever you pull upstream code or integrate another open-source project.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

For agents, follow [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Integrated upstream projects and repository-level attribution are disclosed in [OPEN_SOURCE_ATTRIBUTION.md](OPEN_SOURCE_ATTRIBUTION.md).
