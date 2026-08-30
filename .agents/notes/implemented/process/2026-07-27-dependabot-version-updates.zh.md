# Agent Note: Dependabot 更新追踪最新已验证依赖

Status: implemented

[English](2026-07-27-dependabot-version-updates.md) | 中文

## 问题

来自包注册表的依赖与 GitHub Actions 依赖都需要定期更新机制。完全依靠手动更新会导致依赖差距持续扩大，而把未经测试的新版本直接交给用户则混淆了新鲜度与兼容性。以源码形式纳入仓库的 Cordis 不能当作注册表依赖处理，共用一份锁文件的工作区也必须通过同一棵包树更新。

## 决策

默认分支包含 [`.github/dependabot.yml`](../../../../.github/dependabot.yml)，其中为根 pnpm 工作区、`python/sdk` uv 项目与 GitHub Actions 配置每日版本更新检查。每个更新项都把 `cooldown.default-days` 设为 `0`，因此 DuraSH 不在 Dependabot 提案前添加人为版本隔离期。[DuraSH 产品与上游决策](../feature/2026-08-30-durash-product-overlay-and-upstream-sync.zh.md)负责面向用户的“最新已验证”承诺与主源码同步。

根 pnpm 扫描包含共享的 `native/landlock-run` workspace，并排除 `vendor/**`；后者的源码与 manifest 只通过 [vendoring 流程](../../../../vendor/README.md)变更。GitHub 只把 `exclude-paths` 用于版本更新；如果安全更新 PR 涉及随源码纳入仓库的 manifest，则改由 vendoring 流程处理，不原样合并自动生成的 PR。Dependabot PR 会获得仓库的 `kind/dependency` 与 `area/infra` 标签，并运行普通 PR 检查。

依赖自动合并默认关闭。独立的 `pull_request_target` workflow 不 checkout 代码，并且只有同仓库 `dependabot[bot]` PR 且 `DURASH_ENABLE_DEPENDABOT_AUTOMERGE=true` 时才启用 GitHub auto-merge；分支保护与 required checks 仍决定是否能够真正合入。任何失败或未完成检查都会让更新保持打开，等待诊断。

pnpm 更新项让统一 workspace 继续使用已固定的 pnpm 11，不会仅为自动化降级版本。由提供方运行的更新任务仍负责集成验证根 lockfile 格式与 workspace 闭包。

## 考虑过的替代方案

- **固定等待 30 天。** DuraSH 不采用，因为产品承诺要求用户及时获得兼容的上游功能；兼容性检查与保持可见的阻塞 PR 承担接受决策。
- **无条件自动合并。** 不采用，因为检测本身不能证明兼容；auto-merge 必须显式启用，并服从 required checks。
- **为 native 配置独立 npm 扫描。** 不采用，因为 Landlock manifest 属于根 workspace 与 lockfile；拆分更新会重建一个包管理器并不存在的所有权边界。
- **Renovate 或定时 agent。** 不采用，因为 Dependabot 已覆盖范围内全部 registry 与 Actions manifest，而源码 vendored 项目需要自己的更新流程。

## 后果

- 新依赖版本可在下一次每日运行时产生 PR，不再等待固定时长。
- required checks 而不是版本年龄负责阻止不兼容更新进入已验证分支。
- vendored 源码更新仍是保留本地修改日志的明确审查。
- 只有公共仓库分支保护把 DuraSH 产品检查与普通兼容性检查列为 required 后，才允许通过仓库设置启用 auto-merge。
