# DuraSH

[English](README.md) | 中文

DuraSH 是构建在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`DSH`）之上的独立可靠性发行版。它把上游作为基座，通过插件与 profile 叠加产品自有能力，并把上游漂移显式暴露出来，避免悄悄退化成陈旧分叉。

DuraSH 不是 DeepSeek 官方产品，也未获得 DeepSeek 背书。

它构建于**一切皆插件**的架构之上，由 [Cordis](https://github.com/cordiverse/cordis) 驱动，其设计参见论文 [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512)。

本次迁移采用当时已验证的最新上游版本：`dsh-v0.1.2-alpha.1` / `cd5ef8148158`。精确边界见[上游策略](UPSTREAM.md)、[融合状态](INTEGRATION_STATUS.md)与[开源引用说明](OPEN_SOURCE_ATTRIBUTION.md)。

## 开发者预览

DuraSH 处于 _开发者预览_ 阶段，正在快速迭代。**未来将出现破坏兼容性的变更。**

运行本项目前，请阅读[安全说明](SAFETY.zh.md)。独立品牌/profile 与持续更新控制已经落地；旧分叉中的持久化审查返工引擎仍在迁移到最新 DSH workflow 接口，不能把当前预览版理解成“所有可靠性能力都已完成”。

<a id="run-from-source"></a>

<a id="run"></a>

## 运行

### 从源码运行 DuraSH profile

DuraSH 目前尚未发布 npm 版本。在当前 checkout 中运行：

```sh
pnpm install
pnpm run build
pnpm start
```

默认构建与启动命令会同时选择 DuraSH 客户端和 `durash` 运行 profile。Web UI 默认启动在 `http://127.0.0.1:3080`。如需上游源码开发客户端，请先运行 `pnpm run build:local`，再运行 `pnpm dsh web`；如需官方发布产物，请运行 `pnpm run build:official`。SDK 与 headless 运行 profile 保持不变。

## 哪些内容属于 DuraSH？

- DuraSH 名称、标志、favicon、wordmark 与 `durash` 构建/profile；
- 在最新 DSH Web bundle 之后组合下游插件的产品叠加层；
- 官方上游自动同步与依赖新鲜度策略；
- [融合状态](INTEGRATION_STATUS.md)中明确标为“已实现”的可靠性能力。

其余代码继续保留原始上游所有权与许可证。尤其是当前的 DSH workflow 执行、UI 与插件基础设施，除非融合状态另有说明，仍属于上游代码。

## 持续跟进最新版本

仓库每六小时检查一次官方 DSH 分支；出现变化时准备一个受 CI 门禁保护的同步 PR。同一审计会检查每个 vendored 公共包发行版，并在存在漂移时维持唯一一个 review Issue。Dependabot 每日检查普通 registry 与 GitHub Actions 依赖，不设置人为冷却期。只有通过兼容性检查的更新才会合入；这里的“最新”指最新已验证版本，不是把未经测试的代码直接交给用户。

## 社区与支持

- 通过 [GitHub Issues](https://github.com/GoldVelen/DuraSH/issues)提交反馈与缺陷报告，通过 [GitHub Discussions](https://github.com/GoldVelen/DuraSH/discussions)交流问题与想法。
- 按 [SECURITY.md](SECURITY.md) 中的私密流程报告漏洞或需要保密的行为准则问题。
- 所有项目参与者都必须遵守[行为准则](CODE_OF_CONDUCT.md)。
- 为你的插件仓库添加 [`dsh-plugin`](https://github.com/topics/dsh-plugin) 话题，便于被发现。
- 每次同步上游代码或接入新的开源项目后，都要更新 [OPEN_SOURCE_ATTRIBUTION.md](OPEN_SOURCE_ATTRIBUTION.md)。

## 参与贡献

参见[贡献指南](CONTRIBUTING.zh.md)。

## 开发

请先阅读[开发指南](docs/development.zh.md)与[架构文档](docs/architecture.zh.md)。

面向 agent：请遵循 [AGENTS.md](AGENTS.md)。

## 许可证

[MIT](LICENSE)

第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。仓库级开源引用与上游来源见 [OPEN_SOURCE_ATTRIBUTION.md](OPEN_SOURCE_ATTRIBUTION.md)。
