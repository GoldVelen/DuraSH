# DuraSH

> **把复杂任务交给一条按需分配模型、成本优先、可恢复的可靠性工作流。**
>
> 你可以按会话分别选择实施模型和审查模型，把更强、更贵的模型留给关键检查，而不是让整条任务都跑同一档位。当前版本由用户选择，不声称自动完成成本调度。
>
> **目标流程：计划 → 实施 → 多路对抗性审查 → 统一总结。** **当前可用：实施 → 独立审查 → 最多一轮返工 → 结果交付。** 计划协调与多路审查属于下一阶段，尚未伪装成已完成能力。

[English](README.md) | 中文

## DuraSH 当前做什么

- **按成本选择模型角色** — 每个会话可以分别选择实施模型和审查模型，把更强的模型留给值得它的工作。当前是显式选择，不是自动成本调度。
- **可恢复的审查交付** — 一次实施、一次独立审查、最多一轮有界返工。循环状态能跨重启保留，已完成阶段不会重复，取消会收敛且没有后台写入器。
- **产品层，不是另一份过期分叉** — DuraSH 在当前已核对的 DeepSeek Harness 基线上，用插件加入自己的品牌、工作流策略、composer 控制和可靠性引擎。

更大的目标流程是计划 → 协调实施 → 多路对抗性审查 → 一份最终总结。那是下一阶段的产品里程碑；当前开发者预览交付的是上面这条较小的有界循环。

DuraSH 是建立在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`DSH`）之上的独立可靠性发行版。它以上游为底座，通过插件和 profile 叠加产品能力，并把上游漂移暴露出来，而不是悄悄变成一份旧分叉。

DuraSH 不是 DeepSeek 官方产品，也未获 DeepSeek 背书。

它构建于**一切皆插件**的架构之上，由 [Cordis](https://github.com/cordiverse/cordis) 驱动，其设计参见论文 [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512)。

当前源码基线是 `dsh-v0.2.1-rc.2`；精确修订记录在 [`UPSTREAM_SOURCES.json`](UPSTREAM_SOURCES.json)。边界见[上游策略](UPSTREAM.md)、[集成状态](INTEGRATION_STATUS.md) 和[开源归属](OPEN_SOURCE_ATTRIBUTION.md)。

## 开发者预览

DuraSH 处于 _开发者预览_ 阶段，正在快速迭代。**未来将出现破坏兼容性的变更。**

运行本项目前，请阅读[安全说明](SAFETY.zh.md)。独立品牌与 profile、持续更新控制、按会话的模型策略、composer 切换，以及有界且可恢复的审查返工循环已经实现。协调、多路审查汇总、成员级持久进度，以及把保存的思考力度应用到阶段子任务，仍未完成。

<a id="run-from-source"></a>

## 运行

### 从源码运行 DuraSH profile

DuraSH 尚未发布 npm 包。在本检出中：

```sh
pnpm install
pnpm run build
pnpm start
```

默认的构建和启动命令会同时选择 DuraSH 客户端和 `durash` 运行 profile。Web UI 默认位于 `http://127.0.0.1:3080`。上游源码开发客户端在 `pnpm dsh web` 前使用 `pnpm run build:local`；官方发布产物使用 `pnpm run build:official`。SDK 和无头运行 profile 保持不变。

### 使用桌面应用

用 `pnpm run package:desktop:local` 构建本地 macOS 应用。[桌面指南](apps/desktop/README.zh.md#local-durash-macos-application) 说明安装，以及如何把已有 Harness 数据从 Web 切到桌面。

## 哪些归 DuraSH 所有？

- DuraSH 名称、标记、favicon、字标，以及 `durash` 构建与 profile；
- 在最新 DSH Web bundle 之后组合下游插件的产品层；
- 自动主线上游同步和依赖新鲜度策略；
- [INTEGRATION_STATUS.md](INTEGRATION_STATUS.md) 中明确标为 `implemented` 的可靠性功能。

其余内容保留上游所有权和许可证。除非集成状态另有说明，当前 DSH 的工作流执行、界面和插件基础设施仍是上游代码。

## 保持同步

仓库每六小时检查官方 DSH 分支，并在它前进时准备一个由 CI 把关的同步拉取请求。同一审计会检查每个 vendored 公共包发布，并在存在漂移时保持一个审查 issue 打开。Dependabot 每天检查普通注册表和 GitHub Actions 依赖，没有故意的冷却期。更新只在仓库兼容性检查通过后合并；“最新”指最新已核对版本，不是把未测试代码直接交给用户。

## 社区与支持

- 通过 [GitHub Issues](https://github.com/GoldVelen/DuraSH/issues) 提交反馈和 bug 报告，通过 [GitHub Discussions](https://github.com/GoldVelen/DuraSH/discussions) 讨论问题和想法。
- 通过 [SECURITY.md](SECURITY.md) 中的私下流程报告漏洞和保密行为问题。
- 所有项目参与遵循[行为准则](CODE_OF_CONDUCT.md)。
- 为插件仓库添加 [`dsh-plugin`](https://github.com/topics/dsh-plugin) 话题，便于被发现。
- 拉取上游代码或集成其他开源项目时，保持 [OPEN_SOURCE_ATTRIBUTION.md](OPEN_SOURCE_ATTRIBUTION.md) 为当前状态。
- 加入 <a href="https://discord.gg/4MrtZUhpxg">DeepSeek Harness Discord 社区</a>。

## 参与贡献

参见 [CONTRIBUTING.md](CONTRIBUTING.zh.md)。

## 开发

请先阅读[开发指南](docs/development.zh.md)与[架构文档](docs/architecture.zh.md)。

`pnpm run dev:web` 会在一个终端里完成构建、启动，并在源码修改时重建 client bundle；`make help` 列出 Web 与 Desktop 对应的 Make target。完整表格见开发指南的应用命令一节。

面向 agent：请遵循 [AGENTS.md](AGENTS.md)。

## 引用

```bibtex
@misc{deepseek-harness2026,
  title={DeepSeek Harness: Everything is a Plugin},
  author={DeepSeek-AI},
  year={2026},
  publisher={GitHub},
  howpublished={\url{https://github.com/deepseek-ai/deepseek-harness}},
}
```

## 许可证

[MIT](LICENSE)

第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。集成的上游项目和仓库级归属见 [OPEN_SOURCE_ATTRIBUTION.md](OPEN_SOURCE_ATTRIBUTION.md)。
