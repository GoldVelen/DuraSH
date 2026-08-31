# DuraSH

English | [中文](README.zh.md)

## 用合适的模型做合适的事

**按需分配模型 · 成本优先 · 后台可恢复 · 独立审查**

DuraSH 让你按会话分别选择实施模型、审查模型和各自的思考强度：日常实施可以选成本更低的模型，关键审查再使用更强的模型。当前由用户明确选择，不把“自动成本调度”写成已经交付。

**目标：计划 → 实施 → 多路对抗性审查 → 统一总结**

**现在：实施 → 独立审查 → 最多一轮返工 → 一次结果交付**

启动后主对话立即拿到回执，长任务由宿主持有；阶段状态固定显示在输入框上方，刷新或宿主重启后可从持久记录恢复。计划协调、多路审查与自动成本调度仍是下一阶段。

## What DuraSH does today

- **Cost-aware model roles** — choose separate implementation and review models per Session, so the strongest model can be reserved for the work that justifies it. Selection is explicit today, not an automatic cost scheduler.
- **Durable reviewed delivery** — handoff returns after durable acceptance; the Host runs one implementation, one independent review, and at most one bounded rework in the background. A compact status dock shows progress, terminal delivery appears once, Host teardown suspends for recovery, and only explicit user cancellation writes `cancelled`.
- **A product overlay, not another stale fork** — DuraSH adds its brand, workflow policy, composer controls, and reliability engine as plugins over the current verified DeepSeek Harness baseline.

The intended larger workflow is planning → coordinated implementation → multi-path adversarial review → one final summary. That pipeline is the next product milestone; the current developer preview ships the smaller bounded loop above.

DuraSH is an independent reliability distribution built on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`DSH`). It keeps upstream as the base, adds product-owned capabilities through plugins and profile overlays, and makes upstream drift visible instead of silently becoming an old fork.

DuraSH is not an official DeepSeek product and is not endorsed by DeepSeek.

It is built on an **everything-is-a-plugin** architecture and powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512).

The current source base is the latest verified upstream release at the time of this synchronization: `dsh-v0.1.2-alpha.2` / `0a53fb55bea1`. See [upstream policy](UPSTREAM.md), [integration status](INTEGRATION_STATUS.md), and [open-source attribution](OPEN_SOURCE_ATTRIBUTION.md) for the exact boundaries.

## Developer preview

DuraSH is in _developer preview_ and iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

Review the [safety notice](SAFETY.md) before running the project. The independent brand/profile, continuous-update controls, per-session exact-model policy, composer controls, background durable review-and-rework loop, status dock, and saved reasoning-effort delivery are implemented. Coordination, multi-review aggregation, member-level durable progress, and automatic cost scheduling remain incomplete.

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
