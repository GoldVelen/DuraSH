# 开源引用说明

[English](OPEN_SOURCE_ATTRIBUTION.md) | 中文

## 产品谱系

DuraSH 是构建在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)之上的独立下游发行版。它不是 DeepSeek 官方发行版，也未获得 DeepSeek 背书。DuraSH 名称与几何品牌资产属于下游；DeepSeek Harness 名称与官方资产仍归其各自权利人所有。

当前已验证的主基线是 DeepSeek Harness `dsh-v0.1.2-alpha.1`，提交 `cd5ef8148158c3a752a658978873241fdf8e2bbc`，采用 [MIT License](LICENSE)。

## 源码级上游

| 项目 | 在本仓库中的作用 | 记录来源 | 更新边界 |
| --- | --- | --- | --- |
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) | 主应用、CLI、workflow、插件与 Web 基线 | [`UPSTREAM_SOURCES.json`](UPSTREAM_SOURCES.json) | 通过主上游自动同步 PR 合入，并且只有兼容性检查通过后才接受 |
| [Cordis](https://github.com/cordiverse/cordis) | 插件运行时，以及 vendored 框架层中的 loader/include/group/timer/HMR 与控制台日志包 | [`vendor/README.md`](vendor/README.md) 与 [`UPSTREAM_SOURCES.json`](UPSTREAM_SOURCES.json) | 审计公共包发行版；源码同步遵循 vendored 包 runbook，并保留完整本地修改日志 |
| [Cosmokit](https://github.com/shigma/cosmokit) | vendored 工具基础 | [`vendor/README.md`](vendor/README.md) 与 [`UPSTREAM_SOURCES.json`](UPSTREAM_SOURCES.json) | 同一 vendored 包边界 |
| [Schemastery](https://github.com/shigma/schemastery) | vendored schema 基础 | [`vendor/README.md`](vendor/README.md) 与 [`UPSTREAM_SOURCES.json`](UPSTREAM_SOURCES.json) | 同一 vendored 包边界 |

继承的 vendor manifest 记录了 DSH fork 的精确 snapshot commit。部分历史 fork 仓库已不再公开，因此 DuraSH 保留这些 commit 标识作为来源证据，同时使用上表当前公开的包与仓库所有者检测更新。

最新 DSH 基线还通过 registry 使用 [`@earendil-works/pi-ai`](https://github.com/earendil-works/pi)。其版本由对应 package manifest 与 lockfile 管理，并由 Dependabot 与其他 registry 依赖一起监测。

## 完整依赖声明

[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 由 workspace、vendored、JavaScript、Python 与 native 依赖元数据生成，是完整的打包依赖声明。本页只解释主要源码谱系与同步所有权；不得手工修改生成的 notices。

## 引用规则

当 DuraSH 引入其他项目的代码、文档、资产或 vendored 源码时，必须保留其许可证与版权声明，更新上面的权威来源，并在依赖元数据变化后重新生成完整 notices。不得把下游改动表述成 DeepSeek 或任何其他上游项目对 DuraSH 的背书。
