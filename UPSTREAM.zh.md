# 上游与更新策略

[English](UPSTREAM.md) | 中文

## 承诺

DuraSH 追踪的是最新**已验证兼容**上游，而不是盲目把每个新提交直接交给用户。更新检测自动完成；接受更新时仍必须通过普通变更所需的构建、类型、测试、组合与产品门禁。

## 主上游

主上游是 `deepseek-ai/deepseek-harness` 的 `master` 分支。已验证基线与继承的源码 pin 记录在 [`UPSTREAM_SOURCES.json`](UPSTREAM_SOURCES.json)。

定时 workflow 按以下有界流程运行：

1. 每六小时拉取一次主上游；
2. 创建或刷新自动化专属 `automation/upstream-sync` 分支；
3. 把上游合入该分支，并更新记录的主基线；
4. 向仓库默认分支打开唯一一个 PR；
5. 让普通 PR 检查验证产品叠加层与上游行为；
6. 只有仓库所有者配置了 required checks，并设置仓库变量 `DURASH_ENABLE_UPSTREAM_AUTOMERGE=true` 后，才启用自动合并。

合并冲突或检查失败属于可见的兼容性 blocker。workflow 不得通过删除下游行为或强行合并未经测试的代码来“解决”它。

## 其他开源项目

- registry 与 GitHub Actions 依赖由 Dependabot 每日检查，不设置人为冷却期。
- 每个 vendored Cordis 包、Cosmokit 与 Schemastery 发行版都由同一套六小时审计对照公共 npm registry 检查。继承的 snapshot commit 会单独保留，包括已经不再公开的历史 DSH fork commit。
- vendored 漂移会创建或刷新唯一一个持久 GitHub Issue。后续同步必须遵循 [`vendor/README.md`](vendor/README.md)，因为仓库保留了明确的本地修改；bot 不会自动覆盖这一层。
- 仅通过 DSH 继承的源码通常随主上游一起移动。DuraSH 不会静默 re-vendor 一个不兼容的新版本。

## 发布门禁

同步 PR 通过 required CI 与 DuraSH 构建及组合检查后，更新才可交付给用户。公共仓库尚未配置分支保护时，定时自动化只准备 PR，不自动合并。这是安全边界，不是让漂移保持不可见的理由。
